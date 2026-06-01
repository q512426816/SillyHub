---
id: task-07
title: execute 流程集成 policy check + 审计双写
priority: P0
estimated_hours: 3
depends_on: [task-03, task-05, task-06]
blocks: [task-09]
allowed_paths:
  - backend/app/modules/tool_gateway/service.py
  - backend/app/modules/tool_gateway/router.py
  - backend/tests/modules/tool_gateway/test_execute_integration.py
---

# task-07: execute 流程集成 policy check + 审计双写

## 修改文件（必填）

| 操作 | 文件路径 |
|------|----------|
| 修改 | `backend/app/modules/tool_gateway/service.py` |
| 修改 | `backend/app/modules/tool_gateway/router.py` |
| 新增 | `backend/tests/modules/tool_gateway/test_execute_integration.py` |

## 实现要求

### 1. 改造 `service.py` 的 `ToolGatewayService.execute()` 方法

在现有 execute 流程中插入 policy check 和审计双写逻辑：

**现有流程**（改造前）：
```
execute(lease_id, user_id, tool_type, params)
  → 校验 tool_type 在 TOOL_TYPES 中
  → _get_lease_and_task()
  → _resolve_lease_root()
  → _dispatch()
  → 写 ToolOperationLog + commit
  → 返回 op_log
```

**改造后流程**：
```
execute(lease_id, user_id, tool_type, params)
  → 校验 tool_type 在 TOOL_TYPES 中
  → _get_lease_and_task()
  → _resolve_lease_root()
  → _load_policy(lease)           ← 新增：加载策略（优先从 AgentRun.tool_policy_id，否则 default_policy）
  → policy.check(tool_type, params, lease_root)  ← 新增：策略校验（工具白名单、路径、命令黑名单、域名、资源限制）
  → policy.apply_resource_limits(params)          ← 新增：资源限制裁剪（timeout、output_size）
  → _dispatch()                   → 传入裁剪后的 params
  → 写 ToolOperationLog           → 使用 policy.max_output_size 替代硬编码 MAX_OUTPUT_SIZE
  → 写 AuditLog（审计双写）       ← 新增：同一 session add，同一 commit
  → commit
  → 返回 op_log
```

### 2. 新增 `_load_policy()` 方法

通过 `lease.task_id` → `Task` → 查找关联的 `AgentRun` → 获取 `tool_policy_id` → 加载 `ToolPolicy`。
如果找不到关联的 ToolPolicy（task_id 为空、无 AgentRun、tool_policy_id 为空），则使用 `default_policy()`。

### 3. 新增 `_record_audit()` 方法

仿照 `backend/app/modules/workflow/service.py` 中 `WorkflowService._record_audit()` 的模式，在 `ToolGatewayService` 中新增审计写入方法。写入 `AuditLog`（来自 `app.modules.workflow.model`）。

### 4. 扩展 `TOOL_TYPES` 常量

将 `run_tests` 和 `http_get` 加入 `TOOL_TYPES` frozenset。

### 5. 扩展 `_dispatch()` 路由表

在 `_dispatch()` 的 handlers dict 中新增 `run_tests` 和 `http_get` 的映射（指向 task-05/06 产出的 handler 方法）。

### 6. 改造 `router.py`

无需改动 router 签名（tool_type 已为 str，params 已为 dict）。但如果 schema.py 已将 tool_type 改为 Literal 包含 run_tests/http_get（task-08 负责），则 router 自然适配。

## 接口定义（代码类任务必填）

### TOOL_TYPES 扩展

```python
# service.py 顶部
TOOL_TYPES = frozenset({
    "file_read", "file_write", "file_list", "file_search", "shell_exec",
    "run_tests", "http_get",
})
```

### _load_policy 方法签名

```python
async def _load_policy(
    self,
    lease: WorktreeLease,
) -> ToolPolicy:
    """Load the ToolPolicy associated with the lease's AgentRun.
    
    Falls back to default_policy() if no association found.
    """
```

**控制流伪代码**：
```
1. 如果 lease.task_id 为 None → return default_policy()
2. 查找 AgentRun: SELECT FROM agent_runs WHERE task_id = lease.task_id LIMIT 1
3. 如果没找到 AgentRun → return default_policy()
4. 如果 agent_run.tool_policy_id 为 None → return default_policy()
5. 从 session 加载 ToolPolicy: session.get(ToolPolicy, agent_run.tool_policy_id)
6. 如果加载结果为 None → return default_policy()
7. return policy
```

