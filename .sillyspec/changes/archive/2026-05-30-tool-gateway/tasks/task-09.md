---
id: task-09
title: 完整测试套件（≥20 新测试）
priority: P0
estimated_hours: 4
depends_on: [task-07, task-08]
blocks: [task-10]
allowed_paths:
  - backend/app/modules/tool_gateway/tests/
---

# task-09: 完整测试套件（≥20 新测试）

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 修改 | `backend/app/modules/tool_gateway/tests/test_service.py` | 扩展策略校验 + 路径校验测试 |
| 修改 | `backend/app/modules/tool_gateway/tests/test_router.py` | 扩展 HTTP 级集成测试 |
| 新增 | `backend/app/modules/tool_gateway/tests/test_policy_integration.py` | Policy 集成 execute 流程测试（策略白名单、资源限制、审计双写） |
| 新增 | `backend/app/modules/tool_gateway/tests/test_run_tests_integration.py` | run_tests handler HTTP 级集成测试 |
| 新增 | `backend/app/modules/tool_gateway/tests/test_http_get_integration.py` | http_get handler HTTP 级集成测试（含 SSRF 防护） |

## 依据文档

- `/Users/qinyi/SillyHub/.sillyspec/changes/2026-05-30-tool-gateway/design.md` — 架构决策 + 数据模型 + API 设计
- `/Users/qinyi/SillyHub/.sillyspec/changes/2026-05-30-tool-gateway/requirements.md` — FR-01~FR-09 功能需求
- `/Users/qinyi/SillyHub/.sillyspec/changes/2026-05-30-tool-gateway/plan.md` — Wave 3 全局验收标准

## 实现要求

本任务不修改任何业务代码，只编写测试。task-07（execute 流程集成 policy check + 审计双写）和 task-08（schema 扩展）完成后，以下功能已实现但缺少端到端验证：

1. **策略校验端到端测试** — 通过 HTTP API 验证 ToolPolicy 对工具执行的控制（白名单、命令黑名单、域名白名单、资源限制）
2. **run_tests 端到端测试** — 通过 HTTP API 调用 run_tests 工具，验证结构化结果返回
3. **http_get 端到端测试** — 通过 HTTP API 调用 http_get 工具，验证域名白名单 + SSRF 防护
4. **审计双写验证** — 验证每次工具调用后 ToolOperationLog 和 AuditLog 同时存在
5. **扩展已有 test_service.py** — 补充策略引擎相关单元测试
6. **扩展已有 test_router.py** — 补充新 tool_type 的 HTTP 级测试

## 接口定义（代码类任务必填）

### 被测系统接口（task-07/08 产出，本任务只读）

#### 1. ToolGatewayService.execute() — 改造后签名

```python
async def execute(
    self,
    lease_id: uuid.UUID,
    user_id: uuid.UUID,
    tool_type: str,
    params: dict,
) -> ToolOperationLog:
```

execute 内部流程（task-07 产出）：
1. 校验 tool_type in TOOL_TYPES
2. _get_lease_and_task() 获取 lease + task
3. _resolve_lease_root() 解析 lease 根目录
4. _load_policy(lease) 加载策略（fallback 到 default_policy()）
5. policy 校验：tool_type in allowed_tools、blocked_commands、allowed_domains
6. 资源限制裁剪：effective_timeout = min(params.timeout, policy.max_timeout)
7. _dispatch() 执行 handler
8. 写 ToolOperationLog（使用 policy.max_output_size 截断）
9. 写 AuditLog（action=f"tool_gateway.{tool_type}"，resource_type="tool_operation"）
10. session.commit()
11. 返回 op_log

#### 2. ToolPolicy 模型（task-01 产出）

```python
# backend/app/modules/tool_gateway/tool_policy.py
class ToolPolicy(BaseModel, table=True):
    __tablename__ = "tool_policies"
    id, workspace_id, name,
    allowed_tools: list[str],     # 默认全部 7 种
    blocked_commands: list[str],  # 默认 []
    allowed_paths: list[str],     # 默认 ["."]
    allowed_domains: list[str],   # 默认 []
    max_timeout: int,             # 默认 30
    max_output_size: int,         # 默认 64000
    created_at, updated_at
```

#### 3. AuditLog 模型（workflow 模块已有）

