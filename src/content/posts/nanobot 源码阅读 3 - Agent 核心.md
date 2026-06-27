---
title: nanobot 源码阅读 3 - Agent 核心
description: nanobot 的 Agent 核心由两条主线构成：负责流程编排的 AgentLoop 和负责 LLM 对话循环的 AgentRunner。
tags:
  - LLM/Agent
createdAt: '2026-06-15'
updatedAt: '2026-06-15'
---

nanobot 的数据流可以简化为一条直线：

```go
Channel → MessageBus → AgentLoop → Channel
```

而 AgentLoop 是这条直线的核心，它不断从总线读取消息、思考、执行工具，然后回话。在 AgentLoop 内部，它又把自己的工作拆成两部分：

- AgentLoop（`loop.py`）：负责会话管理、上下文装配、持久化、命令路由等。

- AgentRunner（`runner.py`）：负责调用模型、接收响应、执行工具等。

## 1 Agent 消息入口

主循环在 `AgentLoop.run()` （`loop.py:833`）：

```python
while self._running:
    msg = await asyncio.wait_for(self.bus.consume_inbound(), timeout=1.0)
    # ...
    task = asyncio.create_task(self._dispatch(msg))
```

这里可以看到，AgentLoop 每从消息总线取到一条 `InboundMessage`。就创建一个 asyncio Task 去执行 `_dispatch`。

而 `_dispatch()`（`loop.py:910`） 是真正的消息处理入口，它做三件事：

第一，获取 session 锁（`loop.py:915`）。同一个 session 的消息必须串行处理，否则两条并发的消息会把上下文搞乱。

```python
lock = self._session_locks.setdefault(session_key, asyncio.Lock())
gate = self._concurrency_gate or nullcontext()

async with lock, gate:
    ...
```

第二，建立 Pending Queue（`loop.py:923`）。如果这个 session 已经在跑一个 AgentLoop，后来的消息会放入这个队列中，由正在跑的 Runner 在合适的时机注入到对话中。

```python
pending = asyncio.Queue(maxsize=20)
self._pending_queues[session_key] = pending
```

第三，进入状态机（`loop.py:958`）。

```python
response = await self._process_message(
    msg, on_stream=on_stream, on_stream_end=on_stream_end,
    pending_queue=pending,
)
```

## 2 状态机

`_process_message()`（`loop.py:1162`）是整个 turn 的驱动程序。它创建 `TurnContext`，然后在一个 while 循环（`loop.py:1202`）里跑状态机：

```python
ctx = TurnContext(msg=msg, state=TurnState.RESTORE, ...)

while ctx.state is not TurnState.DONE:
    handler = getattr(self, f"_state_{ctx.state.name.lower()}")
    event = await handler(ctx)           # 执行当前状态的处理逻辑，返回事件名
    next_state = self._TRANSITIONS[(ctx.state, event)]  # 查表找下一状态
    ctx.state = next_state
```

状态转换表在 `loop.py:162`：

```python
_TRANSITIONS: dict[tuple[TurnState, str], TurnState] = {
		(TurnState.RESTORE, "ok"): TurnState.COMPACT,
    (TurnState.COMPACT, "ok"): TurnState.COMMAND,
    (TurnState.COMMAND, "dispatch"): TurnState.BUILD,
    (TurnState.COMMAND, "shortcut"): TurnState.DONE,
    (TurnState.BUILD, "ok"): TurnState.RUN,
    (TurnState.RUN, "ok"): TurnState.SAVE,
    (TurnState.SAVE, "ok"): TurnState.RESPOND,
    (TurnState.RESPOND, "ok"): TurnState.DONE,
}
```

```
RESTORE -> COMPACT -> COMMAND -> BUILD -> RUN -> SAVE -> RESPOND -> DONE
                         ↓
                     (shortcut) -> DONE
```

下面逐一讲解每个状态做了什么。

### 2.1 RESTORE：恢复中断现场

位于 `loop.py:1289`。

