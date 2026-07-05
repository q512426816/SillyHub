---
id: task-08
title: "E2E验证 — 全流程测试"
priority: P0
estimated_hours: 2
depends_on:
  - task-01
  - task-02
  - task-03
  - task-04
  - task-05
  - task-06
  - task-07
blocks: []
allowed_paths:
  - backend/app/modules/change/tests/
  - backend/app/modules/change_writer/tests/
---

# Task-08: E2E验证 — 全流程测试

## 背景

本任务是工作流引擎重设计的最终验收环节，依赖 task-01 至 task-07 全部完成。目标是通过端到端集成测试覆盖完整生命周期路径，确保状态机流转、Agent 边界守卫、反馈分类、归档门禁等核心功能在真实数据库环境中协同工作。同时提供手动浏览器测试步骤用于前端验证。

## 修改文件

|| 操作 | 文件路径 || 说明 ||
|------|----------|------|
| 新增 | `backend/app/modules/change/tests/test_e2e_workflow.py` | 全流程 E2E 集成测试（状态机完整链路 + Agent 守卫 + 反馈提交 + 归档门禁） |
| 新增 | `backend/app/modules/change_writer/tests/test_e2e_agent_guard.py` | Agent 边界守卫 E2E 集成测试（execute_change 端点级验证） |

> 测试文件放在各自模块的 `tests/` 目录下，与模块代码同属 allowed_paths。

## 实现要求

### 1. 全链路流转测试 — `test_e2e_full_transition_chain`

验证 change 从创建到归档的 **完整 8 步正向流转链路**，每一步都真实写入数据库并读回验证：

```
draft → clarifying → design_review → ready_for_dev
  → in_dev → technical_verification → business_review → accepted → archived
```

```python
async def test_e2e_full_transition_chain(db_session, workspace, reviewer_user):
    """
    E2E: 完整正向流转链路 draft → archived。
    
    步骤:
    1. 创建 change，断言 current_stage == "draft"
    2. 调用 POST /transition (actor=business_user) → clarifying
    3. 调用 POST /transition (actor=reviewer) → design_review
    4. 调用 POST /transition (actor=reviewer) → ready_for_dev
    5. 调用 POST /transition (actor=system) → in_dev
    6. 调用 POST /transition (actor=agent) → technical_verification
    7. 调用 POST /transition (actor=reviewer) → business_review
    8. 调用 POST /transition (actor=reviewer) → accepted
    9. 满足归档门禁 → 调用 POST /transition (actor=system) → archived
    
    每步断言:
    - 响应 HTTP 200
    - 响应体 current_stage == 目标阶段
    - DB 查询确认 stage 已持久化
    - updated_at 发生变化
    """
```

**实现要点**：
- 使用真实 DB session（`db_session` fixture），不 mock service 层
- 每次流转后从 DB 重新查询 change 对象，断言 `current_stage` 与预期一致
- `system` 角色流转（`ready_for_dev → in_dev`、`accepted → archived`）需通过内部 API 或直接调用 service 方法模拟
- 在 `accepted` 阶段先调用 `check_archive_gate`，确保 `can_archive == True`，再执行归档

### 2. Agent 守卫测试 — `test_e2e_agent_guard_returns_409`

验证 `execute_change` 端点在不同阶段下的 409 拒绝行为：

```python
async def test_e2e_agent_guard_returns_409_when_not_ready(db_session, workspace, change):
    """
    E2E: Agent execute_change 在非 ready_for_dev 阶段返回 409。
    
    测试矩阵:
    | current_stage           | 预期 HTTP 状态 |
    |--------------------------|---------------|
    | draft                    | 409 Conflict  |
    | clarifying               | 409 Conflict  |
    | design_review            | 409 Conflict  |
    | in_dev                   | 409 Conflict  |
    | technical_verification   | 409 Conflict  |
    | business_review          | 409 Conflict  |
    | accepted                 | 409 Conflict  |
    | archived                 | 409 Conflict  |
    | ready_for_dev            | 200 OK        |
    
    409 响应体需包含:
    - 错误消息中包含当前阶段名称
    - 错误消息中包含 "ready_for_dev"
    """
```