```python
# backend/app/modules/workflow/model.py
class AuditLog(BaseModel, table=True):
    __tablename__ = "audit_logs"
    id, workspace_id, actor_id, action, resource_type, resource_id,
    details_json, timestamp
```

#### 4. ToolExecuteRequest schema（task-08 产出）

```python
class ToolExecuteRequest(BaseModel):
    tool_type: Literal[
        "file_read", "file_write", "file_list", "file_search",
        "shell_exec", "run_tests", "http_get",
    ]
    params: dict[str, Any] = Field(default_factory=dict)
```

#### 5. API 端点（已有，tool_type 扩展后自动支持）

```
POST /api/worktrees/{lease_id}/tools
  Request: { tool_type: "run_tests"|"http_get"|..., params: {...} }
  Response: ToolExecuteResponse (id, tool_type, result_code, redacted_output, timestamp)
```

### 测试文件结构

#### 文件 1: test_policy_integration.py（核心新增文件，约 12 个测试）

```python
"""End-to-end tests for ToolPolicy integration with execute flow.

Verifies:
- FR-02: AgentRun 关联 ToolPolicy，未关联时使用默认策略
- FR-03: 策略校验 — 工具白名单
- FR-04: 策略校验 — 路径限制（与已有 test_service.py 互补，本文件通过 HTTP API 测试）
- FR-05: 策略校验 — shell 命令黑名单（策略级 + 全局级叠加）
- FR-06: 策略校验 — 资源限制（timeout / output_size）
- FR-09: 审计双写（ToolOperationLog + AuditLog 同时存在）
"""
```

#### 文件 2: test_run_tests_integration.py（约 5 个测试）

```python
"""End-to-end tests for run_tests tool through HTTP API.

Verifies:
- FR-07: run_tests 工具执行 + 结构化结果返回
"""
```

#### 文件 3: test_http_get_integration.py（约 5 个测试）

```python
"""End-to-end tests for http_get tool through HTTP API.

Verifies:
- FR-08: http_get 域名白名单 + SSRF 防护
"""
```

#### 文件 4: test_service.py 扩展（约 3 个新增测试）

在现有 TestValidatePath 和 TestShellValidation 类之外新增测试类。

#### 文件 5: test_router.py 扩展（约 2 个新增测试）

在现有 HTTP 测试基础上补充新 tool_type 测试。

### 控制流伪代码

```
每个 HTTP 级测试的通用流程：

1. 调用 _setup_active_lease_with_policy(db_session, tmp_path, policy_config)
   → 创建 workspace, change, task, user, identity, lease + token
   → 创建 ToolPolicy 行，设置 policy_config 中的 allowed_tools/blocked_commands/allowed_domains 等
   → 创建 AgentRun 行，关联 ToolPolicy（设置 tool_policy_id）
   → 返回 {ws_id, lease_id, token, policy_id, ...}

2. 发送 POST /api/worktrees/{lease_id}/tools
   json={tool_type: "...", params: {...}}
   headers={Authorization: Bearer <token>}

3. 断言 resp.status_code == 预期值
4. 断言 resp.json() 包含预期字段
5. 查询 DB 验证 ToolOperationLog 和 AuditLog 行存在
```

### 辅助 fixture / helper

在测试文件顶部定义一个辅助函数 `_setup_active_lease_with_policy`，复用已有 `test_router.py` 中 `_setup_active_lease` 的模式，但增加 ToolPolicy 和 AgentRun 的创建：

