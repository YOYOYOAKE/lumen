---
title: '[重置] nanobot 源码解析 3 - Agent Loop 与 Agent Runner'
description: nanobot 使用一套完善的 Turn 状态机驱动 Agent Loop。本文就 Trun 状态机和 Agent Runner 展开介绍。
tags:
  - LLM/Agent
createdAt: '2026-06-30 10:41:00'
updatedAt: '2026-07-03 15:34:00'
---

终于到最核心的部分了！不论是 nanobot，还是 OpenClaw 或 Hermes，都离不开 Agent Loop。可以说，Agent Loop 就是驱动整个项目运行的心脏。

nanobot 的 Agent Loop 本质上是一个**事件驱动的状态机**。它等用户发消息过来，然后经过一系列步骤把消息变成 LLM 能理解的上下文、调用大模型、执行模型要求的工具、最后把结果发回去。

这需要 **Message Bus**、**Agent Loop** 和 **Agent Runner** 协调工作。Message Bus 此前已经有过详细介绍，同时还介绍了 nanobot 的半边（Channel）。本文接着介绍另外半边，也就是 Agent Loop。

## 1 Agent Loop

### 1.1 Agent Loop 主循环

在项目初始化时，使用 `AgentLoop.run()` （`nanobot/agent/loop.py` ）启动 Agent Loop 主循环。与 Channel Manager 一样，它也是一个无限 while 循环。

主循环的工作很简单。首先，从 Message Bus 取一条消息：

```python
msg = await asyncio.wait_for(self.bus.consume_inbound(), timeout=1.0)
```

然后判断这条消息是不是 `/stop` 等**优先指令**。对于优先指令，直接 await **同步执行**：

```python
if self.commands.is_priority(raw):
    await self._dispatch_command_inline(
        msg, effective_key, raw,
        self.commands.dispatch_priority,
    )
    continue
```

如果当前会话已经有一条正在处理的消息了，就把新消息塞进 `pending_queue` ：

```python
if effective_key in self._pending_queues:
    self._pending_queues[effective_key].put_nowait(pending_msg)
```

如果消息既不是特殊命令、会话还处于空闲状态，那么直接创建**后台任务**处理这条新消息：

```python
task = asyncio.create_task(self._dispatch(msg))
```

### 1.2 消息处理状态机

这是整个 Agent Loop 最核心的设计。`_process_message()` 是一个**显式状态机**。一次 turn（用户发一条消息到 Agent 回复完成）要经过 8 个状态：

```python
RESTORE → COMPACT → COMMAND → BUILD → RUN → SAVE → RESPOND → DONE
```

状态转换由 `_TRANSITIONS` 表驱动，每个状态的处理函数返回一个**事件字符串**，**查表**得到下一个状态。

```python
class TurnState(Enum):
    RESTORE = auto()   # 恢复未完成的 checkpoint
    COMPACT = auto()   # 检查是否需要记忆压缩
    COMMAND = auto()   # 判断是否为内置指令
    BUILD = auto()     # 组装 LLM 上下文
    RUN = auto()       # 执行 LLM + 工具循环
    SAVE = auto()      # 持久化本轮对话
    RESPOND = auto()   # 发送回复给用户
    DONE = auto()      # 结束

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

可以看到大体上是**线性结构**。唯一的分叉点是 COMMAND：匹配到了走 `shortcut` 直达 `DONE`，没匹配到走 `dispatch` 进入正常流程。

状态机由一个 while 循环驱动：

```python
while ctx.state is not TurnState.DONE:
    handler_name = f"_state_{ctx.state.name.lower()}"
    handler = getattr(self, handler_name, None)
    
    event = await handler(ctx)
    
    next_state = self._TRANSITIONS.get((ctx.state, event))
    ctx.state = next_state
