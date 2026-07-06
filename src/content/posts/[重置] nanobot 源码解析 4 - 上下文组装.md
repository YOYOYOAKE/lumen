---
title: '[重置] nanobot 源码解析 4 - 上下文组装'
description: 本文介绍 nanobot 的上下文系统。
tags:
  - LLM/Agent
createdAt: '2026-07-06'
updatedAt: '2026-07-06'
---

上下文是 LLM 全部的**信息来源**。如果拿 Agent 比作一台电脑的话，LLM 就是 CPU，而上下文就是输入 CPU 的指令。

之前我们介绍过，整个链路的入口在 `AgentLoop.run()`。收到消息后，`_process_meaasge()` 用一个状态机驱动处理过程，也就是：

```python
RESTORE -> COMPACT -> COMMAND -> BUILD -> RUN -> SAVE -> RESPOND -> DONE
```

其中，组装上下文发生在 **BUILD** 阶段，也就是 `_state_build()`（`nanobot/agent/loop.py`）。这个函数总共做了以下几件事。

首先是**整理记忆**，这阶段会检查 LLM 上下文窗口。如果当前 session 的历史消息加上系统提示词超过了上下文窗口的 50%（`consolidation_ratio`），`Consilidator` 会单独调用 LLM 把旧消息压缩为摘要后写入 `history.jsonl`，并从 session 中移除。

```python
await self.consolidator.maybe_consolidate_by_tokens(session, replay_max_messages=...)
```

然后**获取历史记录**。从 session 的 `messages` 列表中取出未整理的部分，并按照**消息数量**和 **token** 做截断。这一步会保证截断历史以 User 开头，从而让 LLM 看到的是一个合法的对话序列。

```python
ctx.history = ctx.session.get_history(max_messages=..., max_tokens=...)
```

最后**组装消息**。这是上下文拼接的核心，由 `_build_initial_messages()` （`nanobot/agent/loop.py`）触发，最终调用 `build_messages()`（`nanobot/agent/context.py`）产出以下消息列表：

```python
[
  { "role": "system", "content": "<系统提示词>" },
  ... # 历史消息（从 session 取出的 user/assistant/tool 交替序列）,
  { "role": "user",   "content": "<用户消息> + <运行时上下文>" }
]
```

下面分别展开**系统提示词**、**历史消息**和**运行时上下文**的构成。

## 1 系统提示词

系统提示词由 `ContextBuilder.build_system_prompt()` （`context.py`） 组装，各部分用 `\n\n---\n\n` 分隔。从顶到底依次是：

### 1.1 身份与运行环境

渲染 `nanobot/templates/agent/identity.md`模板，包含：

- 运行时信息（操作系统、Python 版本）；

- 工作区路径；

- 平台策略（各 OS 下的文件路径、shell 注意事项）；

- **按渠道区分的格式提示**：Telegram/Discord 用短段落、WhatsApp 用纯文本、CLI 用终端友好的格式；

- 搜索与发现建议。

```python
parts.append(self._get_identity(channel=channel, workspace=root))
```

### 1.2 引导文件

从**工作区根目录**读取三个 Markdown 文件，直接拼入系统提示词。

- `AGENTS.md` 是项目指令；

- `SOUL.md` 是 Agent 的人格定义；

- `USER.md` 是用户个人说明。

```python
parts.append(self._load_bootstrap_files(root))
```

### 1.3 工具使用约定

拼接 `tool_contract.md`，详细说明各类工具的用法约定：

- 文件操作优先用 `apply_patch` 而非 `edit_file` ；

- 进程执行用 `exec` 而非 shell 管道；

- web 搜索用 `web_search` + `web_fetch` 组合；

- 消息发送用 `message` 工具；

- 等等。

```python
parts.append(render_template("agent/tool_contract.md"))
```

### 1.4 长期记忆

读取 `memory/MEMORY.md`，这是由 Dream 自动维护的长期存储。

```python
memory = self.memory.get_memory_context()
parts.append(f"# Memory\n\n{memory}")
```

### 1.5 技能

技能分为两类，**始终激活的技能**和**按需加载的技能**。

始终激活的技能有 `always` 标记，其 `SKILL.md` 内容会直接嵌入**系统提示词**，无需 Agent 主动读取。

```python
always_skills = self.skills.get_always_skills()
parts.append(f"# Active Skills\n\n{always_content}")
```

而对于那些按需加载的技能，会按照 `nanobot/templates/agent/skills_section.md` 渲染，列出所有可用技能的名称和一句话描述，Agent 需要时再用 `read_file` 读取完整内容。