```python
async def _setup_active_lease_with_policy(
    db_session: AsyncSession,
    tmp_path: Path,
    *,
    policy_config: dict | None = None,  # ToolPolicy 配置覆盖
) -> dict:
    """创建完整的测试环境：workspace + change + task + user + identity + lease + ToolPolicy + AgentRun。

    Args:
        policy_config: 可选，ToolPolicy 字段覆盖。
            默认不传时创建允许全部工具的策略。
            传入 {"allowed_tools": ["file_read"]} 限制工具白名单。

    Returns:
        dict 包含 ws_id, lease_id, token, policy_id, agent_run_id, lease_path, repo_dir 等
    """
    # 1. 复用 _setup_active_lease 的全部逻辑（创建 workspace, change, task, user, identity, lease）
    # 2. 新增：创建 ToolPolicy 行
    #    from app.modules.tool_gateway.tool_policy import ToolPolicy, ALL_TOOLS
    #    defaults = {
    #        "allowed_tools": list(ALL_TOOLS),
    #        "blocked_commands": [],
    #        "allowed_paths": ["."],
    #        "allowed_domains": [],
    #        "max_timeout": 30,
    #        "max_output_size": 64000,
    #    }
    #    if policy_config:
    #        defaults.update(policy_config)
    #    policy = ToolPolicy(
    #        id=uuid.uuid4(),
    #        workspace_id=ws_id,
    #        name=f"test-policy-{uuid.uuid4().hex[:8]}",
    #        **defaults,
    #    )
    #    db_session.add(policy)
    # 3. 新增：创建 AgentRun 行，关联 ToolPolicy
    #    from app.modules.agent.model import AgentRun
    #    agent_run = AgentRun(
    #        id=uuid.uuid4(),
    #        workspace_id=ws_id,
    #        task_id=task_id,
    #        lease_id=lease_id,
    #        user_id=user_id,
    #        status="running",
    #        tool_policy_id=policy.id,
    #    )
    #    db_session.add(agent_run)
    # 4. await db_session.commit()
    # 5. 返回完整 refs dict
```

**注意**：`_setup_active_lease_with_policy` 函数定义在 `test_policy_integration.py` 中。其他测试文件如需要可以直接 import 或复制该函数。如果 `test_router.py` 中已有的 `_setup_active_lease` 能满足需求（即不需要关联 policy），可继续使用原函数。只有需要 policy 关联的测试才使用新函数。

### 每个 test 文件的测试用例清单

#### test_policy_integration.py（12 个测试）

| # | 测试名 | 测试内容 | 验证需求 |
|---|--------|----------|----------|
| 1 | `test_default_policy_allows_all_tools` | 不关联 ToolPolicy（AgentRun.tool_policy_id=None），调用 file_read | 正常执行（FR-02 默认策略） |
| 2 | `test_tool_not_in_allowed_tools_blocked` | 创建 ToolPolicy 只允许 file_read，调用 shell_exec | resp.status_code==403，body 包含 "not allowed by policy"（FR-03） |
| 3 | `test_tool_in_allowed_tools_passes` | 创建 ToolPolicy 只允许 file_read，调用 file_read | 正常执行（FR-03 正向） |
| 4 | `test_blocked_command_by_policy` | 创建 ToolPolicy blocked_commands=["curl"]，调用 shell_exec command="curl" | resp.status_code==403，body 包含 "Blocked command by policy"（FR-05 策略级） |
| 5 | `test_global_blacklist_still_applies` | 创建 ToolPolicy 无 blocked_commands，调用 shell_exec command="sudo" | resp.status_code==403（FR-05 全局黑名单始终生效） |
| 6 | `test_http_get_domain_allowed` | 创建 ToolPolicy allowed_domains=["api.github.com"]，mock httpx，调用 http_get url="https://api.github.com/repos" | 正常执行（FR-08 正向） |
| 7 | `test_http_get_domain_blocked` | 创建 ToolPolicy allowed_domains=["pypi.org"]，调用 http_get url="https://evil.com/api" | resp.status_code==403，body 包含 "not in allowed_domains"（FR-08） |
| 8 | `test_http_get_empty_allowed_domains_allows_all` | 创建 ToolPolicy allowed_domains=[]，mock httpx，调用 http_get 任意域名 | 正常执行（设计兼容策略：空列表=全允许） |
| 9 | `test_timeout_capped_by_policy` | 创建 ToolPolicy max_timeout=5，调用 shell_exec timeout=60，mock 子进程验证 asyncio.wait_for 的 timeout 参数不大于 5 | effective_timeout <= 5（FR-06） |
| 10 | `test_output_truncated_by_policy` | 创建 ToolPolicy max_output_size=100，mock shell_exec 返回 200 字符输出，验证 ToolOperationLog.redacted_output 长度 <= 100 | redacted_output 长度 <= 100（FR-06） |
| 11 | `test_audit_dual_write_on_success` | 调用 file_read 成功，查询 DB 验证 ToolOperationLog 和 AuditLog 同时存在 | ToolOperationLog 行存在 + AuditLog 行存在，AuditLog.action=="tool_gateway.file_read"（FR-09） |
| 12 | `test_audit_log_details_json_structure` | 调用 shell_exec 成功，查询 AuditLog.details_json，验证 JSON 解析后包含 tool_type + params + result_code | details_json 中包含必要字段（FR-09） |