如果上一轮因为 `/stop` 被取消了，当时 Runner 可能已经执行了几个工具调用但还没跑完。RESTORE 阶段检查 session metadata 里有没有之前 checkpoint 保存的中间状态，有就恢复到 session 历史里，这样下一轮 LLM 能看到这些工具结果而不是重复调用。

### 2.2 COMAPCT：空闲会话压缩

位于 `loop.py:1325`。

如果一个 session 很久没用（超过 `session_ttl_minutes`），后台的 `AutoCompact` 组件会调用 LLM 把旧对话总结成一段摘要。COMPACT 阶段检查摘要是否就绪，有就注入到当前 turn 的上下文里。

### 2.3 COMMAND：命令路由

位于 `loop.py:1330`。

判断消息是不是斜杠命令。如果是且命令能直接返回结果（如 `/start`），直接走 `shortcut` 跳到 DONE，否则走 `dispatch` 继续 BUILD。

不过，实际上 `/model` 这类命令是在 BUILD 之前就通过 `_dispatch_command_inline()` 直接执行掉的（`loop.py:862`），不会进入状态机。

### 2.4 BUILD：组装上下文

位于 `loop.py:1355`。

BUILD 阶段是最重要的阶段，按顺序做：

1. 消息压缩（`loop.py:1356`）。检查会话历史是否太长（超过上下文窗口的一定比例），如果太长就调用 LLM 把旧消息总结成摘要，减少 token 占用。由 `Consolidator.maybe_consolidate_by_tokens()` 执行。

1. 设置工具上下文（`loop.py:1360`）。给每个工具注入当前会话信息。
   ```python
   self._set_tool_context(
       ctx.msg.channel,
       ctx.msg.chat_id,
       ctx.msg.metadata.get("message_id"),
       ctx.msg.metadata,
       session_key=ctx.session_key,
   )
   if message_tool := self.tools.get("message"):
       if isinstance(message_tool, MessageTool):
           message_tool.start_turn()
   ```

1. 获取会话历史（`loop.py:1371`）。从 session 中取最近 N 条消息，受 `max_messages` 和 token 预算双重限制。

1. 构建消息列表（`loop.py:1383`）。调用 `ContextBuilder.build_messages()`（`context.py:179`），产物是一个完整的消息数组：
   ```python
   [system_prompt, ...history, user_content + runtime_context]
   ```
   System prompt 又由多个部分组成（`context.py:66`）：
   - Identity（工作区路径、平台、Python 版本）
   - Bootstrap 文件（`AGENTS.md` → `SOUL.md` → `USER.md`）
   - Tool contract（工具使用规范模板）
   - 长期记忆（`memory/MEMORY.md`）
   - Always-active skills
   - Skills 摘要
   - 近期历史记录
   - 归档摘要

1. 提前持久化用户消息（`loop.py:1389`）。先把用户的消息写入 session，防止崩溃丢消息。

### 2.5 RUN：执行 LLM 对话

位于 `loop.py:1400`。

调用 `_run_agent_loop()`，它创建 `AgentProgressHook`，组装 `AgentRunSpec`，然后委托给 `AgentRunner.run()`。这是整个系统的核心计算，留到第三节细讲。

### 2.6 SAVE：持久化

位于 `loop.py:1431`。

调用 `_save_turn()`（`loop.py:1520`）遍历本文新增的消息，截断 tool 结果、把 Runtime Context 块从 user 消息中剥离。然后存入 session 并调用 `sessions.save()`。同时触发后台 `consolidation` 和 `enforce_file_cap`（限制 session 文件数量）。

### 2.7 RESPOND：组装回复

位于 `loop.py:1465`。

`_assemble_outbound()` 把 `final_content` 打包成 `OutboundMessage`，包含频道、聊天 ID、元数据（是否流式、延迟等）。如果 MessageTool 已经在本轮主动发过消息，则抑制回复避免重复。

## 3 LLM 对话循环