### _record_audit 方法签名

```python
async def _record_audit(
    self,
    *,
    workspace_id: uuid.UUID,
    actor_id: uuid.UUID,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID,
    details: dict | None = None,
) -> None:
    """Write an AuditLog entry to the same session (not committed yet)."""
```

**控制流**：
```
1. 构造 AuditLog 对象：id, workspace_id, actor_id, action, resource_type, resource_id, details_json
2. self._session.add(entry)  ← 只 add，不 commit（由 execute() 统一 commit）
```

### 改造后的 execute 方法

```python
async def execute(
    self,
    lease_id: uuid.UUID,
    user_id: uuid.UUID,
    tool_type: str,
    params: dict,
) -> ToolOperationLog:
    if tool_type not in TOOL_TYPES:
        raise ToolOperationForbidden(
            f"Unknown tool type: {tool_type}",
            details={"tool_type": tool_type, "available": sorted(TOOL_TYPES)},
        )

    lease, task = await self._get_lease_and_task(lease_id, user_id)
    lease_root = self._resolve_lease_root(lease)
    allowed_paths = task.allowed_paths if task else []

    # ── 新增：加载策略 + 校验 ──
    policy = await self._load_policy(lease)
    # tool 白名单校验
    if tool_type not in policy.allowed_tools:
        raise ToolOperationForbidden(
            f"Tool '{tool_type}' not allowed by policy",
            details={"tool_type": tool_type, "allowed_tools": policy.allowed_tools},
        )
    # 命令黑名单校验（仅 shell_exec / run_tests）
    if tool_type in ("shell_exec", "run_tests"):
        command = params.get("command", "")
        args = params.get("args", [])
        combined = f"{command} {' '.join(args)}"
        for blocked in policy.blocked_commands:
            if blocked in combined:
                raise ToolOperationForbidden(
                    f"Blocked command by policy: {blocked}",
                    details={"command": command, "blocked": blocked},
                )
    # 域名白名单校验（仅 http_get）
    if tool_type == "http_get":
        url = params.get("url", "")
        domain = _extract_domain(url)  # 从 URL 提取域名
        if policy.allowed_domains and domain not in policy.allowed_domains:
            raise ToolOperationForbidden(
                f"Domain '{domain}' not in allowed_domains",
                details={"domain": domain, "allowed_domains": policy.allowed_domains},
            )

    # ── 资源限制裁剪 ──
    # params 中 timeout 不超过 policy.max_timeout
    effective_timeout = min(
        params.get("timeout", DEFAULT_TIMEOUT),
        policy.max_timeout,
    )
    max_output = policy.max_output_size

    # ── 路径校验（file_* 类型）──
    if tool_type in ("file_read", "file_write", "file_list", "file_search"):
        path_str = params.get("path", ".")
        validate_path(lease_root, path_str, allowed_paths)

    # ── 执行 ──
    result = await self._dispatch(tool_type, params, lease_root, allowed_paths)

    # ── 写 ToolOperationLog ──
    op_log = ToolOperationLog(
        id=uuid.uuid4(),
        workspace_id=lease.workspace_id,
        lease_id=lease.id,
        user_id=user_id,
        tool_type=tool_type,
        params_json=json.dumps(params) if params else None,
        result_code=result["result_code"],
        redacted_output=result["output"][:max_output] if result["output"] else None,
    )
    self._session.add(op_log)

    # ── 新增：审计双写 ──
    await self._record_audit(
        workspace_id=lease.workspace_id,
        actor_id=user_id,
        action=f"tool_gateway.{tool_type}",
        resource_type="tool_operation",
        resource_id=op_log.id,
        details={
            "tool_type": tool_type,
            "params": params,
            "result_code": result["result_code"],
        },
    )

    await self._session.commit()
    await self._session.refresh(op_log)

    log.info(
        "tool_gateway_exec",
        tool_type=tool_type,
        lease_id=str(lease_id),
        result_code=result["result_code"],
    )
    return op_log
```

### _extract_domain 辅助函数

```python
def _extract_domain(url: str) -> str:
    """Extract hostname from a URL string.
    
    Returns empty string if URL is malformed.
    """
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        return parsed.hostname or ""
    except Exception:
        return ""
```

### 新增 import 语句