#### test_run_tests_integration.py（5 个测试）

| # | 测试名 | 测试内容 | 验证需求 |
|---|--------|----------|----------|
| 1 | `test_run_tests_pytest_success` | mock asyncio.create_subprocess_exec 返回 pytest 输出 "=== 3 passed in 0.5s ==="，调用 run_tests runner="pytest" | resp.status_code==200，result_code==0，redacted_output 解析为 JSON 包含 summary.passed==3 |
| 2 | `test_run_tests_pytest_failures` | mock 返回 "=== 1 passed, 2 failed ==="，调用 run_tests | result_code==1，failures 列表非空 |
| 3 | `test_run_tests_timeout` | mock subprocess 超时，调用 run_tests timeout=1 | result_code==-1，output 包含 "timed out" |
| 4 | `test_run_tests_not_in_policy` | 创建 ToolPolicy allowed_tools=["file_read"]，调用 run_tests | resp.status_code==403（策略白名单） |
| 5 | `test_run_tests_audit_log` | mock 子进程，调用 run_tests，查询 AuditLog | AuditLog 行存在，action=="tool_gateway.run_tests" |

#### test_http_get_integration.py（5 个测试）

| # | 测试名 | 测试内容 | 验证需求 |
|---|--------|----------|----------|
| 1 | `test_http_get_success` | mock httpx 返回 200 + body，创建 ToolPolicy allowed_domains=["api.github.com"]，调用 http_get | result_code==0，output 包含响应内容 |
| 2 | `test_http_get_ssrf_blocked` | mock DNS 解析到 10.0.0.1，创建 ToolPolicy allowed_domains=["evil.com"]，调用 http_get url="https://evil.com" | resp.status_code==403，body 包含 "SSRF" 或 "private IP" |
| 3 | `test_http_get_timeout` | mock httpx.TimeoutException，调用 http_get | result_code==-1，output 包含 "timed out" |
| 4 | `test_http_get_not_in_policy` | 创建 ToolPolicy allowed_tools=["file_read"]，调用 http_get | resp.status_code==403（策略白名单） |
| 5 | `test_http_get_audit_log` | mock httpx，调用 http_get，查询 AuditLog | AuditLog 行存在，action=="tool_gateway.http_get" |

#### test_service.py 扩展（3 个新增测试）

| # | 测试名 | 测试内容 | 验证需求 |
|---|--------|----------|----------|
| 1 | `test_validate_path_with_backslash_traversal` | validate_path(tmp_path, "foo\\..\\..\\etc\\passwd", []) | 抛出 ToolPathForbidden（Windows 风格路径逃逸） |
| 2 | `test_validate_path_symlink_escape` | 创建 symlink 指向 lease 外，validate_path 检测到逃逸 | 抛出 ToolPathForbidden |
| 3 | `test_validate_shell_command_combined_patterns` | validate_shell_command("bash", ["-c", "sudo rm -rf /"]) | 抛出 ToolOperationForbidden（命令参数中嵌入 sudo） |

#### test_router.py 扩展（2 个新增测试）

| # | 测试名 | 测试内容 | 验证需求 |
|---|--------|----------|----------|
| 1 | `test_run_tests_unknown_runner_returns_error` | 调用 run_tests runner="invalid"，mock subprocess | result_code==2（不支持的 runner） |
| 2 | `test_http_get_missing_url_returns_error` | 调用 http_get params={} | result_code==1（缺少 url） |

**合计：12 + 5 + 5 + 3 + 2 = 27 个新增测试**，远超 20 个最低要求。

## 边界处理（必填）

1. **AgentRun 不存在或 tool_policy_id 为 NULL**：测试中创建不关联 ToolPolicy 的 AgentRun（tool_policy_id=None），验证 execute 使用默认策略正常执行。默认策略允许全部 7 种 tool_type，不阻塞任何调用。

2. **ToolPolicy 被删除后 FK SET NULL**：测试中创建 ToolPolicy，创建 AgentRun 关联该 policy，然后删除 ToolPolicy，再调用工具。预期：execute 不报错，使用默认策略。此测试可选（如 AgentRun 的 FK 行为在 task-02 中已测试，此处可跳过以避免测试间耦合）。

