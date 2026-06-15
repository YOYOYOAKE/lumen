---
title: nanobot 源码阅读 1 - 项目启动与装配
description: 这是 nanobot gateway 的总入口，负责 MessageBus、CronService、SessionManager、AgentLoop、ChannelManager
  的创建与装配。
tags:
  - LLM/Agent
createdAt: '2026-06-10'
updatedAt: '2026-06-15'
---

> [!tip] 本系列以 Nanobot 0.2.1 的源代码为例来分析，对应的 Commit Hash 为  `f309982bb0a2dca76dd038473ee6f1be803bd503`。

`_run_gateway()` 是 gateway 模式的总装配函数。它本身不直接处理用户消息，而是把 Agent、Channel、Cron、WebUI 网关、消息总线组装起来，然后一起启动。

函数入口位于 `nanobot/cli/commands.py (line 870)` 。

`_run_gateway()` 做四件事：

1. 初始化运行时依赖：配置、workspace、bus、provider、session、cron。

1. 创建 `AgentLoop`，让它负责真正的 Agent 推理和工具调用。

1. 创建 `ChannelManager`，让各种 channel/WebUI 可以收发消息。

1. 启动主异步任务：`cron.start()`、`agent.run()`、`channels.start_all()`、可选 health server、可选自动打开浏览器。

## 1 基础运行时装配

开头先确定端口，并同步 workspace 模板：

```python
# nanobot/cli/commands.py (line 892)

port = port if port is not None else config.gateway.port
sync_workspace_templates(config.workspace_path)
bus = MessageBus()
```

这里的 `MessageBus` 是核心中转站。Channel 收到用户消息后写入 inbound 队列，Agent 处理后写入 outbound 队列，ChannelManager 再把 outbound 发回平台。

随后构造 provider：

```python
# line 897

provider_snapshot = build_provider_snapshot(config)
```

`provider_snapshot` 里包含当前 provider、model、context window、配置签名。这里提前构造，是为了启动失败时尽早暴露 API key、provider 配置等问题。

然后创建 SessionManager 和 CronService：

```python
# line 902

session_manager = SessionManager(config.workspace_path)
cron = CronService(cron_store_path)
```

`SessionManager` 负责会话历史持久化，`CronService` 负责提醒、Dream、Heartbeat 等定时任务。

## 2 创建 AgentLoop

```python
# line 913

agent = AgentLoop.from_config(
    config, bus,
    provider=provider_snapshot.provider,
    model=provider_snapshot.model,
    context_window_tokens=provider_snapshot.context_window_tokens,
    cron_service=cron,
    session_manager=session_manager,
    image_generation_provider_configs=image_gen_provider_configs(config),
    provider_snapshot_loader=load_provider_snapshot,
    runtime_model_publisher=lambda model, preset: publish_runtime_model_update(...),
    provider_signature=provider_snapshot.signature,
)
```

这里把 `bus`、`provider`、`cron`、`session_manager` 注入 Agent。之后 AgentLoop 就可以：

- 接收 bus inbound 消息；

- 加载会话历史；

- 构建上下文；

- 调用模型；

- 执行工具；

- 保存 session；

- 发布 outbound 消息。

`provider_snapshot_loader=load_provider_snapshot` 表示运行过程中可以重新读取 provider 配置，实现模型/配置热更新。`runtime_model_publisher` 则把模型变更通知 WebSocket/WebUI。

## 3 封装主动投递函数

```python
# line 940

async def _deliver_to_channel(
    msg: OutboundMessage, *, record: bool = False, session_key: str | None = None,
) -> None:
    ...
```

它用于 Agent 主动给某个 channel 发消息，典型场景是 cron reminder 或 `message` 工具。

主动投递消息的逻辑是：如果 `record=True`，且不是 CLI，且内容非空，就把这条主动发送的 assistant 消息也写入对应 session；然后调用 `bus.publish_outbound(msg)`，交给 `ChannelManager` 真正发出去。

此外，这个函数还处理了 unified session：

```python
# line 933

UNIFIED_SESSION_KEY if config.agents.defaults.unified_session else f"{channel}:{chat_id}"
```

所以主动投递时也能写到正确会话里。

随后把这个发送函数注入 `MessageTool`：

```python
# line 972

message_tool.set_send_callback(_deliver_to_channel)
```

也就是说，模型调用 `message` 工具时，最终会走 `_deliver_to_channel()`。

## 4 定义 cron job

```python
# line 977

async def on_cron_job(job: CronJob) -> str | None:
    ...
```