**实现要点**：
- 对每个非 `ready_for_dev` 阶段创建一个 change 并设置其 `current_stage`，然后调用 `execute_change` 端点
- 验证 `ready_for_dev` 阶段能正常调用（200 OK），需 mock 协调器避免真实执行
- 409 响应 body 的 `detail` 字段应包含当前阶段和期望阶段信息

### 3. 反馈分类测试 — A/B/C/D 四类反馈

```python
async def test_e2e_feedback_category_A_routes_to_in_dev(db_session, ...):
    """
    E2E: category=A (bug) 提交后，stage 从 business_review → rework_required → in_dev。
    验证 feedback_category 字段被持久化为 'A'。
    """

async def test_e2e_feedback_category_B_routes_to_design_review(db_session, ...):
    """
    E2E: category=B (requirement_error) 提交后，stage 从 business_review → rework_required → design_review。
    验证 feedback_category 字段被持久化为 'B'。
    """

async def test_e2e_feedback_category_C_routes_to_clarifying(db_session, ...):
    """
    E2E: category=C (ambiguity) 提交后，stage 从 business_review → rework_required → clarifying。
    验证 feedback_category 字段被持久化为 'C'。
    """

async def test_e2e_feedback_category_D_routes_to_accepted(db_session, ...):
    """
    E2E: category=D (new_requirement) 提交后，当前 change 标记为 accepted（不走 rework）。
    验证 feedback_category 字段被持久化为 'D'。
    """

async def test_e2e_feedback_text_persisted(db_session, ...):
    """
    E2E: 反馈文本内容完整持久化。提交 "按钮颜色与设计稿不符" 后，
    从 DB 查询 change.feedback_text == "按钮颜色与设计稿不符"。
    """
```

**实现要点**：
- 每个 category 测试需将 change 预置到 `business_review` 阶段
- 反馈提交后先进入 `rework_required`，再根据 category 路由到目标阶段
- category=D 特殊处理：不走 rework，直接标记为 accepted
- 验证 DB 中 `feedback_category` 和 `feedback_text` 均正确持久化
- 验证 `reviewer_id` 被正确设置为提交反馈的用户 ID

### 4. 归档门禁测试 — `test_e2e_archive_gate`

```python
async def test_e2e_archive_gate_all_pass(db_session, ...):
    """
    E2E: accepted 阶段的 change，满足所有 6 项门禁检查，
    archive-gate 返回 can_archive=True，checks 全部 passed=True。
    
    前置条件准备:
    - change 处于 accepted 阶段
    - feedback_category 为 None（无未解决反馈）
    - 相关文档标记为 completed
    - 无未关闭的子 change
    """

async def test_e2e_archive_gate_partial_fail(db_session, ...):
    """
    E2E: accepted 阶段的 change，部分检查项失败，
    archive-gate 返回 can_archive=False，failed_checks 列出具体失败项。
    
    场景: 有未解决反馈 + 文档未完成 → 2 项 failed。
    """

async def test_e2e_archive_gate_wrong_stage(db_session, ...):
    """
    E2E: 非 accepted 阶段（如 in_dev）调用 archive-gate，
    返回 can_archive=False，checks 中有 "stage_not_accepted" 失败项。
    """

async def test_e2e_archive_gate_each_check_independent(db_session, ...):
    """
    E2E: 逐项验证 6 项检查的独立性。分别让每项检查失败，
    确认只有该项 passed=False，其余不受影响。
    """
```

**实现要点**：
- 门禁 6 项检查需逐项验证：`no_unresolved_feedback`、`ac_confirmed`、`tech_verification_passed`、`business_review_passed`、`feedback_categorized`、`documents_complete`
- 部分依赖项（如 CI 状态、PR 合并状态）在 E2E 环境中可能无法真实模拟，可通过 test fixture 预置状态或 mock 外部依赖
- 归档门禁是纯查询操作，不修改任何状态

### 5. 手动浏览器测试步骤

