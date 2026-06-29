---
title: 内网穿透方案：Cloudflare Tunnel、frp、Tailscale 与 IPv6 DDNS
description: 整理用过的常见内网穿透与远程访问方案，包括 Cloudflare Tunnel、frp、Tailscale 和 IPv6 DDNS。
tags:
  - Linux
createdAt: '2026-05-06 16:55:00'
updatedAt: '2026-06-03 08:50:00'
---

本文整理四种常见方案：Cloudflare Tunnel、frp、Tailscale、IPv6 DDNS。

## 方案一：Cloudflare Tunnel

Cloudflare Tunnel 的核心思路是：本地机器通过隧道连接到 Cloudflare，Cloudflare 再把访问域名的请求通过这条隧道转发回本地服务。

### 安装 cloudflared

以 Debian / Ubuntu 为例：

```bash
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null

echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list

sudo apt-get update
sudo apt-get install cloudflared
```

### 登录并创建 Tunnel

```bash
cloudflared tunnel login
cloudflared tunnel create my-tunnel
cloudflared tunnel list
```

`cloudflared tunnel login` 会打开浏览器进行 Cloudflare 授权。`cloudflared tunnel create my-tunnel` 会创建隧道，并生成隧道 ID 和凭证文件。

为了作为系统服务运行，建议把凭证文件放到 `/etc/cloudflared/`：

```bash
sudo mkdir -p /etc/cloudflared
sudo cp ~/.cloudflared/*.json /etc/cloudflared/
sudo cp ~/.cloudflared/cert.pem /etc/cloudflared/
```

### 配置多个本地服务

编辑 `/etc/cloudflared/config.yml`：

```yaml
tunnel: <Tunnel-UUID>
credentials-file: /etc/cloudflared/<Tunnel-UUID>.json

ingress:
  - hostname: api.example.com
    service: http://localhost:8080

  - hostname: app.example.com
    service: http://localhost:3000

  - service: http_status:404
```

这个配置表示：

- `https://api.example.com` 转发到本机 `8080` 端口。

- `https://app.example.com` 转发到本机 `3000` 端口。

- 未匹配的请求返回 404，避免意外暴露其它服务。

### 绑定 DNS

```bash
cloudflared tunnel route dns my-tunnel api.example.com
cloudflared tunnel route dns my-tunnel app.example.com
```

这会在 Cloudflare DNS 中创建指向 Tunnel 的 CNAME 记录。

### 注册 systemd 服务

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

修改 `/etc/cloudflared/config.yml` 后，重启服务：

```bash
sudo systemctl restart cloudflared
```

### 验证

```bash
curl -I https://api.example.com
cloudflared tunnel info my-tunnel
journalctl -u cloudflared -f
```

如果能看到 `server: cloudflare`，说明请求已经经过 Cloudflare；如果本地服务日志也出现访问记录，说明 Tunnel 已经成功把请求转发到本地。

## 方案二：frp

frp 和 Cloudflare Tunnel 类似，都是中转方案，区别在于 frp 需要**自备**有公网 IP 的服务器。它由两部分组成：

- `frps`：运行在有公网 IP 的服务器上。

- `frpc`：运行在内网机器上，主动连接 `frps`。

公网用户访问 VPS 的某个端口或域名，`frps` 再把流量转发给内网中的 `frpc`。这种方式比 Cloudflare Tunnel 更通用，适合 TCP、UDP、HTTP、HTTPS、SSH 等场景。

### 服务端 frps 配置

在公网 VPS 上创建 `frps.toml`：

```toml
bindPort = 7000

vhostHTTPPort = 8080
vhostHTTPSPort = 8443

auth.method = "token"
auth.token = "change-this-token"
```

启动服务端：

```bash
./frps -c ./frps.toml
```

生产环境建议使用 systemd 托管 `frps`，并在防火墙中只开放需要的端口，例如：

- `7000`：frpc 连接 frps 的控制端口。

- `8080`：HTTP 虚拟主机入口。