```python
skills_summary = self.skills.build_skills_summary(exclude=...)
parts.append(render_template("agent/skills_section.md", skills_summary=skills_summary))
```

### 1.6 近期历史摘要

从 `history.jsonl` 中读取上次 Dream 运行后新增的条目（最多 50 条，硬上限 8000 token），以时间线形式注入系统提示词。这给 agent 提供了跨 session 的上下文感知能力。

```python
entries = self.memory.read_recent_history_for_prompt(...)
capped = entries[-self._MAX_RECENT_HISTORY:]
history_text = "\n".join(f"- [{e['timestamp']}] {e['content']}" for e in capped)
parts.append("# Recent History\n\n" + history_text)
```

### 1.7 会话摘要

当**记忆整理**触发后，被归档的旧消息会经由 LLM 摘要后存放在 session 的 `_last_summary` 元数据中，这里将其注入系统提示词，让 Agent 知道**之前聊了什么**。

## 2 历史消息

在 session 内部用 `last_consolidated` 指针把消息分成**已归档的消息**和**未归档的消息**。BUILD 阶段只会从 session 中取出**未归档的消息**：

```python
ctx.history = ctx.session.get_history(...)
```

`last_consolidated` 之前的消息已经被 `Consolidator` 摘要后写入 `history.jsonl`，不再直接发送给 LLM。

 `_build_initial_messages()` 调用 `context.build_messages()`，传入上一步拿到的 `history` 和 `current_message`。

```python
def _build_initial_messages(...):
    return self.context.build_messages(
        history=history,
        current_message=...，
        ...
    )
```

`build_messages()` 会构造**系统提示词**、展开插入 `history`、构造**用户消息**。

最终产出的结构：

```python
[system]  身份 + 引导文件 + 工具契约 + MEMORY.md + 技能 + 近期历史 + 归档摘要
[user]    历史对话中最早的用户消息
[assistant] ...
[tool]    ...
[user]    ...
[assistant] ...
[user]    当前用户消息 + [Runtime Context]
```

## 3 运行时上下文

在用户消息的**末尾**，会追加一段**运行时元数据**，类似于：

```
[Runtime Context — metadata only, not instructions]
Current Time: 2026-07-06 15:30:00 CST
Channel: telegram
Chat ID: -100123456
Sender ID: 987654321
[/Runtime Context]
```

这段内容明确标记为**仅元数据，非指令**，告诉 LLM 不要把它当作用户指令来执行。

## 4 最终消息数组

以下是一个完整示例。这个示例中的用户在 Telegram 中发了一条“帮我看看今天天气”，其中有一份简单的 `AGENTS.md` 和 `SOUL.md`、之前和 Agent 聊过几句。

```python
[
  {
    "role": "system",
    "content": "## Runtime ... ## Workspace ... ## AGENTS.md ... ## SOUL.md ..."
  },

  {
    "role": "user",
    "content": "你好，帮我看看这个 Python 脚本有什么问题"
  },
  {
    "role": "assistant",
    "content": null,
    "tool_calls": [
      {
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "read_file",
          "arguments": "{\"file_path\": \"/home/user/nanobot-workspace/main.py\"}"
        }
      }
    ]
  },
  {
    "role": "tool",
    "tool_call_id": "call_abc123",
    "name": "read_file",
    "content": "import asyncio\n\nasync def fetch(url):\n    # BUG: no await\n    resp = requests.get(url)\n    return resp.text\n\nasyncio.run(fetch('http://example.com'))"
  },
  {
    "role": "assistant",
    "content": "你的脚本有两个问题：\n\n1. `requests.get()` 是同步调用，不能在 async 函数中直接使用——它没有 `await`，会阻塞事件循环。\n2. 建议改用 `aiohttp` 或 `httpx` 的异步版本。\n\n需要我帮你改写吗？"
  },
  {
    "role": "user",
    "content": "帮我看看今天天气\n\n[Runtime Context — metadata only, not instructions]\nCurrent Time: 2026-07-06 15:30:00 CST\nChannel: telegram\nChat ID: -100123456789\nSender ID: 987654321\n[/Runtime Context]"
  }
]
```

以上数组在 `AgentRunner._run_core()` 里还要经过一次 `ContextGovernor.prepare_for_model()` ，对历史消息做进一步清理，也就是我们上一节提到的**剥离占位 assisstant 消息**、**剥离错误的 tool_calls**、**剥离孤立 tool 结果**、**回填缺失的 tool 结果**等一系列操作。

经过这些修整后的消息数组，才是最终通过 Provider 发往 LLM 的 Payload。