```

大致逻辑为，**查表**得到处理该状态的 handler，处理完成后查表获得下一个状态并修改。

接下来看看每个状态都做了什么。

<!-- unknown: heading_4 -->

**RESTORE** 用于恢复中断现场，handler 是 `_state_restore()`*。*

Agent Runner 在工具执行前后会通过 `_emit_checkpoint()` 回调把当前状态（例如 LLM 说了什么、哪些工具已完成、哪些工具还在跑）写入**会话元数据**。

如果发生中断，RESTORE 阶段就会把它读出来，再合并进**会话历史**。这样在打断后，下个 turn 的 LLM 能看到**完整的上下文**，而不至于丢失信息。

如果用户消息刚写入会话就崩溃了，连 LLM 的消息都没来得及生成。这时候补一条错误标记，把 turn 结束。

<!-- unknown: heading_4 -->

**COMPACT** 用于压缩上下文，handler 是 `_state_compact()`。它主要做会话的超时自动压缩，也就是我们在 Agent Loop 初始化中创建的 **AutoCompact** 组件。

```python
ctx.session, pending = self.auto_compact.prepare_session(ctx.session, ctx.session_key)
```

<!-- unknown: heading_4 -->

**COMMAND** 用于指令匹配，handler 是 `_state_command()`。它遍历所有已注册的指令，用正则匹配用户输入。

如果匹配到了**指令**，就执行并返回 `OutboundMessage`，返回 `"shortcut"` 跳过后续流程，直接 DONE。

没匹配到说明是**普通对话**，返回 `"dispatch"` 进入 BUILD。

<!-- unknown: heading_4 -->

**BUILD** 用于组装上下文，handler 是 `_state_build()` 。它调用 `ContextBuilder.build_messages()` 构造发送给 LLM 的消息列表，并**提前把用户消息写入 Session**。

```python
ctx.initial_messages = self._build_initial_messages(
    ctx.msg,
    ctx.session,
    ctx.history,
    ctx.pending_summary,
)
```

最终产出的消息列表结构大概是：

- `[0]` system：身份定义 + `AGENTS.md` + `SOUL.md` + `USER.md` + skills + memory

- `[1]` user：会话压缩总结（如果有）

- `[2]` assistant：历史消息（如果有）

- …

- `[n]` user：当前用户消息 + Runtime Context（时间、工作目录等）

<!-- unknown: heading_4 -->

**RUN** 执行 Agent Loop，handler 是 `_state_run()` 。

```python
result = await self._run_agent_loop(
    ctx.initial_messages,
    session=ctx.session,
    channel=ctx.msg.channel,
    chat_id=ctx.msg.chat_id,
    message_id=ctx.msg.metadata.get("message_id"),
    metadata=ctx.msg.metadata,
    ...
)
```

`_run_agent_loop()` 是一个胶水层，它会构造包含**初始消息、工具注册表、各种预算和配置**的 `AgentRunSpec`：

```python
spec = AgentRunSpec(
		initial_messages=initial_messages,
		tools=self.tools,
		model=self.model,
		max_tool_result_chars=self.max_tool_result_chars,
		...
)
```

随后调用 `self.runner.run(spec)`，进入 LLM-工具迭代循环。

```python
result = await self.runner.run(spec)
```

并根据结果进行不同的处理：

```python
if result.stop_reason == "max_iterations":
    logger.warning("Max iterations ({}) reached", self.max_iterations)
    ...
elif result.stop_reason == "error":
   logger.error("LLM returned error: {}", (result.final_content or "")[:200])
    ....
return result.final_content, result.tools_used, result.messages, result.stop_reason, result.had_injections
```

<!-- unknown: heading_4 -->

**SAVE** 将**持久化**本次工作，handler 是 `_state_save()` 。该状态调用 `_save_turn()` 对每条消息做清理后加入 Session 消息，例如**超长工具结果截断**、**base64 图片替换为占位文本**、**Runtime Context 块剥离**、**空 assistant 消息跳过**。

```python
self._save_turn(
    ctx.session, ctx.all_messages, ctx.save_skip,
    turn_latency_ms=ctx.turn_latency_ms,
)
```

如果 Session 超过了压缩阈值，还会对 Session 进行**后台压缩**，这样用户不用等压缩跑完才收到回复：

```python
self._schedule_background(
    self.consolidator.maybe_consolidate_by_tokens(
        ctx.session,
        replay_max_messages=self._max_messages,
    )
)
```

<!-- unknown: heading_4 -->

**RESPOND** 发送回复，handler 为 `_state_respond()` 。

```python
ctx.outbound = self._assemble_outbound(
    ctx.msg,
    ctx.final_content,
    ctx.all_messages,
    ctx.stop_reason,
    ctx.had_injections,
    ctx.on_stream,
    turn_latency_ms=ctx.turn_latency_ms,
)
```

`_assemble_outbound()` 构造 Outbound Message，并附上把 stream 标记、延迟等元信息。

```python
return OutboundMessage(
    channel=msg.channel,
    chat_id=msg.chat_id,
    content=final_content,
    metadata=meta,
)
```

组装好的 `ctx.outbound` 由 `_process_message()` 的调用方发布到 Message Bus。

## 2 Agent Runner

 前面讲状态机时提到 RUN 状态调用了胶水层 `_run_agent_loop()`，而真正干活的是 `AgentRunner.run()`（`nanobot/agent/runner.py`）。

Agent Runner 负责 Agent 最核心的行为：反复调用 LLM、执行工具、返回结果，直到 LLM 给出**最终回复**或**迭代次数耗尽**。其输入输出由 `AgentRunSpec` 和 `AgentRunResult` 定义。

`AgentRunSpec` 是**运行参数**，包括**初始消息**、**工具注册表**、**模型名**、**最大迭代次数**、**截断长度**、**上下文窗口**等。它是一个纯配置对象，不携带运行时状态。

`AgentRunResult` 是**运行结果**，包括**最终回复文本、完整消息列表、**用过的工具列表、token 用量等信息。

接下来看 `AgentRunner.run()` 方法。

### 2.1  Runner 主循环

Runner 主循环的核心结构是一个 `for iteration in range(spec.max_iterations)`，每次迭代都会进行**上下文治理**、**调用 LLM**、**处理 LLM 工具请求**、**处理 LLM 最终响应**。

```python
for iteration in range(spec.max_iterations):
		# 上下文治理
    messages_for_model = self._drop_orphan_tool_results(messages)
    ...
    
    # 调用 LLM
    response = await self._request_model(spec, messages_for_model, hook, context)
    
    # 处理 LLM 工具请求
    if response.should_execute_tools:
        ...
        continue
        
    # 处理 LLM 最终响应
    if response.finish_reason != "error"
        ...
    if response.finish_reason == "length"
        ...
        
