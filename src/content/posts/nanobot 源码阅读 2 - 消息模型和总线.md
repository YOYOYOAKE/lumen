---
title: nanobot 源码阅读 2 - 消息模型和总线
description: nanobot 使用消息总线将 Channel 和 Agent 解耦。
tags:
  - LLM/Agent
createdAt: '2026-06-10'
updatedAt: '2026-06-15'
---

消息模型和总线的代码加起来也不过 100 行，但它是整个项目解耦的关键。

Channel、Agent、WebUI、CLI、Cron 最终都靠同一套 `InboundMessage` / `OutboundMessage` + MessageBus 通信。

## 1 消息模型

文件 `nanobot/bus/events.py` 定义消息数据模型。

### 1.1 InboundMessage

`InboundMessage` 表示**从外部进入 Agent 的消息**。

```python
@dataclass
class InboundMessage:
    """Message received from a chat channel."""

    channel: str  # telegram, discord, slack, whatsapp
    sender_id: str  # User identifier
    chat_id: str  # Chat/channel identifier
    content: str  # Message text
    timestamp: datetime = field(default_factory=datetime.now)
    media: list[str] = field(default_factory=list)  # Media URLs
    metadata: dict[str, Any] = field(default_factory=dict)  # Channel-specific data
    session_key_override: str | None = None  # Optional override for thread-scoped sessions

    @property
    def session_key(self) -> str:
        """Unique key for session identification."""
        return self.session_key_override or f"{self.channel}:{self.chat_id}"
```

这里最重要的是三个身份字段：

- `channel` 是来源平台，比如 Telegram、Discord 等；

- `chat_id` 是平台内的会话目标，比如群、私聊、线程；

- `sender_id` 是发送者身份。

nanobot 使用 `session_key` 区分不同的会话：

```python
return self.session_key_override or f"{self.channel}:{self.chat_id}"
```

所以一条 Telegram 消息默认 `session_key` 可能是 `telegram:123456`。默认格式可以用 `session_key_override` 覆盖。

### 1.2 OutboundMessage

`OutboundMessage` 表示 **Agent 要发回外部平台的消息**。

```python
@dataclass
class OutboundMessage:
    """Message to send to a chat channel.

    ``metadata`` can carry routing (``message_id``, …), trace flags (``_progress``),
    and optional ``OUTBOUND_META_AGENT_UI`` blobs for rich clients; non-WebUI
    channels may ignore unknown keys.
    """

    channel: str
    chat_id: str
    content: str
    reply_to: str | None = None
    media: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
    buttons: list[list[str]] = field(default_factory=list)
```

`OutboundMessage` 使用 `channel` 和 `chat_id` 决定消息发往哪里。

`metadata` 是这个消息模型里最灵活、也最需要留意的字段。它既承载平台私有信息，也承载内部控制标记。常见内部标记包括：

- `_wants_stream`：Channel 告诉 Agent 这个会话支持流式输出。

- `_stream_delta`：这是一个流式文本片段。

- `_stream_end`：当前流式段结束。

- `_progress`：这是进度消息，不是最终回复。

- `_tool_hint`：工具提示类进度。

- `_reasoning_delta` / `_reasoning_end`：模型 reasoning/thinking 流。

- `_file_edit_events`：WebUI 用来展示文件编辑活动。

- `_retry_wait`：Provider 重试等待提示。

- `_runtime_control`：内部运行时控制消息，比如 MCP reload。

这些标记大多不会改变消息模型本身，而是让 `ChannelManager` 或具体 Channel 决定怎么展示、过滤或路由。

## 2 消息总线

文件 `nanobot/bus/events.py` 定义消息总线。

MessageBus 是 `inbound` 和 `outbound` 双队列：

- `inbound`：Channel -> Agent

- `outbound`：Agent -> Channel

```python
class MessageBus:
    """
    Async message bus that decouples chat channels from the agent core.

    Channels push messages to the inbound queue, and the agent processes
    them and pushes responses to the outbound queue.
    """

    def __init__(self):
        self.inbound: asyncio.Queue[InboundMessage] = asyncio.Queue()
        self.outbound: asyncio.Queue[OutboundMessage] = asyncio.Queue()

    async def publish_inbound(self, msg: InboundMessage) -> None:
        """Publish a message from a channel to the agent."""
        await self.inbound.put(msg)

    async def consume_inbound(self) -> InboundMessage:
        """Consume the next inbound message (blocks until available)."""
        return await self.inbound.get()

    async def publish_outbound(self, msg: OutboundMessage) -> None:
        """Publish a response from the agent to channels."""
        await self.outbound.put(msg)

    async def consume_outbound(self) -> OutboundMessage:
        """Consume the next outbound message (blocks until available)."""
        return await self.outbound.get()

    @property
    def inbound_size(self) -> int:
        """Number of pending inbound messages."""
        return self.inbound.qsize()

    @property
    def outbound_size(self) -> int:
        """Number of pending outbound messages."""
        return self.outbound.qsize()
```

### 2.1 入方向

以所有 Channel 的公共逻辑为例，`BaseChannel._handle_message() (nanobot/channels/base.py, line 199)`  做这些事：

- 先检查发送者是否允许访问；

- 如果 channel 支持 `streaming`，就给 `metadata` 加 `_wants_stream=True`；

- 构造 `InboundMessage` ；

- 最后，调用：
  ```python
  # nanobot/channels/base.py, line 247
  
  await self.bus.publish_inbound(msg)
  ```

所以 Channel 不直接调用 Agent，只把消息放进 `inbound` 队列。

随后，这条消息在 AgentLoop 中被消费：

```python
# nanobot/agent/loop.py, line 840

msg = await asyncio.wait_for(self.bus.consume_inbound(), timeout=1.0)
```

### 2.2 出方向

Agent 处理完成后，会把 `OutboundMessage` 放进 `outbound` 队列。

```python
# nanobot/agent/loop.py, line 962

await self.bus.publish_outbound(response)
```

如果是流式输出，AgentLoop 会构造 `_stream_delta` 消息和 `_stream_end` 消息，同样走 outbound 队列。

随后 ChannelManager 消费 `outbound`：

```python
# nanobot/channels/manager.py, line 297

msg = await self.bus.consume_outbound()
```

然后根据 metadata 做分发处理：

- reasoning 消息只发给支持 reasoning 的 channel；

- progress 消息会受 `send_progress` / `send_tool_hints` 配置控制；

- stream delta 会合并相邻片段，减少平台 API 调用；

- 普通消息会做重复抑制，然后调用具体 channel 的 `send()`；

- 流式消息会调用具体 channel 的 `send_delta()`。

## 3 总结

因此，一条普通聊天消息路径是：

Telegram/WebSocket/CLI
-> `BaseChannel._handle_message()`
-> `InboundMessage`
->` bus.publish_inbound()`
-> `AgentLoop.run()`
-> `AgentLoop._dispatch()`
-> `AgentLoop._process_message()`
-> `AgentRunner / Provider / ToolRegistry`
-> `OutboundMessage`
-> `bus.publish_outbound()`
-> `ChannelManager._dispatch_outbound()`
-> `channel.send()` 或 `channel.send_delta()`

这个设计的好处是 Channel 和 Agent 没有直接依赖。新增一个 Channel，只要能生产 InboundMessage、消费 OutboundMessage 就行；Agent 不关心消息来自 Telegram、WebUI 还是 CLI。
