---
title: Linux 服务器科学上网指南：Mihomo 与 SSH 反向端口转发
description: 整理 Linux 服务器科学上网的两种常见方式：在服务器上部署 Mihomo/Clash 内核，或通过 SSH 反向端口转发让远程服务器复用本地代理。
tags:
  - Linux
createdAt: 2026-03-30
updatedAt: 2026-05-27
---
Linux 服务器科学上网一般有两种路径：

第一种是在服务器上直接部署 Mihomo。它适合长期在线、有公网或固定内网环境的服务器。

第二种是通过 SSH 反向端口转发复用本地代理。它适合临时登录远程服务器、实验室内网机器、无法安装代理软件的服务器。服务器端不需要部署任何软件，只要本地电脑已经有代理即可。

## 方案一：部署 Mihomo

Mihomo 提供多种部署方式，本文介绍 Docker 和 deb 包两种方式。

### 使用 Docker 部署

准备一个目录，放好 `docker-compose.yaml` 和 `mihomo/config.yaml` 即可。

```
clash/
├── docker-compose.yaml
└── mihomo/
    └── config.yaml
```

```yaml
# docker-compose.yaml
services:
  mihomo:
    image: metacubex/mihomo:latest
    container_name: mihomo
    restart: always
    volumes:
      - ./mihomo:/root/.config/mihomo
    network_mode: host
```

