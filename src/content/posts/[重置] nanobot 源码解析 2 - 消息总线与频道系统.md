---
title: '[重置] nanobot 源码解析 2 - 消息总线与频道系统'
description: nanobot 借助消息总线实现了 Agent Loop 和 Channel 的完美解耦。本文介绍 nanobot 的消息总线机制，并讲解
  Channel 是如何与消息总线配合工作的。
tags:
  - LLM/Agent
createdAt: '2026-06-29 21:37:00'
updatedAt: '2026-06-30 10:36:00'
---

## 1 消息总线

**消息总线 Message Bus** 极其简单，两个文件加起来不到 80 行。核心就是两个 `asyncio.Queue`：

```python
class MessageBus:
    def __init__(self):
        self.inbound: asyncio.Queue[InboundMessage] = asyncio.Queue()
        self.outbound: asyncio.Queue[OutboundMessage] = asyncio.Queue()
```

同时定义四个方法，分别是**向 inbound 放**、**从 inbound 取**、**向 outbound 放**、**从 outbound 取**：

```python
async def publish_inbound(self, msg: InboundMessage) -> None:
	  ...
async def consume_inbound(self) -> InboundMessage:
    ...
async def publish_outbound(self, msg: OutboundMessage) -> None:
    ...
async def consume_outbound(self) -> OutboundMessage:
    ...
```

同时定义的两种**消息模型** `InboundMessage` 和 `OutboundMessage` 也非常简单。

**Inbound Message** 从 Channel 流向 Agent，携带着 `channel`、`sender_id`、`chat_id`、`content`、`media`等数据。

**Outbound Message** 从 Agent 流向 Channel。除了以上数据外，还多了 `reply_to` 和 `buttons` 等数据。

于是，Agent Loop 只知道从 inbound 中取出消息，处理好了直接放到 outbound 中；Channel 相反，把外部平台的消息放到 inbound 中，当 outbound 中有消息了再发出去。从而确保 Agent Loop 和 Channel 彻底解耦。

## 2 频道

**频道 Channel** 是 nanobot 与外部聊天平台之间的**桥梁**。每条 Channel 负责将特定平台（Telegram、Discord、Slack、微信、飞书等）的消息翻译成 **nanobot 的内部统一消息模型**，交给 Agent 处理后，再将回复翻译回该平台的原生消息发送出去。

目前 `nanobot/channels/` 下已经内置 15+ 个 Channel 实现，每个对应一个平台。

### 2.1 频道类的抽象基类

**所有 Channel 的抽象基类** `BaseChannel` 定义了三个 Channel 必须实现的方法，分别用来**启动 Channel**、**关闭 Channel** 和**向 Channel 发送消息**：

```python
class BaseChannel(ABC):
    @abstractmethod
    async def start(self) -> None:
	      ...
	  
    @abstractmethod
    async def stop(self) -> None:
	      ...
	  
    @abstractmethod
    async def send(self) -> None:
	      ...
```

此外，`BaseChannel` 还提供了其他可选方法，例如用于**发送流式消息**的 `send_delta()`、用于**权限检查**的 `is_allowed()`、用于**音频转录**的 `transcribe_audio()`。

还有一个最重要的 `_handle_message()` 方法：

```python
async def _handle_message(
    self,
    sender_id: str,
    chat_id: str,
    content: str,
    media: list[str] | None = None,
    metadata: dict[str, Any] | None = None,
    session_key: str | None = None,
    is_dm: bool = False,
) -> None:
    ...
```

这个方法会依次做以下几件事：

首先，调用 `self.is_allowed(sender_id)` 判断发送者是否有权限使用 nanobot。

鉴权通过后，组装 `metadata`，例如如果 Channel 支持流式传输，就在 `metadata` 中插入 `_wants_stream: True`。

随后构造 InboundMessage 实例，填入 `channel`、`sender_id`、`content` 等信息。

最后调用 `self.bus.publish_inbound(msg)` 入队。之后的 LLM 调用、工具执行、回复生成等由 Agent Loop 接管，Channel 不再参与。

### 2.2 频道管理器

`ChannelManager` 是**所有 Channel 的调度器**。它在上一节中我们介绍的**项目初始化阶段**被创建，负责管理所有 Channel 的完整生命周期，以及统一调度所有外发消息。

Channel Manager **被创建时**，同步执行 `_init_channels()` ，扫描所有内置和外部插件提供的 Channel 模块，并根据配置逐一实例化。

在**项目初始化**时会执行 `channels.start_all()`，这个方法会启动 `_dispatch_outbound()` 后台任务，并逐个调用 `channel.start()` 启动各个 Channel，它们各自连接到对应平台并开始监听消息。

 `_dispatch_outbound()` 后台是 Channel Manager 运行时的核心任务，本质是一个无限循环。在一次循环中：

首先从消息总线中取出一条 OutboundMessage：

```python
msg = await asyncio.wait_for(
    self.bus.consume_outbound(),
    timeout=1.0
)
```

然后判断消息类型并做分流，例如模型思维链、工具调用请求、流式传输片段、普通消息等。

当判断应该发送消息时，从 `msg.channel` 中找到对应的 Channel 实例，调用 `_send_with_retry()` 发送消息：

```python
channel = self.channels.get(msg.channel)
await self._send_with_retry(channel, msg)
```

在关闭时，`stop_all()` 先取消 `_dispatch_outbound()` 任务，再逐个调用 `channel.stop()` 断开各平台连接、清理资源。

`ChannelManager` 不关心消息的业务内容是什么，它管两件事：**管理 Channel 的生命周期**、**把出站消息送到正确的 Channel**。它和 Agent 核心之间只通过 `MessageBus` 的两个队列交互，双方完全解耦。