以下为 QA 人员提供的手动验证清单，不在自动化测试范围内：

**前置条件**：本地 dev server 运行中（`make dev`）

| 步骤 | 操作 | 预期结果 |
|------|------|----------|
| M1 | 创建新 change | 列表页显示新 change，badge 显示 "draft" |
| M2 | 进入 change 详情页 | 看到阶段进度条，当前高亮 "draft" |
| M3 | 点击流转按钮，draft → clarifying | 进度条更新，badge 变为 "clarifying"（颜色变化） |
| M4 | 依次流转至 ready_for_dev | 进度条逐步推进，每个阶段正确显示 |
| M5 | 点击 "执行变更" 按钮 | Agent 开始执行，stage 变为 "in_dev" |
| M6 | 流转至 business_review | 出现反馈表单区域 |
| M7 | 提交 A 类反馈 | stage 变为 "rework_required"，再路由回 "in_dev" |
| M8 | 重新流转至 accepted | 反馈表单消失，显示归档检查面板 |
| M9 | 查看归档门禁面板 | 6 项检查显示通过/失败状态 |
| M10 | 满足所有检查后点击归档 | change 状态变为 "archived"，进度条完成 |

## 接口定义

### 测试模块公开 API

本任务不新增生产代码，仅新增测试。测试文件导出如下：

| 符号 | 类型 | 说明 |
|------|------|------|
| `test_e2e_full_transition_chain` | async test | 完整 8 步正向流转链路 |
| `test_e2e_agent_guard_returns_409_when_not_ready` | async test | Agent 守卫 9 种阶段矩阵 |
| `test_e2e_feedback_category_A_routes_to_in_dev` | async test | A 类反馈路由 |
| `test_e2e_feedback_category_B_routes_to_design_review` | async test | B 类反馈路由 |
| `test_e2e_feedback_category_C_routes_to_clarifying` | async test | C 类反馈路由 |
| `test_e2e_feedback_category_D_routes_to_accepted` | async test | D 类反馈路由 |
| `test_e2e_feedback_text_persisted` | async test | 反馈文本持久化 |
| `test_e2e_archive_gate_all_pass` | async test | 归档门禁全通过 |
| `test_e2e_archive_gate_partial_fail` | async test | 归档门禁部分失败 |
| `test_e2e_archive_gate_wrong_stage` | async test | 非 accepted 阶段调用门禁 |
| `test_e2e_archive_gate_each_check_independent` | async test | 6 项检查独立性 |
| `test_e2e_rework_loop_max_iterations` | async test | 返工循环上限（最大 5 次） |

### 共享 Fixture

```python
@pytest.fixture
async def workspace_with_change(db_session) -> tuple:
    """创建 workspace + 预置 change（stage=draft），返回 (workspace, change)。"""

@pytest.fixture
async def change_at_stage_factory(db_session):
    """工厂 fixture：接受 target_stage 参数，创建并返回处于指定阶段的 change。"""
    async def _factory(stage: str, **kwargs) -> Change:
        # 创建 change → 依次流转至目标 stage
        ...
    return _factory

@pytest.fixture
async def reviewer_user(db_session) -> User:
    """创建具有 reviewer 角色的测试用户。"""

@pytest.fixture
async def business_user(db_session) -> User:
    """创建具有 business_user 角色的测试用户。"""

@pytest.fixture
def mock_coordinator():
    """Mock ExecutionCoordinatorService，阻止 Agent 真实执行。"""
```

## 边界处理

1. **返工循环上限**：`rework_required` → 修复 → 再 review → 再次 `rework_required` 的循环不得超过 5 次。第 6 次提交反馈时 service 层应抛出异常或拒绝流转。E2E 测试需验证此上限生效：创建 change，连续触发 5 次 rework 循环后，第 6 次提交反馈应返回错误。

2. **`archived` 终态不可逆**：change 归档后，任何流转请求（包括从 `archived` 到其他阶段）必须被拒绝。E2E 测试需验证归档后尝试 `archived → accepted` 流转返回 400/409。