```python
# service.py 顶部新增 import
from app.modules.tool_gateway.tool_policy import ToolPolicy, default_policy
from app.modules.agent.model import AgentRun
from app.modules.workflow.model import AuditLog
from sqlalchemy import select
from sqlmodel import col
```

### _dispatch 扩展

```python
async def _dispatch(
    self,
    tool_type: str,
    params: dict,
    lease_root: Path,
    allowed_paths: list[str],
) -> dict:
    handlers: dict[str, Callable[..., Coroutine[object, object, dict]]] = {
        "file_read": self._handle_file_read,
        "file_write": self._handle_file_write,
        "file_list": self._handle_file_list,
        "file_search": self._handle_file_search,
        "shell_exec": self._handle_shell_exec,
        "run_tests": self._handle_run_tests,    # ← task-05 产出
        "http_get": self._handle_http_get,      # ← task-06 产出
    }
    handler = handlers.get(tool_type)
    if handler is None:
        raise ToolOperationForbidden(f"Unhandled tool type: {tool_type}")

    if tool_type == "shell_exec":
        return await handler(params, lease_root)
    if tool_type in ("run_tests", "http_get"):
        return await handler(params, lease_root)
    return await handler(params, lease_root, allowed_paths)
```

## 边界处理（必填）

1. **AgentRun 不存在或 tool_policy_id 为 NULL**：`_load_policy()` 在任何一步找不到关联时，返回 `default_policy()`。默认策略允许全部 7 种 tool_type，不阻塞任何现有工具调用，兼容旧行为。

2. **ToolPolicy 被删除后 AgentRun 仍引用**（FK ON DELETE SET NULL）：`session.get(ToolPolicy, tool_policy_id)` 返回 None 时，fallback 到 `default_policy()`，不抛异常，不静默失败（structlog 记录 warning）。

3. **params 为空 dict**：`params.get("timeout", DEFAULT_TIMEOUT)` 正常返回默认值；`params.get("command", "")` 正常返回空字符串；`json.dumps({})` 正常序列化。不做特殊处理。

4. **allowed_domains 为空列表**：空列表表示"不限制域名"（即允许所有域名），与 design.md 兼容策略一致（默认策略 allowed_domains=[] 表示全允许）。只有当 allowed_domains 非空时才校验。

5. **blocked_commands 为空列表**：空列表表示策略层无额外黑名单，全局 `SHELL_BLOCKED_PATTERNS` 仍然由 `validate_shell_command()` 独立校验（不在此处重复）。策略层黑名单是叠加在全局黑名单之上的。

6. **policy.max_timeout < 请求 timeout**：`min(params_timeout, policy.max_timeout)` 自动裁剪，不抛异常，不修改原始 params dict。裁剪后的值作为 effective_timeout 传递给 handler，原始 params 不变。

7. **audit 双写时 session 异常**：ToolOperationLog 和 AuditLog 在同一 session 的同一 commit 中写入。如果 commit 失败（如 DB 连接断开），两条记录都不写入，保证一致性。异常向上传播给调用方（router 层的 FastAPI 异常处理）。

8. **_extract_domain URL 解析失败**：返回空字符串。如果 allowed_domains 非空且域名提取失败，空字符串不在白名单中，返回 403（安全优先：无法确定域名则拒绝）。

9. **validate_path 在 execute 中提前调用**：对于 file_* 类型工具，path 校验在 _dispatch 之前执行。如果路径不合法，提前抛出 ToolPathForbidden，不执行 handler 也不写日志。这与当前行为一致（当前 _dispatch 内部调用 validate_path，改造后提前到 execute 中做策略层校验）。注意：_dispatch 内部的 validate_path 保留不删，双重保障不冲突。

10. **不修改传入的 params dict**：所有资源限制裁剪使用局部变量 `effective_timeout` / `max_output`，不修改原始 `params` 字典。handler 内部如果需要 timeout，应从 params 中读取（由 handler 自身实现裁剪，或传入 effective_timeout）。

## 非目标（本任务不做的事）

