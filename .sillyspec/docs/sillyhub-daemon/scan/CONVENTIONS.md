---
author: qinyi
created_at: 2026-06-10T00:00:00
---

# SillyHub Daemon -- 代码约定

## 代码风格

### Python 风格
- Python 3.12+，广泛使用 `from __future__ import annotations` 延迟类型求值
- 类型注解全覆盖，参数和返回值均标注类型
- dataclass 用于数据结构（AgentDef、DetectedAgent、TaskResult、AgentEvent）
- `str | None` 联合类型语法（非 `Optional[str]`）

### 命名约定
- 类名：PascalCase（`HubClient`、`TaskRunner`、`AgentDetector`）
- 私有方法/属性：单下划线前缀（`_load`、`_config`、`_fire`）
- 模块级私有：单下划线前缀（`_PID_FILE`、`_LOG_FILE`、`_SEMVER_RE`）
- 常量：UPPER_SNAKE_CASE（`MSG_TASK_AVAILABLE`、`DEFAULT_CONFIG_DIR`）
- 异步方法：不使用 `async_` 前缀，直接用动词（`start`、`stop`、`detect_all`）

### 日志约定
- 使用标准 `logging.getLogger(__name__)`
- 结构化日志：`logger.info("daemon.started runtime_id=%s", self._runtime_id)`
- 日志 key-value 格式用下划线连接（`daemon.ws_connected`、`task_execute_start`）

### 文件组织
- 每个模块一个文件，职责单一
- backends/ 子包使用 ABC + 工厂模式
- 所有 `from __future__ import annotations` 放在文件顶部（docstring 之后）
- 标准库 -> 第三方库 -> 项目内部 的 import 排序

## 框架隐形规则

### CLI 层 (Click)
- `@click.group()` 定义根命令组
- 子命令通过 `@cli.command()` 注册
- start 命令内部使用延迟导入（函数体内 import），避免启动时加载所有模块
- 配置通过 `--server` / `--token` 选项传入，持久化到 `~/.sillyhub/daemon/config.json`

### 异步编程模式
- 所有 I/O 操作使用 asyncio（`async def` + `await`）
- 子进程通过 `asyncio.create_subprocess_exec` 管理
- 后台任务通过 `asyncio.create_task` + `_fire()` 方法追踪，支持优雅取消
- WebSocket 重连使用固定 5 秒退避
- `CancelledError` 总是被捕获用于优雅退出

### 配置管理
- `DaemonConfig` 使用 property 访问器（getter/setter）
- 配置文件自动创建（`_path.parent.mkdir(parents=True, exist_ok=True)`）
- `runtime_id` 自动生成（`uuid.uuid4()`）
- save 后立即持久化

### Backend 协议
- 所有 backend 继承 `AgentBackend(ABC)`，必须实现 `execute()` 和 `parse_output()`
- `provider` 类属性标识 provider 名称
- Backend 通过 `get_backend(provider)` 懒加载工厂获取
- PROTOCOL_PROVIDERS 字典维护 protocol -> provider 列表映射
- 不支持的 provider 抛出 `ValueError`/`ImportError`

### 错误处理
- HTTP 错误通过 `resp.raise_for_status()` 处理
- 子进程错误通过 return code 检查
- 所有后台循环捕获 `CancelledError` 实现优雅退出
- 日志记录异常后继续运行（非致命错误不中断）
- `TYPE_CHECKING` 守卫避免循环导入

## 典型代码模式

### 模式 1: 后台任务管理
```python
def _fire(self, coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    self._tasks.add(task)
    task.add_done_callback(self._tasks.discard)
    return task
```

### 模式 2: 懒加载工厂
```python
def get_backend(provider: str) -> type[AgentBackend]:
    protocol = get_protocol(provider)
    module_path, class_name = _PROTOCOL_MODULES[protocol]
    module = importlib.import_module(module_path, package=__name__)
    return getattr(module, class_name)
```

### 模式 3: 凭证占位符渲染
```python
def render_config(self, config: dict) -> dict:
    for key, value in config.items():
        if isinstance(value, str) and value.startswith("{{USER_") and value.endswith("}}"):
            env_var = value[2:-2]
            resolved = self._credentials.get(env_var) or os.environ.get(env_var)
            rendered[key] = resolved if resolved is not None else value
```

### 模式 4: Agent 检测优先级
```python
def _resolve_bin_path(self, defn: AgentDef) -> str | None:
    env_val = os.getenv(defn.env_path)
    if env_val and os.path.isfile(env_val):
        return env_val
    return shutil.which(defn.bin)
```

### 模式 5: 子进程执行与输出解析
```python
proc = await asyncio.create_subprocess_exec(*cmd, stdout=PIPE, stderr=PIPE)
async for raw_line in proc.stdout:
    event = await self.parse_output(raw_line.decode().strip())
    if event:
        events.append(event)
```