3. **并发流转冲突**：两个用户同时对同一 change 执行不同流转（如一个推到 `business_review`，一个退回 `rework_required`），至少一个应失败（基于乐观锁或数据库行锁）。E2E 测试使用 `asyncio.gather` 并发发起两个冲突请求，验证至少一个返回冲突错误。

4. **`current_stage` 为 None 的旧数据**：迁移前的 change 记录 `current_stage` 可能为 `None`。E2E 测试需构造此场景：手动将 `current_stage` 设为 `None`，然后调用 `execute_change`，验证返回 409（守卫将 None 视为 `draft`），以及调用 `archive-gate` 返回 `can_archive=False`。

5. **反馈提交的阶段限制**：反馈仅在 `technical_verification` 和 `business_review` 阶段可提交。E2E 测试需验证在 `draft`、`clarifying`、`design_review`、`ready_for_dev`、`in_dev`、`accepted`、`archived` 阶段提交反馈均返回错误（400 或 422）。

6. **反馈 category 无效值**：提交 `category="X"` 时 Pydantic 校验应返回 422。E2E 测试通过 HTTP 端点直接发送非法 JSON body，验证 422 响应。

7. **归档门禁外部依赖超时**：当 CI 状态或 PR 查询超时（>5s）时，对应检查项应标记为 `unknown` 而非 `failed`，且 `can_archive` 应为 `False`。E2E 测试通过 mock 外部服务延迟 >5s 验证此行为。

8. **`design_review` 退回到 `clarifying` 的反向流转**：正向链路之外的退回路径需单独测试。在 `design_review` 阶段，reviewer 可选择退回到 `clarifying`（补充信息），而非推进到 `ready_for_dev`。E2E 测试验证此退回后可重新推进到 `design_review` → `ready_for_dev`。

## 非目标

- ❌ 不修改任何生产代码文件 — 本任务仅新增测试
- ❌ 不新增 fixture 到 conftest.py 之外的共享文件
- ❌ 不实现性能测试 / 压力测试
- ❌ 不测试前端组件渲染（前端测试由 task-06/07 负责）
- ❌ 不测试 WebSocket / SSE 推送通知
- ❌ 不测试 RBAC 角色系统的完整权限矩阵（由后续迭代补充）
- ❌ 不测试乐观并发控制的 version 字段（由后续 task 补充）
- ❌ 不在 CI 环境中运行完整 E2E（手动浏览器测试仅限本地）
- ❌ 不测试 DB 迁移的回滚（rollback）逻辑

## TDD 步骤

### Step 1 — 创建测试文件与 fixture

```bash
# 创建目录结构
mkdir -p backend/app/modules/change/tests
mkdir -p backend/app/modules/change_writer/tests
touch backend/app/modules/change/tests/__init__.py
touch backend/app/modules/change_writer/tests/__init__.py
```

编写共享 fixture：
- `workspace_with_change`
- `change_at_stage_factory`
- `reviewer_user` / `business_user`
- `mock_coordinator`

### Step 2 — 写测试（Red）

```python
# === test_e2e_workflow.py ===

# 全链路流转
async def test_e2e_full_transition_chain(...):
    """完整正向流转 draft → archived"""
    # 预期：FAIL — 测试文件已创建但尚无被测代码问题
    # 实际：依赖 task-01~04 的生产代码，此步骤验证测试框架可运行

# Agent 守卫
async def test_e2e_agent_guard_returns_409_when_not_ready(...):
    """Agent execute_change 在非 ready_for_dev 返回 409"""

# 反馈分类
async def test_e2e_feedback_category_A_routes_to_in_dev(...):
async def test_e2e_feedback_category_B_routes_to_design_review(...):
async def test_e2e_feedback_category_C_routes_to_clarifying(...):
async def test_e2e_feedback_category_D_routes_to_accepted(...):
async def test_e2e_feedback_text_persisted(...):

# 归档门禁
async def test_e2e_archive_gate_all_pass(...):
async def test_e2e_archive_gate_partial_fail(...):
async def test_e2e_archive_gate_wrong_stage(...):
async def test_e2e_archive_gate_each_check_independent(...):

# 边界
async def test_e2e_rework_loop_max_iterations(...):
async def test_e2e_archived_is_sink(...):
async def test_e2e_concurrent_transition_conflict(...):
async def test_e2e_feedback_stage_guard(...):
async def test_e2e_design_review_rejection_to_clarifying(...):
```