- **不实现** `_handle_run_tests` 和 `_handle_http_get` handler 本体（由 task-05、task-06 分别实现）
- **不修改** `backend/app/modules/tool_gateway/schema.py`（tool_type Literal 扩展由 task-08 负责）
- **不修改** `backend/app/modules/tool_gateway/model.py`（ToolOperationLog.tool_type 列宽由 task-08 负责）
- **不修改** `backend/app/modules/agent/model.py`（AgentRun FK 由 task-02 负责）
- **不创建** `backend/app/modules/tool_gateway/tool_policy.py`（ToolPolicy 模型由 task-01 负责）
- **不实现** Policy CRUD API（由 task-04 负责）
- **不实现** ToolPolicyService 独立类（由 task-03 负责，本任务直接在 execute 中使用 ToolPolicy 模型属性做校验）
- **不写** 完整测试套件（由 task-09 负责，本任务只写集成测试）

## 参考

- **现有 execute 方法**：`backend/app/modules/tool_gateway/service.py` 第 120-159 行 — 当前 execute 流程
- **AuditLog 模型**：`backend/app/modules/workflow/model.py` 第 48-84 行 — AuditLog 表结构
- **审计写入模式**：`backend/app/modules/workflow/service.py` 第 202-222 行 — `_record_audit()` 方法，add 到 session 后由上层 commit
- **ToolPolicy 模型**：`backend/app/modules/tool_gateway/tool_policy.py`（task-01 产出）— `ToolPolicy` 类和 `default_policy()` 函数
- **AgentRun 模型**：`backend/app/modules/agent/model.py` — `agent_runs` 表结构，task-02 将新增 `tool_policy_id` 列
- **FR-09 需求**：`.sillyspec/changes/2026-05-30-tool-gateway/requirements.md` 第 110-118 行 — 审计双写 Given/When/Then 规格
- **design.md AD-3**：审计双写决策 — 同时写 ToolOperationLog 和 AuditLog
- **validate_path**：`backend/app/modules/tool_gateway/service.py` 第 68-100 行 — 已有路径校验函数
- **validate_shell_command**：`backend/app/modules/tool_gateway/service.py` 第 103-111 行 — 已有命令校验函数

## TDD 步骤

### 测试文件：`backend/tests/modules/tool_gateway/test_execute_integration.py`

1. **写测试**（先写以下测试用例，确认全部失败）：

   - `test_execute_with_default_policy_allows_existing_tools` — 不关联 ToolPolicy，调用 file_read，正常执行，验证 ToolOperationLog 和 AuditLog 同时存在
   - `test_execute_writes_audit_log` — 调用 shell_exec，验证 AuditLog 记录的 action="tool_gateway.shell_exec"，details_json 包含 tool_type/params/result_code
   - `test_execute_tool_not_in_allowed_tools_blocked` — 创建 ToolPolicy 只允许 file_read，调用 shell_exec，期望抛出 ToolOperationForbidden
   - `test_execute_blocked_command_by_policy` — 创建 ToolPolicy 的 blocked_commands=["curl"]，调用 shell_exec command="curl"，期望抛出 ToolOperationForbidden
   - `test_execute_http_get_domain_not_allowed` — 创建 ToolPolicy 的 allowed_domains=["api.github.com"]，调用 http_get url="https://evil.com/api"，期望抛出 ToolOperationForbidden
   - `test_execute_http_get_domain_allowed` — 创建 ToolPolicy 的 allowed_domains=["api.github.com"]，调用 http_get url="https://api.github.com/repos"，正常执行
   - `test_execute_timeout_capped_by_policy` — 创建 ToolPolicy max_timeout=5，调用 shell_exec timeout=60，验证 effective_timeout 不超过 5（通过 mock 验证传入 handler 的参数）
   - `test_execute_output_truncated_by_policy` — 创建 ToolPolicy max_output_size=100，handler 返回 200 字符输出，验证 op_log.redacted_output 长度 <= 100
   - `test_execute_deleted_policy_falls_back_to_default` — 创建并删除 ToolPolicy（模拟 FK SET NULL），调用 file_read，正常执行不报错
   - `test_execute_empty_allowed_domains_allows_all` — ToolPolicy allowed_domains=[]，调用 http_get 任意域名，正常执行
   - `test_execute_audit_log_resource_type` — 验证 AuditLog 的 resource_type="tool_operation"，resource_id=op_log.id
   - `test_execute_audit_log_and_op_log_same_commit` — 验证在一次 execute 调用后，session 中同时存在 ToolOperationLog 和 AuditLog（查询两条记录都在）

2. **确认失败** — `pytest tests/modules/tool_gateway/test_execute_integration.py` 全红（因为 policy check 逻辑和审计双写尚未实现）