- `8443`：HTTPS 虚拟主机入口。

- `60022`：示例中的 SSH 转发端口。

### 客户端 frpc 配置

在内网机器上创建 `frpc.toml`：

```toml
serverAddr = "<VPS公网IP或域名>"
serverPort = 7000

auth.method = "token"
auth.token = "change-this-token"

[[proxies]]
name = "web"
type = "http"
localIP = "127.0.0.1"
localPort = 3000
customDomains = ["app.example.com"]

[[proxies]]
name = "ssh"
type = "tcp"
localIP = "127.0.0.1"
localPort = 22
remotePort = 60022
```

启动客户端：

```bash
./frpc -c ./frpc.toml
```

此时：

- `http://app.example.com:8080` 会转发到内网机器的 `127.0.0.1:3000`。

- `ssh -p 60022 user@<VPS公网IP>` 会转发到内网机器的 `22` 端口。

如果希望 `app.example.com` 不带端口访问，需要在 VPS 上用 Caddy / Nginx 监听 80 / 443，再反代到 `127.0.0.1:8080` 或 `127.0.0.1:8443`。

## 方案三：Tailscale

Tailscale 是一种简便的虚拟局域网方案。安装 Tailscale 后，不同设备会加入同一个 tailnet，并获得一个稳定的私有地址。你可以像在同一个局域网内一样访问其它设备。

在**每台设备**上安装 Tailscale 后执行：

```bash
sudo tailscale up
```

查看设备列表：

```bash
tailscale status
```

之后可以用 Tailscale 分配的私有 IP 或 MagicDNS 名称访问，例如：

```bash
ssh user@my-server
curl http://my-server:3000
```

## 方案四：IPv6 DDNS

如果宽带或服务器有公网 IPv6，那么最直接的方式就是 DDNS。这种方案的优点是链路最短、依赖最少、性能最好；缺点是依赖运营商 IPv6、家庭路由器防火墙、客户端网络是否支持 IPv6。

### 检查是否有公网 IPv6

```bash
ip -6 addr show scope global
curl -6 https://ifconfig.co
```

如果能看到不是 `fe80::/10` 的全局 IPv6，并且 `curl -6` 能返回 IPv6 地址，说明这台机器大概率具备 IPv6 出口。

### 使用 Cloudflare API 更新 AAAA 记录

先在 Cloudflare 中创建一个 AAAA 记录，例如：

```
home.example.com -> 2001:db8::1
```

然后获取：

- `ZONE_ID`

- `RECORD_ID`

- 只允许编辑 DNS 的 API Token

创建 `/usr/local/bin/cloudflare-ddns-ipv6.sh`：

```bash
#!/usr/bin/env bash
set -euo pipefail

ZONE_ID="<Zone ID>"
RECORD_ID="<AAAA Record ID>"
API_TOKEN="<Cloudflare API Token>"
RECORD_NAME="home.example.com"

IPV6="$(ip -6 route get 2400:3200::1 | awk '{for(i=1;i<=NF;i++) if($i==\"src\") print $(i+1)}')"

if [ -z "$IPV6" ]; then
  echo "No IPv6 address found"
  exit 1
fi

curl -sS -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"type\":\"AAAA\",\"name\":\"${RECORD_NAME}\",\"content\":\"${IPV6}\",\"ttl\":120,\"proxied\":false}"
```

授权并测试：

```bash
sudo chmod +x /usr/local/bin/cloudflare-ddns-ipv6.sh
/usr/local/bin/cloudflare-ddns-ipv6.sh
```

加入定时任务：

```bash
crontab -e
```

```
*/5 * * * * /usr/local/bin/cloudflare-ddns-ipv6.sh >/tmp/cloudflare-ddns-ipv6.log 2>&1
```

### 防火墙放行

例如只放行 SSH 和 Web：

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

IPv6 DDNS 会把你的真实 IPv6 暴露到公网，因此不要开放数据库、Docker API、管理后台等高风险端口。SSH 必须使用强密码或密钥登录，最好限制来源地址。