它是 `CronService` 的回调：

```python
# line 1106

cron.on_job = on_cron_job
```

函数内部定义了三类 job：

- Dream：内部记忆整理任务，直接调用 `agent.dream.run()`，不走普通用户消息链路。

- Heartbet：读取 workspace 下的 `HEARTBEAT.md`，如果有 active tasks，就构造 prompt 调 `agent.process_direct()`。生成回复后再用 `evaluate_response()` 判断是否值得通知用户。判断失败则静默。

- 普通提醒：构造提醒 prompt，调用 `agent.process_direct()`，然后根据 `job.payload.deliver` 决定是否投递到 channel。这里会临时设置 `CronTool` 和 `MessageTool` 的上下文，避免重复发送或记录错误。
  ```python
  # 预定时间已到。现在向用户发送此提醒，
  # 以简洁自然的语言直接告知他们——
  # 无需叙述进度、总结、包含用户 ID 或添加“已完成”、“已提醒”等状态报告。
  
  reminder_note = (
      "The scheduled time has arrived. Deliver this reminder to the user now, "
      "as a brief and natural message in their language. Speak directly to them — "
      "do not narrate progress, summarize, include user IDs, or add status reports "
      "like 'Done' or 'Reminded'.\n\n"
      f"Reminder: {job.payload.message}"
  )
  ```

## 5 创建 ChannelMessager

```python
# line 1117

channels = ChannelManager(
    config,
    bus,
    session_manager=session_manager,
    webui_runtime_model_name=_webui_runtime_model_name,
    webui_static_dist=webui_static_dist,
    webui_runtime_surface=webui_runtime_surface,
    webui_runtime_capabilities=webui_runtime_capabilities,
)
```

`ChannelManager` 会根据配置启用 channel。WebUI 也是通过 websocket channel 接入的，所以这里会把 `session_manager` 等对象传进去，让 WebUI 能读会话、设置、媒体、workspace 信息。

## 6 注册系统定时任务

在这里注册 Dream 和 Heartbat 任务。

```python
# line 1198

# Register Dream system job (idempotent on restart)
dream_cfg = config.agents.defaults.dream
if dream_cfg.model_override:
    agent.dream.model = dream_cfg.model_override
agent.dream.max_batch_size = dream_cfg.max_batch_size
agent.dream.max_iterations = dream_cfg.max_iterations
agent.dream.annotate_line_ages = dream_cfg.annotate_line_ages
from nanobot.cron.types import CronJob, CronPayload, CronSchedule
if dream_cfg.enabled:
    cron.register_system_job(CronJob(
        id="dream",
        name="dream",
        schedule=dream_cfg.build_schedule(config.agents.defaults.timezone),
        payload=CronPayload(kind="system_event"),
		))
    console.print(f"[green]✓[/green] Dream: {dream_cfg.describe_schedule()}")
else:
    console.print("[yellow]○[/yellow] Dream: disabled")
    
# Register Heartbeat system job (idempotent on restart)
if hb_cfg.enabled:
    cron.register_system_job(CronJob(
        id="heartbeat",
        name="heartbeat",
        schedule=CronSchedule(
		        kind="every",
		        every_ms=hb_cfg.interval_s * 1000,
		        tz=config.agents.defaults.timezone,
		    ),
		    payload=CronPayload(kind="system_event"),
		))
```

如果 `dream.enabled`，注册 id 为 `dream` 的系统 job；如果 `gateway.heartbeat.enabled`，注册 id 为 `heartbeat` 的系统 job。

这两个都是 `register_system_job()`，重启时保持幂等。

## 7 健康检查

`_health_server()` 在 `line 1156`，只提供一个轻量 `/health` HTTP 响应。

## 8 自动打开浏览器

`_open_browser_when_ready()` 在 `line 1230`，会等待 gateway 端口可连接，再打开 `open_browser_url` 。

## 9 启动 gateway

直到 `run() (line 1253)` 才是最终的异步服务入口。nanobot gateway 在这里启动 Agent：

```python
# line 1255

await cron.start()
tasks = [
    agent.run(),
    channels.start_all(),
]
```

```python
# line 1264

await asyncio.gather(*tasks)
```

关闭时的 `finally` 也很重要：

```python
# line 1272

await agent.close_mcp()
cron.stop()
agent.stop()
await channels.stop_all()
agent.sessions.flush_all()
```

它负责关闭 MCP、停止 cron、停止 Agent、停止 channel，并把缓存中的 session 全部落盘，避免退出时丢会话。