3. **写代码** — 按上述接口定义改造 `service.py`

4. **确认通过** — `pytest tests/modules/tool_gateway/test_execute_integration.py` 全绿

5. **回归** — `pytest` 全套无回归（当前 648+ tests passed）

### 测试 fixture 需求

测试需要以下 fixture（复用已有的或新增）：

```python
# 需要的 fixture（部分可能已在 conftest.py 中存在）：
# - db_session: AsyncSession（已有）
# - test_workspace_id: uuid.UUID（task-01 新增）
# - test_user_id: uuid.UUID（需要创建 user 行）
# - test_lease: WorktreeLease（需要创建 lease 行）
# - test_policy: ToolPolicy（需要创建 policy 行并关联 AgentRun）
# - test_agent_run: AgentRun（需要创建 agent_run 行并设置 tool_policy_id）
```

### Mock 策略

- `_handle_run_tests` 和 `_handle_http_get` 如果 task-05/06 尚未实现，测试中使用 `unittest.mock.patch` mock 掉 handler 返回固定结果
- `_resolve_lease_root` 在测试中 mock 为临时目录（`tmp_path`）
- `_handle_shell_exec` 等已有 handler 可以正常调用（使用安全命令如 `echo`）
- `_handle_file_read` 等已有 handler 使用 `tmp_path` 创建测试文件后正常调用

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | `service.py` 中 `TOOL_TYPES` 包含 7 种工具 | `TOOL_TYPES == frozenset({"file_read", "file_write", "file_list", "file_search", "shell_exec", "run_tests", "http_get"})` |
| AC-02 | `service.py` 新增 `_load_policy` 方法 | 方法存在，签名为 `async def _load_policy(self, lease: WorktreeLease) -> ToolPolicy`，内部按伪代码 5 步 fallback 到 default_policy() |
| AC-03 | `service.py` 新增 `_record_audit` 方法 | 方法存在，签名为 `async def _record_audit(self, *, workspace_id, actor_id, action, resource_type, resource_id, details=None) -> None`，只 add 不 commit |
| AC-04 | `execute()` 方法在 `_dispatch` 前执行策略校验 | 调用 `_load_policy()`，校验 tool_type 在 allowed_tools 中，校验 blocked_commands（shell_exec/run_tests），校验 allowed_domains（http_get） |
| AC-05 | `execute()` 方法在 `_dispatch` 后执行审计双写 | 先 add ToolOperationLog，再调用 `_record_audit()`，最后统一 commit |
| AC-06 | 审计双写正确写入 AuditLog | 一次 execute 调用后，查询 AuditLog 表存在一条记录，action=f"tool_gateway.{tool_type}"，resource_type="tool_operation"，resource_id=op_log.id，details_json 包含 tool_type/params/result_code |
| AC-07 | 默认策略兼容旧行为 | 不关联 ToolPolicy 时，全部 7 种 tool_type 正常执行（与改造前行为一致），审计双写仍然生效 |
| AC-08 | 策略校验拒绝时抛出 ToolOperationForbidden | tool_type 不在 allowed_tools 时抛 403，blocked_commands 匹配时抛 403，域名不在 allowed_domains 时抛 403 |
| AC-09 | 资源限制裁剪生效 | timeout 不超过 policy.max_timeout，output 不超过 policy.max_output_size |
| AC-10 | `_dispatch()` 路由表包含 run_tests 和 http_get | handlers dict 包含 `"run_tests": self._handle_run_tests` 和 `"http_get": self._handle_http_get` |
| AC-11 | `_extract_domain()` 辅助函数存在 | 从 URL 字符串正确提取 hostname，异常返回空字符串 |
| AC-12 | `service.py` 新增 import 正确 | `from app.modules.tool_gateway.tool_policy import ToolPolicy, default_policy`；`from app.modules.agent.model import AgentRun`；`from app.modules.workflow.model import AuditLog`；`from sqlalchemy import select`；`from sqlmodel import col` |
| AC-13 | 不修改传入的 params dict | execute 方法内部无 `params[...] = ...` 或 `params.update(...)` 等修改操作 |
| AC-14 | 集成测试文件存在且包含 >=10 个测试 | `test_execute_integration.py` 存在，所有测试通过 |
| AC-15 | 全量回归无失败 | `pytest` 全套通过，无新增失败/错误 |