```python
# === test_e2e_agent_guard.py ===

async def test_e2e_execute_change_ready_for_dev_ok(...):
async def test_e2e_execute_change_draft_409(...):
async def test_e2e_execute_change_clarifying_409(...):
async def test_e2e_execute_change_design_review_409(...):
async def test_e2e_execute_change_in_dev_409(...):
async def test_e2e_execute_change_technical_verification_409(...):
async def test_e2e_execute_change_business_review_409(...):
async def test_e2e_execute_change_accepted_409(...):
async def test_e2e_execute_change_archived_409(...):
async def test_e2e_execute_change_null_stage_409(...):
async def test_e2e_execute_change_not_found_404(...):
async def test_e2e_execute_change_409_message_format(...):
```

### Step 3 — 确认 Red

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest \
    backend/app/modules/change/tests/test_e2e_workflow.py \
    backend/app/modules/change_writer/tests/test_e2e_agent_guard.py \
    -v --tb=short
# 预期：全部 FAIL（task-01~04 生产代码可能尚未完成或测试结构需调整）
```

### Step 4 — 确认 Green（所有上游 task 完成后）

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest \
    backend/app/modules/change/tests/test_e2e_workflow.py \
    backend/app/modules/change_writer/tests/test_e2e_agent_guard.py \
    -v --tb=short
# 预期：全部 PASSED
```

### Step 5 — 全量回归

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest backend/ -v
# 预期：所有现有测试 + 新 E2E 测试均通过，无回归
```

### Step 6 — 手动浏览器测试

按照 §5 手动测试步骤 M1-M10 逐项执行，记录结果。

## 验收标准

| # | 标准 | 验证方法 |
|---|------|----------|
| AC-1 | 完整正向流转链路测试通过：`draft → clarifying → design_review → ready_for_dev → in_dev → technical_verification → business_review → accepted → archived`，每步 DB 持久化正确 | `test_e2e_full_transition_chain` PASSED |
| AC-2 | Agent 守卫测试矩阵通过：9 种非 `ready_for_dev` 阶段均返回 409，`ready_for_dev` 返回 200，409 消息包含阶段信息 | `test_e2e_agent_guard_returns_409_when_not_ready` 及 12 个子测试全部 PASSED |
| AC-3 | A/B/C/D 四类反馈路由正确：A→`in_dev`、B→`design_review`、C→`clarifying`、D→`accepted`，`feedback_category` 和 `feedback_text` 均持久化 | 4 个 `test_e2e_feedback_category_*` + `test_e2e_feedback_text_persisted` 全部 PASSED |
| AC-4 | 归档门禁 6 项检查可独立通过/失败，`can_archive` 与检查结果一致 | `test_e2e_archive_gate_*` 4 个测试全部 PASSED |
| AC-5 | `archived` 终态不可流出：归档后任何流转请求均被拒绝 | `test_e2e_archived_is_sink` PASSED |
| AC-6 | 返工循环上限生效：第 6 次 rework 触发时返回错误 | `test_e2e_rework_loop_max_iterations` PASSED |
| AC-7 | 反馈提交的阶段守卫生效：非 `technical_verification`/`business_review` 阶段提交反馈返回错误 | `test_e2e_feedback_stage_guard` PASSED |
| AC-8 | `design_review` 退回到 `clarifying` 后可重新正向推进 | `test_e2e_design_review_rejection_to_clarifying` PASSED |
| AC-9 | 全量后端测试无回归：新增 E2E 测试不影响任何现有测试 | `pytest backend/` 全部 PASSED，无 skip 无 xfail |
| AC-10 | 手动浏览器测试 M1-M10 全部通过 | QA 人员签字确认或截图记录 |
