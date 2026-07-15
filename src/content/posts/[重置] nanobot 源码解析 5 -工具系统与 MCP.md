---
title: '[重置] nanobot 源码解析 5 -工具系统与 MCP'
description: nanobot 的工具系统赋予了 LLM 与外部交互的机制。本文就工具系统进行讲解。
tags:
  - LLM/Agent
createdAt: '2026-07-07 01:09:00'
updatedAt: '2026-07-15 00:56:00'
---

从 LLM 的视角看，工具就是一组**可被调用的函数**，这通过 LLM 本身的 **Function Calling** 能力实现。每个工具（函数）有**名字**、**描述**、**参数**等，调用后返回**文本结果**。

nanobot 使用一系列组件定义工具。

## 1 工具系统

### 1.1 抽象基类 Tool

每一个工具都要实现 `Tool` 基类（`nanobot/agent/tools/base.py`）。

<!-- unknown: heading_4 -->

`Tool` 基类使用三个**抽象属性**定义工具的**名字**、**描述**、**参数**：

```python
@property
@abstractmethod
def name(self) -> str:
    ...

@property
@abstractmethod
def description(self) -> str:
		...

@property
@abstractmethod
def parameters(self) -> dict[str, Any]:
		...
```

`name`、`description`、`parameters` 共同构成 `to_schema()` 的输出，最终作为能被 LLM API 接受的格式发送出去。

```python
def to_schema(self) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
        },
    }
```

<!-- unknown: heading_4 -->

异步方法 `execute` 接收 LLM 传来的**具名参数**，返回字符串或 `ToolResult`。工具仅会在此施加**副作用**。

```python
@abstractmethod
async def execute(self, **kwargs: Any) -> Any:
    ...
```

<!-- unknown: heading_4 -->

Tool 基类使用三个属性控制工具的并行执行策略。

```python
@property
def read_only(self) -> bool:
    return False

@property
def concurrency_safe(self) -> bool:
    return self.read_only and not self.exclusive

@property
def exclusive(self) -> bool:
    return False
```

`read_only` 属性声明工具**有无副作用**。如无副作用工具 `read_file`、`web_search`。

`exclusive` 声明工具能否与任何工具**并行运行**。如 `exec`，因为 shell 命令可能修改文件系统，与其他读写操作产生竞态。

`concurrency_safe` 是派生属性，当工具只读且非独占时，工具才能与其他并发安全工具一起**并行执行**。

`AgentRunner._partition_tool_batches()` 在**并发模式**下读取这些属性，把连续的并发安全工具调用编入同一批次用 `asyncio.gather` 并行执行，独占工具则单独成批顺序执行。

<!-- unknown: heading_4 -->

```python
@classmethod
def enabled(cls, ctx: ToolContext) -> bool:
    return True

@classmethod
def create(cls, ctx: ToolContext) -> Tool:
    return cls()
```

`enabled` 决定**工具启用**，当返回 `False` 时 `ToolLoader` 会跳过该工具。

`create` 工具构造并注入**工具上下文**。`ToolContext` 里有 **config**、**workspace**、**bus**、**subagent_manager** 等所有运行时依赖，工具在这里完成依赖注入。

### 1.2 工具执行结果 ToolResult

`ToolResult` 是工具的执行结果。它继承自 `str`，所以对 LLM 来说它就是**一段文本**。

但它多了一个 `is_error` 布尔标记，方便框架层判断**执行是否成功**。用 `ToolResult.error("失败原因")` 创建错误结果。

```python
class ToolResult(str):
    is_error: bool

    def __new__(cls, content: str, *, is_error: bool = False) -> ToolResult:
        obj = str.__new__(cls, content)
        obj.is_error = is_error
        return obj

    @classmethod
    def error(cls, content: str) -> ToolResult:
        return cls(content, is_error=True)
```

### 1.3 工具注册表 ToolRegistry

`AgentLoop` 持有一个 `ToolRegistry` （`nanobot/agent/tools/registry.py`）实例，**内置工具**和 **MCP 工具**都注册到**同一个实例**上。

```python
class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, Tool] = {}
        self._cached_definitions: list[dict[str, Any]] | None = None
```

`_tools` 字典以工具名为键存储所有工具实例。

`_cached_definitions` 缓存 `get_definitions()` 的结果。因为同一个会话中工具集通常**不变**，但每次 LLM 调用都要发送**完整工具列表**，缓存避免了反复调用 `to_schema()`。

`register()` 和 `unregister()` 都会清除 `_cached_definitions`，保证缓存不会过期。

```python
class ToolRegistry:
    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool
        self._cached_definitions = None

    def unregister(self, name: str) -> None:
        self._tools.pop(name, None)
        self._cached_definitions = None
```

当 LLM 请求调用工具时，`execute()` 方法被执行：

```python
class ToolRegistry:
    async def execute(self, name: str, params: Any) -> Any:
        tool, params, error = self.prepare_call(name, params)
        result = await tool.execute(**params)
        return result
```