3. **params 为空 dict**：HTTP 测试中 `params={}` 传给各 tool_type。file_read 应返回 result_code=1（空路径 resolve 到 lease root，不是文件），shell_exec 应返回 result_code=1（缺少 command），http_get 应返回 result_code=1（缺少 url）。不崩溃。

4. **审计双写原子性**：验证 ToolOperationLog 和 AuditLog 在同一次 execute 后同时存在（查询 DB）。如果 handler 抛出异常（如路径逃逸 403），则不应该有任何日志写入（execute 在 _dispatch 前就抛异常了，不走到写日志步骤）。此行为与当前一致。

5. **mock 策略**：_handle_run_tests 和 _handle_http_get 的 HTTP 级测试中，handler 依赖的外部调用必须 mock：
   - `asyncio.create_subprocess_exec` — mock 为返回预定义 stdout 和 returncode 的 AsyncMock
   - `httpx.AsyncClient.get` — mock 为返回预定义 response 的 AsyncMock
   - `socket.getaddrinfo` — SSRF 测试中 mock DNS 解析结果
   - **不要** mock _load_policy 或 _dispatch，让 execute 的完整流程跑通以验证集成

6. **不修改传入参数**：测试中验证 execute 调用后 params dict 内容不变（可以通过在调用前复制 params，调用后比对来验证，或通过 mock 检查传入 handler 的 params 是否为原始值）。此验证可选，不作为阻塞项。

7. **输出截断与 max_output_size**：创建 ToolPolicy max_output_size=100，handler 返回超长输出，验证 op_log.redacted_output 长度 <= 100。注意：截断发生在 service.execute() 中（`result["output"][:max_output_size]`），不在 handler 中。所以 HTTP 响应的 redacted_output 应 <= 100 字符。

8. **并发安全**：本测试套件不测试并发场景。每个测试独立创建数据、独立运行、独立断言。不依赖测试执行顺序。

## 非目标（本任务不做的事）

- **不修改任何业务代码**：只写/修改测试文件
- **不创建新的 fixture 文件**（conftest.py）：在测试文件中直接定义辅助函数
- **不实现** ToolPolicyService 策略引擎（task-03 负责）
- **不实现** handler 逻辑（task-05、task-06 负责）
- **不实现** execute 集成（task-07 负责）
- **不修改 schema**（task-08 负责）
- **不做性能测试 / 压力测试**：全部是功能测试
- **不做** Policy CRUD 的 HTTP 测试（已在 task-04 的 test_policy_router.py 中覆盖）
- **不做** ToolPolicy 模型的单元测试（已在 task-01 的 test_tool_policy.py 中覆盖）
- **不做** run_tests / http_get handler 的纯单元测试（已在 task-05/06 的测试中覆盖），本任务只做 HTTP 级集成测试
- **不做** schema 校验测试（已在 task-08 中覆盖）

## 参考

- **现有 HTTP 测试模式**：`backend/app/modules/tool_gateway/tests/test_router.py` — `_setup_active_lease` 辅助函数 + `client` fixture + mock 策略
- **现有单元测试模式**：`backend/app/modules/tool_gateway/tests/test_service.py` — TestValidatePath + TestShellValidation 类结构
- **conftest fixture**：`backend/conftest.py` — `db_engine`、`db_session`、`client`、`auth_admin_token` fixture
- **AuditLog 模型**：`backend/app/modules/workflow/model.py` 第 48-84 行 — 审计日志表结构
- **ToolPolicy 模型**：`backend/app/modules/tool_gateway/tool_policy.py`（task-01 产出）— 策略模型
- **AgentRun 模型**：`backend/app/modules/agent/model.py` — AgentRun.tool_policy_id FK（task-02 产出）
- **task-07 接口定义**：`/Users/qinyi/SillyHub/.sillyspec/changes/2026-05-30-tool-gateway/tasks/task-07.md` — execute 改造后流程
- **task-08 接口定义**：`/Users/qinyi/SillyHub/.sillyspec/changes/2026-05-30-tool-gateway/tasks/task-08.md` — schema 扩展后的 ToolExecuteRequest
- **requirements.md**：FR-01~FR-09 的 Given/When/Then 行为规格