补全 `config.yaml` 后（内容详见[后文](/333c2508f83d80d8bb27d189e75b2451#eea2f33889ff4965a2f5afcb9b51a2d5)），在 `docker-compose.yaml` 同级目录执行：

```bash
docker compose up -d && docker compose logs -f
```

如果首次启动因为 GeoIP 等文件下载失败，可以手动下载文件并放入配置目录 `./mihomo/`，

```bash
wget -O ./mihomo/Country.mmdb https://fastly.jsdelivr.net/gh/Dreamacro/maxmind-geoip@release/Country.mmdb
wget -O ./mihomo/geosite.dat https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat
wget -O ./mihomo/geoip.dat https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat
```

### 使用 deb 包部署

在 Debian / Ubuntu 上，也可以直接安装 [Mihomo 发布页](https://github.com/MetaCubeX/mihomo/releases)提供的 deb 包。先根据服务器架构下载对应的 `.deb` 文件，然后安装：

```bash
sudo apt install mihomo-linux-amd64-v3-v1.19.24.deb
```

安装后检查文件位置：

```bash
dpkg -L mihomo | grep -E 'mihomo$|service|systemd|config'
```

正常应能看到 `/usr/bin/mihomo`、`/usr/lib/systemd/system/mihomo.service` 和 `/etc/mihomo/config.yaml`。

deb 包默认使用 `/etc/mihomo/config.yaml` 作为配置文件。编辑这个文件即可：

```bash
sudo vim /etc/mihomo/config.yaml
```

补全 `config.yaml` 后（内容详见[后文](/333c2508f83d80d8bb27d189e75b2451#eea2f33889ff4965a2f5afcb9b51a2d5)），启动 systemd 服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mihomo
```

如果首次启动因为 GeoIP 等文件下载失败，可以手动下载文件并放入配置目录 `/etc/mihomo`，

```bash
sudo wget -O /etc/mihomo/Country.mmdb https://fastly.jsdelivr.net/gh/Dreamacro/maxmind-geoip@release/Country.mmdb
sudo wget -O /etc/mihomo/geosite.dat https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geosite.dat
sudo wget -O /etc/mihomo/geoip.dat https://fastly.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@release/geoip.dat
```

### 配置文件 config.yaml

下面是一份可直接改造的基础配置。Docker 方案放在 `./config/config.yaml`，deb 方案放在 `/etc/mihomo/config.yaml`。主要修改：

- `secret` ：Web UI 密钥。填写复杂字符串。

- `tun.enable` ：TUN 模式开关。Docker 部署方案无效。

- `proxy-providers.Airport.url` ：机场订阅链接。

```yaml
mixed-port: 7890
allow-lan: true
mode: rule
log-level: info
ipv6: true
external-controller: 0.0.0.0:9090
secret: "..." # 填写复杂字符串，用于 Web UI 连接
unified-delay: true
tcp-concurrent: true

tun:
  enable: true
  stack: mixed
  dns-hijack:
    - any:53
    - tcp://any:53
  auto-route: true
  auto-redirect: true
  auto-detect-interface: true

sniffer:
  enable: true
  sniff:
    HTTP: { ports: [80, 8080-8880], override-destination: true }
    TLS: { ports: [443, 8443], override-destination: true }
    QUIC: { ports: [443, 8443], override-destination: true }

dns:
  enable: true
  listen: 0.0.0.0:1053
  ipv6: true
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  default-nameserver:
    - 223.5.5.5
    - 119.29.29.29
  nameserver:
    - https://dns.alidns.com/dns-query
    - https://doh.pub/dns-query
  fallback:
    - https://1.1.1.1/dns-query
    - https://8.8.8.8/dns-query
  nameserver-policy:
    'rule-set:direct':
      - https://dns.alidns.com/dns-query
      - https://doh.pub/dns-query

proxy-providers:
  Airport:
    type: http
    url: "..." # 代理服务商提供的订阅 URL
    path: ./providers/airport.yaml
    proxy: Proxy
    interval: 3600
    health-check:
      enable: true
      url: http://www.gstatic.com/generate_204
      interval: 300

proxy-groups:
  - name: "Proxy"
    type: url-test
    url: http://www.gstatic.com/generate_204
    interval: 300
    tolerance: 50
    use:
      - Airport

rule-providers:
  proxy:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/proxy.txt"
    path: ./rules/proxy.yaml
    interval: 3600
    proxy: Proxy

  direct:
    type: http
    behavior: domain
    url: "https://cdn.jsdelivr.net/gh/Loyalsoldier/clash-rules@release/direct.txt"
    path: ./rules/direct.yaml
    interval: 3600
    proxy: Direct

rules:
  - RULE-SET,proxy,Proxy
  - RULE-SET,direct,DIRECT
  - MATCH,Proxy
```

### 验证

普通代理端口验证：

```bash
curl -I --proxy http://127.0.0.1:7890 https://www.google.com
```

如果开启了 TUN，可以进一步清空 Shell 代理环境变量，不使用 `--proxy` 直接验证：

```bash
unset http_proxy https_proxy all_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY
curl -I https://www.google.com
```

如果不指定代理也能正常返回 HTTP 状态码，基本可以判断 TUN 已经接管系统流量。

### 在线管理

打开 [MetacubeXD](https://metacubex.github.io/metacubexd/)，填写：

- 后端地址：`http://<服务器公网 IP>:9090`

- 密钥：`config.yaml` 中的 `secret` 字段

如果页面没有反应，通常是浏览器拦截了从 HTTPS 页面访问 HTTP 后端的请求。可以在浏览器网站设置中允许不安全内容，或者将 `9090` 端口通过 HTTPS 服务暴露。

## 方案二：通过 SSH 反向端口转发复用本地代理

如果远程服务器只是临时需要联网，或者没有权限部署 Mihomo，更简单的方式是让服务器复用本地电脑的代理。

前提是本地电脑已经有代理客户端。例如本地代理监听在 `127.0.0.1:7890`。

### 核心原理

在普通 SSH 登录命令中添加 `-R` 参数：

```bash
ssh -R 7890:127.0.0.1:7890 user@server.example
```

`-R` 表示 Reverse Port Forwarding，也就是反向端口转发。它的含义是：登录到远程服务器，并让远程服务器上的 `7890` 端口转发到本地机器的 `127.0.0.1:7890`。

默认情况下，远程机器上的 `7890` 只监听 `127.0.0.1`，因此只有远程机器自己能访问，其他机器无法访问。此时在服务器上访问 `127.0.0.1:7890`，就等同于访问本地电脑的代理端口。

也可以写入本地 `~/.ssh/config`：

```
Host MyServer
    HostName server.example
    User user
    RemoteForward 7890 127.0.0.1:7890
```

之后使用 `ssh MyServer` 登录时，会自动建立反向端口转发。

### 配置 Shell 代理

登录远程服务器后，设置环境变量：

```bash
export http_proxy="http://127.0.0.1:7890"
export https_proxy="http://127.0.0.1:7890"
export all_proxy="http://127.0.0.1:7890"
```

然后验证：

```bash
curl -I https://www.google.com
```

若返回 `HTTP/1.1 200 OK`、`HTTP/2 200` 或重定向状态码，说明配置成功。

### 配置 VS Code Remote 代理

VS Code Server 和扩展通常不完全依赖 Shell 环境变量，建议在远程设置中显式指定。

编辑远程服务器上的 VS Code 设置文件：

```bash
vim ~/.vscode-server/data/Machine/settings.json
```

加入或合并以下配置：

```json
{
  "http.proxy": "http://127.0.0.1:7890",
  "http.proxyStrictSSL": false,
  "http.proxySupport": "on",
  "remote.env": {
    "HTTP_PROXY": "http://127.0.0.1:7890",
    "HTTPS_PROXY": "http://127.0.0.1:7890",
    "ALL_PROXY": "http://127.0.0.1:7890"
  }
}
```

保存后重载 VS Code 窗口。此时扩展安装、GitHub Copilot、部分 AI 插件一般就能正常访问网络。