---
title: '[重置] nanobot 源码解析 6 - 会话与记忆'
description: nanobot 的会话和记忆系统分别实现短期记忆和长期记忆。
tags:
  - LLM/Agent
createdAt: '2026-07-15 01:00:00'
updatedAt: '2026-07-15 02:18:00'
---

nanobot 的**会话**和**记忆**相互独立。

**会话（Session）**负责记录**单个聊天内部**的消息，如用户消息、LLM 回复、工具调用结果等。这些会话数据存放在 `workspace/session` 目录下的 JSONL 文件中，每个会话对应一个 JSONL。

而**记忆（Memory）**负责提炼从聊天中应该**长期记住**的信息。记忆系统将大量会话记录压缩成摘要，存入 `workspace/memory/history.jsonl` 和 `MEMORY.md` 中，让 LLM 在不同会话之间保持连贯。

会话通过 **Consolidator** 和 **Auto Compact** 转化为记忆。当会话消息**太长**时，Consolidator 会把旧消息压缩为摘要写入 `history.jsonl`；当会话**长时间不活跃**时，Auto Compact 会保留最近的 8 条消息，之前的消息做同样的压缩操作。

最后，**ContextBuilder** 在每一轮对话开始时，会拼接**会话历史**和**记忆**，并结合其他信息形成完整的 prompt 发给 LLM。

## 1 会话系统

### 1.1 会话消息管理

一条会话的数据结构由 `Session`（`nanobot/session/manager.py`）表示，它主要有以下几个属性：

- `key`：会话标识，格式为 `"channel:chat_id"`，如 `"telegram:123456"`。

- `messages`：消息列表。列表中的每个元素都是 `{role, content, timestamp, ...}`。

- `create_at`：会话创建时间。

- `update_at`：最后活跃时间。

- `metadata`：元数据，这是一个自由字典，包含任何可能需要的数据。

- `last_consolidated`：已归档的消息数量。它是一个 int 指针，把 `messages` 列表分成**已归档**和**未归档**两部分。

以及两个关键方法。

`Session.add_message()` 用于向消息列表中**写入一条消息**。它构造一条带 `role`、`content` 和时间戳的消息字典追加的 `messages` 末尾，并更新 `update_at`。

```python
def add_message(self, role: str, content: str, **kwargs: Any) -> None:
    msg = {
        "role": role,
        "content": content,
        "timestamp": datetime.now().isoformat(),
        **kwargs
    }
    self.messages.append(msg)
    self.updated_at = datetime.now()
```

`Session.get_history()` 用于**调取会话消息列表**，每次向 LLM 发送请求时均会调用该方法。

```python
def get_history(...) -> list[dict[str, Any]]:
     ...
```

它的逻辑是：

1. 取 `messages` 的作为未归档部分，并按配置的消息数量上限截取尾部切片；

1. 确保窗口从 user 消息开始，避免以 assistent/tool 开头；

1. 清理 assistant 消息：去掉 `[Message Time: ...]` 等内部标记;

1. 如果传了 `max_tokens`，从尾部按 token 预算再截一次。

返回的列表直接作为 LLM 的 `messages` 数组中的历史部分。

### 1.2 会话的创建与持久化

这部分由 `SessionManager` （`nanobot/session/manager.py`）管理。

Session Manager 通过 `get_or_create()` 方法**创建一个新会话**。先查**内存缓存**，未命中则**从磁盘加载**，磁盘也没有就新建一个。

```python
def get_or_create(self, key: str) -> Session:
    if key in self._cache:
        return self._cache[key]

    session = self._load(key)
    if session is None:
        session = Session(key=key)

    self._cache[key] = session
    return session
```

Session Manager 通过 `save()` 方法把**整个 Session** 通过**整体替换**的方式写入 JSONL 文件，格式为：

```python
第一行: {"_type": "metadata", "key": "...", "created_at": "...", "updated_at": "...", "metadata": {...}, "last_consolidated": N}
后续行: 每条消息一行 JSON
```

```python
def save(self, session: Session, *, fsync: bool = False) -> None:
    with open(tmp_path, "w", encoding="utf-8") as f:
        metadata_line = {
            "_type": "metadata",
            "key": session.key,
            "created_at": session.created_at.isoformat(),
            "updated_at": session.updated_at.isoformat(),
            "metadata": session.metadata,
            "last_consolidated": session.last_consolidated
        }
        f.write(json.dumps(metadata_line, ensure_ascii=False) + "\n")
    
        for msg in session.messages:
             f.write(json.dumps(msg, ensure_ascii=False) + "\n")
             
     os.replace(tmp_path, path)
```

## 2 记忆系统与 Dream

会话会通过 `Consolidator`（`nanobot/agent/memory.py`）和 `AutoCompact` （`nanobot/agent/autocompact.py`）转化为记忆。这两个组件之前已经有详细介绍。

**Dream** 是 nanobot 的定期记忆梳理机制，灵感来自人类睡眠中对记忆的整理。它通过 cron job 触发定期回顾 history.jsonl 中尚未处理的新条目，更新 `MEMORY.md`、`SOUL.md` 等长期记忆文件。

Dream 只能读写 `MEMORY.md`、`SOUL.md`、`USER.md` 和 `skills` 目录。