## TDD 步骤

### 第一步：确认所有前置任务已完成

```bash
# 确认 task-07 产出的代码已合并
grep -q "run_tests" backend/app/modules/tool_gateway/service.py
grep -q "http_get" backend/app/modules/tool_gateway/service.py
grep -q "_load_policy" backend/app/modules/tool_gateway/service.py
grep -q "_record_audit" backend/app/modules/tool_gateway/service.py

# 确认 task-08 产出的代码已合并
grep -q "run_tests" backend/app/modules/tool_gateway/schema.py
grep -q "http_get" backend/app/modules/tool_gateway/schema.py
```

如果以上任一 grep 失败，说明前置任务未完成，暂停并报告。

### 第二步：写测试

按以下顺序编写测试文件：

1. **test_policy_integration.py** — 核心集成测试（12 个）
2. **test_run_tests_integration.py** — run_tests 集成测试（5 个）
3. **test_http_get_integration.py** — http_get 集成测试（5 个）
4. **test_service.py 扩展** — 追加 3 个测试
5. **test_router.py 扩展** — 追加 2 个测试

### 第三步：运行测试

```bash
cd /Users/qinyi/SillyHub/backend
python -m pytest app/modules/tool_gateway/tests/ -v --tb=short
```

预期：新增 27 个测试全部 PASSED。如果前置任务实现有 bug，根据失败信息定位问题，在测试中标注 `@pytest.mark.xfail` 并记录原因。

### 第四步：回归

```bash
cd /Users/qinyi/SillyHub/backend
python -m pytest --tb=short -q
```

预期：所有已有测试 + 新增 27 个测试全部 PASSED。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | `test_policy_integration.py` 文件存在且包含 >=12 个测试 | 文件存在，`pytest` 收集到 >=12 个测试函数 |
| AC-02 | `test_run_tests_integration.py` 文件存在且包含 >=5 个测试 | 文件存在，`pytest` 收集到 >=5 个测试函数 |
| AC-03 | `test_http_get_integration.py` 文件存在且包含 >=5 个测试 | 文件存在，`pytest` 收集到 >=5 个测试函数 |
| AC-04 | `test_service.py` 新增 >=3 个测试 | 文件中新增测试函数（TestValidatePath / TestShellValidation 类之外的测试） |
| AC-05 | `test_router.py` 新增 >=2 个测试 | 文件中新增测试函数 |
| AC-06 | 新增测试总数 >= 20 | `pytest --collect-only app/modules/tool_gateway/tests/ | grep "<Function"` 统计新增测试 >= 20 |
| AC-07 | `pytest app/modules/tool_gateway/tests/ -v` 全部通过 | 0 failed, 0 errors，已有测试 + 新增测试全部 PASSED |
| AC-08 | FR-02 默认策略验证通过 | `test_default_policy_allows_all_tools` PASSED — 不关联 policy 时 7 种 tool_type 全部正常 |
| AC-09 | FR-03 工具白名单验证通过 | `test_tool_not_in_allowed_tools_blocked` + `test_tool_in_allowed_tools_passes` PASSED |
| AC-10 | FR-05 命令黑名单验证通过 | `test_blocked_command_by_policy` + `test_global_blacklist_still_applies` PASSED |
| AC-11 | FR-06 资源限制验证通过 | `test_timeout_capped_by_policy` + `test_output_truncated_by_policy` PASSED |
| AC-12 | FR-07 run_tests 集成验证通过 | `test_run_tests_pytest_success` + `test_run_tests_pytest_failures` + `test_run_tests_timeout` PASSED |
| AC-13 | FR-08 http_get 域名白名单 + SSRF 验证通过 | `test_http_get_success` + `test_http_get_domain_blocked` + `test_http_get_ssrf_blocked` PASSED |
| AC-14 | FR-09 审计双写验证通过 | `test_audit_dual_write_on_success` + `test_audit_log_details_json_structure` PASSED — ToolOperationLog 和 AuditLog 同时存在 |
| AC-15 | 全量回归无失败 | `pytest --tb=short -q` 全部通过，0 failed，0 errors |
| AC-16 | 测试独立可运行 | 每个测试文件可独立执行：`pytest app/modules/tool_gateway/tests/test_policy_integration.py -v` 通过 |
