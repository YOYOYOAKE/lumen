---
title: '[重置] nanobot 源码解析 7 - LLM Provider'
description: nanobot 通过抽象基类和注册表实现了多提供商的支持。
tags:
  - LLM/Agent
createdAt: '2026-07-15 02:27:00'
updatedAt: '2026-07-15 07:35:00'
---

nanobot 采用**抽象基类**和**注册表**实现使用一套接口完成多个 LLM API 的适配。

## 1 抽象基类

`LLMProvider`（`nanobot/providers/base.py`）使用 `chat()` 和 `chat_stream()` 方法分别实现 LLM 的**流式响应**和**非流式响应**。

```python
@abstractmethod
async def chat(...) -> LLMResponse:
    ...
    
async def chat_stream(...) -> LLMResponse:
    return await self.chat(...)
```

`chat()` 方法是一个**抽象方法**，而 `chat_stream()` 内部调用 `chat()` 实现流式输出。不过，如果子类原生支持流式输出，也可以选择覆写这个方法。

不过这两个方法依然不是真正入口，Agent Runner 会使用**带重试的方法**间接调用。

```python
async def chat_with_retry(...) -> LLMResponse:
    return await self._run_with_retry(...)

async def chat_stream_with_retry(...) -> LLMResponse:
    return await self._run_with_retry(...)
```

`_run_with_retry()` 是整个 Provider 的通用重试方法，支持 `standard` 和 `persistent` 两种重试模式，并根据不同的错误码执行不同的重试策略。

- `standrad`：重试 3 次，分别间隔 1/2/4 秒；

- `persistent`：无限重试，至多延迟 60 秒，10 次相同错误后放弃。

## 2 Provider 注册表

元组 `PROVIDERS`（`nanobot/providers/registry.py`）记录了四十多个 `ProviderSpec`，每个 `ProviderSpec` 对应一个 `Provider`。

基本字段有：

- `name`：配置字段名；

- `display_name`：用于展示的名称；

- `default_api_base`：默认端点；

- `backend`：决定使用哪个实现类，如 `"openai_compat"` / `"anthropic"` / `"openai_codex"` ；

- `thinking_style`：思考开关的格式，不同 Provider 启用思考模式的方式不同。

- `reasoning_effort_remap`：思考强度映射。

## 3 OpenAI 兼容 Provider

`OpenAICompatProvider`（nanobot/providers/openai_compat_provider.py）服务于所有 OpenAI 兼容协议的服务商（27+ 个），是 `LLMProvider` 的子类。

所有 OpenAI 兼容格式的提供商都会通过 OpenAICompatProvider 处理各自参数，并转化为能被自己的 API 识别的格式，例如 DeepSeek 推理历史补填 `reasoning_content: ""`、GPT-5 系列移除温度参数等。
