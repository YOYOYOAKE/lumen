---
title: '[重置] nanobot 源码解析 1 - 项目启动与组件装配'
tags:
  - LLM/Agent
createdAt: '2026-06-29 10:03:00'
updatedAt: '2026-06-29 17:33:00'
---

最近重新看了 nanobot 的源码，同时复盘了一下之前的笔记。朋友提到之前的笔记过于纠结细节，因此考虑重新写一篇笔记。

AI Agent 其实也符合二八定律，虽然它们的仓库个个都是动辄几万甚至十几万、几十万行代码的庞然大物，但是外围工程占据了 80% 的体积，而真正核心的 Agent 循环其实只有 20%，甚至更少。

所以**抓主干、放细节**就显得尤为重要。之前和代码绑的太死了，重置版可能更多地去讲解一种逻辑、理念、“为什么”。

与个人 AI Agent 先驱者 OpenClaw 和后来者 Hermes 一样，nanobot 做的事情很简单：

1. 接收来自各种聊天平台的消息；

1. 发给 LLM；

1. LLM 决定调用什么工具；

1. 执行工具；

1. 把结果返回给用户。

但围绕这个简单循环，nanobot 搭建了一整套实用系统，例如多平台接入、会话记忆、定时任务、WebUI、MCP 协议、文件系统操作、子 Agent 等。

考虑到 Gateway 模式用的最多，我们就以它来学习。

Gateway 模式的启动代码集中在 `nanobot/cli/commands.py` 的 `_run_gateway()` 函数中。这个函数按照一定的先后顺序初始化 Agent Loop 和 Channel 两个子系统，最后 `asyncio.gather` 把它们并发跑起来。

## 1 组件初始化

在初始化 Agent Loop 和 Channel 之前，需要先初始化各种组件。

### **1.1 消息总线**

消息总线（**Message Bus**）本质上一个 **inbound** 队列和一个 **outbound** 队列。很简单但很重要，Agent Loop 从 inbound 队列读、向 outbound 写，Channel 从 outbound 读、向 inbound 写。两个队列和 Agent Loop 与 Channel 一起组成了完成的消息传输逻辑。

```python
bus = MeaasgeBus()
```

### **1.2 模型提供者快照**

 模型提供者（Provider）从配置中读取模型配置（提供商、模型名、上下文窗口等），并据此实例化具体的 Provider，作为 Agent 的推理后端。

```python
provider_snapshot = build_provider_snapshot(config)
```

### 1.3 会话管理器

**会话（Session）管理器**用于管理用户在不同通道的对话记录（`workspace/sessions/*.jsonl`）。

```python
session_manager = SessionManager(workspace)
```

### 1.4 定时任务服务

**定时任务服务（Corn）**固定从 `workspace/corn/jobs.json` 中读取自定义定时任务，并注册 `dream` 和 `heartbeat` 两个系统任务。注意此时只是初始化，并没有实际运行。

```python
corn = CornService(corn_store_path)
cron.register_system_job("dream")
cron.register_system_job("heartbeat")
```

## 2 Agent Loop 初始化

四个大组件完成后，才**初始化 Agent Loop**。Agent Loop 接收前边创建的 `bus`、`provider_snapshot`、`session_manager`、`cron` ，以及配置文件中的各种参数，并在构造函数里完成工具注册、ContextBuilder、AgentRunner、SubagentManager、Consilidator、Dream、AutoCompact、CommandRunner 等全部子组件的初始化。

```python
agent = AgentLoop.from_config(...)
```

`AgentLoop.from_config()` 方法位于 `nanobot/agent/loop.py` 中。它本质上是一个**参数收集器**，从各个角落收集构造函数需要的约 30 个参数，随后触发 `__init__()`。

`from_config()`** **方法并**不是初始化方法**，只是把 config 中的字段翻译成构造函数的参数，真正的初始化都在 `__init__()` 里。在这里，项目会完成整理外部依赖、创建内部组件等工作。

### 2.1 整理外部依赖

`from_config()` 方法会用自己收集到的参数创建一个 **AgentLoop 实例**并返回，这些参数会被挂在 `self` 上。