`execute()` 方法会先执行 `prepare_call()` 方法，解析名称、转换参数、验证 schema。

### 1.4 工具加载 ToolLoader

`ToolLoader`（`nanobot/agent/tools/loader.py`）负责**发现和注册工具**。

```python
class ToolLoader:
    def discover(self) -> list[type[Tool]]:
        ...

    def _discover_plugins(self) -> dict[str, type[Tool]]:
        ...

    def load(self, ctx, registry, *, scope="core") -> list[str]:
        ...
```

`discover()` 用于发现**内置工具**。它遍历 `nanobot/agent/tools/` 目录下的所有模块，对每个模块用 `importlib.import_module()` 动态导入，去重后按类名字母序排序返回。

`_discover_plugins()` 用于发现**外部第三方工具**。通过 Python 的 `entry_points(group="nanobot.tools")` 机制发现第三方包提供的工具。每个 entry point 是一个 `Tool` 子类，命名规则与内置工具一致。结果缓存到 `_plugins` 字典中。

`load()` 是最终的注册入口。它对内置工具和外部插件做统一处理：

- 检查 `scope` 是否在工具类的 `_scopes` 中（不在则跳过）；

- 检查 `tool_cls.enabled(ctx)`（返回 `False` 则跳过）；

- 调用 `tool_cls.create(ctx)` 实例化，完成依赖注入；

- 注册到 registry。插件与内置工具名冲突时，**内置优先**，插件被跳过并打印警告。

## 2 MCP 兼容

nanobot 使用 **MCP Warpper**（`nanobot/agent/tools/mcp.py`）将 MCP 包装为 Tool，因此在 LLM 看来，MCP 提供的工具和本地工具**没有任何区别**。

我们还是先看看 nanobot 是如何连接 MCP Server、发现远程资源的。

### 2.1 连接到 MCP Server

nanobot 启动后、Agent Loop 进入消息循环之前会首先调用一次 `_connect_mcp()`，并间接调用 `connect_missing_servers()`（`nanobot/agent/tools/mcp.py`）。

`connect_missing_servers()` 用于找出**已声明但尚未连接**的 MCP Server，交给 `connect_mcp_servers()` 去连接。

```python
async def connect_missing_servers(...):
    connected = await connect_mcp_servers(missing_servers, registry)
```

`connect_mcp_servers()` 会根据类型，逐个尝试建立传输通道：

```python
async def connect_mcp_servers(...):
    for name, cfg in mcp_servers.items():
        result = await connect_single_server(name, cfg)
        
    async def connect_single_server(...):
       if transport_type == "stdio":
           ...
       if transport_type == "sse":
           ...
       if transport_type == "streamableHttp":
           ...
```

随后**创建 MCP 会话**并实现 MCP 协议**握手**：

```python
session = await server_stack.enter_async_context(ClientSession(read, write))
await session.initialize()
```

最后调用 MCP 协议的**标准方法**发现**远程资源**：

```python
await session.list_tools()
await session.list_resources()
await session.list_prompts()
```

### 2.2 MCP 工具包装

拿到 `session.list_tools()` 返回的工具列表后，`connect_mcp_servers()` 会创建 `MCPToolWrapper` 并注册到 Tool Registry。

```python
wrapper = MCPToolWrapper(session, name, tool_def, tool_timeout=cfg.tool_timeout)
registry.register(wrapper)
```

`MCPToolWrapper` 的构造函数保存以下信息：

- `_session`：刚才建好的 MCP 会话对象，后续调用工具时要用；

- `_original_name`：MCP Server 定义的**原始工具名**；

- `_name`：工具前缀，`mcp_` 前缀是为了和**内置工具**区分，加 Server 名是为了多个 Server 的同名工具不冲突；

- `_parameters`：工具的输入参数 schema，经过一次格式化转换，确保 OpenAI/Anthropic 等不同 LLM 都能理解。

`list_resources()` 和 `list_prompts()` 的逻辑类似，分别使用 `MCPResourceWrapper` 和 `MCPPromptsWrapper` 包装为只读工具。

### 2.3 MCP 工具调用

由于 **MCP 工具**和**内置 Tool** 在形式上是**等价**的，LLM 同样可以调用工具的 `execute()` 方法（`MCPToolWrapper.execute()`）去实际执行 MCP 工具。

```python
class MCPToolWrapper(_MCPWrapperBase):
    async def execute(self, **kwargs: Any) -> str:
        result = await self._session.call_tool(self._original_name, arguments=kwargs)
```

`session.call_tool()` 是 MCP SDK 提供的**标准方法**，它把**工具名和参数**打包成 MCP 协议规定的 **JSON-RPC 消息**，通过之前建好的传输通道发给 MCP Server。Server 执行完成后，把结果通过**同一通道**返回。

拿到结果后，`execute()` 把返回内容渲染成文本字符串，返回给 `AgentLoop`。`AgentLoop` 再把结果发给 LLM，LLM 根据结果生成回复给用户。