return AgentRunResult(...)
```

<!-- unknown: heading_4 -->

每次调用 LLM 前，都要整理一下消息列表。这里包括**删除孤立工具结果**、**回填缺失的工具结果**、**压缩旧工具结果**、**计算工具结果长度预算**、**裁剪消息历史**。

```python
messages_for_model = self._drop_orphan_tool_results(messages)
messages_for_model = self._backfill_missing_tool_results(messages_for_model)
messages_for_model = self._microcompact(messages_for_model)
messages_for_model = self._apply_tool_result_budget(spec, messages_for_model)
messages_for_model = self._snip_history(spec, messages_for_model)

messages_for_model = self._drop_orphan_tool_results(messages_for_model)
messages_for_model = self._backfill_missing_tool_results(messages_for_model)
```

这里的 `messages_for_model` 是原始消息列表 `messages` 的一份**副本**。因为 `messages` 记录了整个 turn 的原始会话，最后 SAVE 阶段要用来持久化。

此外，你会发现 `_drop_orphan_tool_results()` 和 `_backfill_missing_tool_results()` 在流程的首尾各执行一次，这是因为裁剪消息历史时可能制造新的孤儿和缺失。

<!-- unknown: heading_4 -->

调用 LLM 是通过 `_request_model()` 来实现的。这里有**流式**、**进度流式**、**非流式**三种调用方式：

```python
if wants_streaming:
    coro = self.provider.chat_stream_with_retry(on_content_delta=_stream)
elif wants_progress_streaming:
    coro = self.provider.chat_stream_with_retry(on_content_delta=_stream_progress)
else:
    coro = self.provider.chat_with_retry(...)
```

流式和非流式就是字面意思，而所谓的进度流式是指**不需要逐字渲染但需要展示“正在思考”状态的场景**。

<!-- unknown: heading_4 -->

拿到 LLM 响应后，又要按照三种情况去处理。

第一种情况是 **LLM 要求执行工具**。当 LLM 返回 Tool Calls 后，把 assistant 消息追加到 `messages`：

```python
assistant_message = build_assistant_message(...)
messages.append(assistant_message)
```

接着执行工具：

```python
results, new_events, fatal_error = await self._execute_tools(
    spec,
    response.tool_calls,
    external_lookup_counts,
    workspace_violation_counts,
)
```

`_execute_tools()` 支持并发执行工具。工具执行结果将追加到 `messages`：

```python
for tool_call, result in zip(response.tool_calls, results):
    tool_message = {
        "role": "tool",
        "tool_call_id": tool_call.id,
        "name": tool_call.name,
        "content": self._normalize_tool_result(
            spec,
            tool_call.id,
            tool_call.name,
            result,
        ),
    }
    messages.append(tool_message)
    completed_tool_results.append(tool_message)
```

于是进入下一轮**迭代**。

第二种情况是**错误处理**。常见的有**空回复**、**回复超长截断**、**LLM 本身错误**、**迭代次数耗尽**等。

对于空回复，会重试最多 2 次（`_MAX_EMPTY_RETRIES`）。重试仍然空的话，将在消息末尾追加一条 `"Please provide your final response now."`，且不带 tools 定义，强制 LLM 产出文本。

回复因超长被截断时，将把已有内容作为 assistant 消息追加，再追加一条 `"Continue from where you were cut off..."` 的 user 消息。最多续写 3 次（`_MAX_LENGTH_RECOVERIES`）。

LLM 本身错误会在 messages 中追加一条占位 assistant 消息 `[Assistant reply unavailable due to model error.]`，保证 session 历史结构完整。

迭代次数耗尽时会向消息里追加一条“已达到最大迭代次数”的提示消息。

最后一种情况是**回复正常且非空**，就把 assistant 消息追加到 `messages`，退出循环。