```python
self.bus = bus
self.provider = provider
self.model = model or provider.get_default_model()
self.workspace = workspace
self.sessions = session_manager or SessionManager(workspace)
self.cron_service = cron_service
self.channels_config = channels_config
...
```

中间穿插着给参数补默认值、初始化一堆空字典和零值状态变量。

### 2.3 创建内部组件

然后会用已经存好的依赖去 new 出 Agent Loop 所需的子组件。大致有以下几个：

**ContextBuilder 用于构造上下文**，把系统身份、workspace 下的引导文件、记忆、技能说明、会话历史、当前消息、运行时元数据（时间、Channel、Sender）组装成发给 LLM 的 `messages` 列表。

```python
self.context = ContextBuilder(workspace, ...)
```

**ToolRegistry 是工具注册表**，本质就是一个 dict[str, Tool]。它提供注册、查询、生成 OpenAI function-calling 格式的工具。

```python
self.tools = ToolRegistry()
self._register_default_tools()
```

**AgentRunner 用于和 LLM 对话。**在拿到初始消息和列表后，循环调用 LLM 和工具，直到本次对话结束。

```python
self.runner = AgentRunner(provider)
```

**子 Agent 管理器 SubagentManager。**当 LLM 调 spawn 工具时，由 SubagentManager 创建独立的 agent 实例去执行子任务。

```python
self.subagents = SubagentManager(...)
```

**会话压缩器 Consolidator**。当未合并消息的 token 数接近窗口上限时，让 LLM 把旧消息提炼成摘要，下次只发送压缩后的消息。

```python
self.consolidator = Consolidator(...)
```

此外，如果一个会话太久没有活跃，基于 Consilidator 的 `AutoCompact` 会自动压缩该会话。

```python
self.auto_compact = AutoCompact(sessions, consolidator, session_ttl_minutes)
```

以及** Dream。**

```python
self.dream = Dream(...)
```

和**命令路由 CommandRouter**。它注册了 `/stop`、`/new`、`/goal`、`/history`、`/model` 等命令。消息进来后先过这里，命中就走快捷路径直接返回，不调 LLM。

```python
self.commands = CommandRouter()
```

## 3 Channel 初始化

Channel 只依赖 `bus` 和 `session_manager`。`bus` 是 Agent Loop 和 Channel 的通信管道，而二者互不知道对方的存在。`session_manager` 是二者共享的数据层，Agent Loop 向里边写数据，Channel 往外读，用于在 WebSocket Channel（如 WebUI 中）展示会话列表和历史。

```python
channels = ChannelManager(...)
```

也就是存在以下依赖关系：

| 共享组件 | Agent Loop | Channel |
| `bus` | ✅存为 `self.bus`，消费 inbound、生产 outbound | ✅存为 `self.bus`，消费 outbound、生产 inbound |
| `provider_snapshot` | ✅拆成 `provider`、`model`、`context_window_tokens` 分别传入 | ❌不关心 LLM |
| `session_manager` | ✅存为 `self.sessions`，写入会话 | ✅传给 WebScoket Channel，读会话 |
| `cron` | ✅存为 `self.cron_service`，注入 CronTool | ❌不关心定时任务 |

## 3 项目启动

全部初始化完成后，进入最后一段：`aysncio.run(run())`。这个 `run()` 协程只有二十几行，分为三步：启动 `corn`、并发启动 Agent Loop 和 Channel、关闭。

```python
async def run():
	try：
		await cron.start()
		await asyncio.gather(agent.run(), channels.start_all())
		
  except:
	  ...
	  
  finally:
    await agent.close_mcp()
    cron.stop()
    agent.stop()
    await channels.stop_all()
    agent.sessions.flush_all()
```

`cron.start()` 会首先启动，加载 `job`、计算下次触发时间、启动后台任务定时器，然后就结束了。

然后同时启动 `agent.run()` 和 `channels.start_all()` 两个协程。这两个协程内部都是 while 死循环，`agent` 消费 inbound，`channels` 消费 outbound，并发执行、互不阻塞。

二者一直通过消息总线协作，直到 gather 被打断，进入 finally 块，依次完成收尾工作。
