---
id: task-03
title: Backend工作流服务 — service.py 新增 transition / submit_feedback / check_archive_gate
priority: P0
estimated_hours: 3
depends_on:
  - task-01
  - task-02
blocks:
  - task-04
allowed_paths:
  - backend/app/modules/change/service.py
  - backend/app/modules/change/schema.py
---

# task-03: Backend 工作流服务核心方法

## 背景

本任务在 task-01（`StageEnum` + `TRANSITIONS` 字典 + DB 字段）和 task-02（迁移脚本 + 旧状态映射）的基础上，在 `ChangeService` 中新增三个核心工作流方法，构成整个 Change Workflow Engine 的业务逻辑层。

- **`transition()`** — 状态流转引擎，校验合法转换与角色权限，更新 `current_stage` 并写入 stages JSON 日志
- **`submit_feedback()`** — 反馈提交，保存 `feedback_category` / `feedback_text`，根据类别确定返工目标阶段，自动流转至 `rework_required`
- **`check_archive_gate()`** — 归档门禁，检查 6 项前置条件，返回结构化的通过/未通过报告

这三个方法被 task-04 的 router 层直接调用，是整个工作流的"大脑"。

## 修改文件

| 操作 | 文件路径 |
|------|----------|
| 修改 | `backend/app/modules/change/service.py` — 在 `ChangeService` 类中追加 3 个核心方法 |
| 修改 | `backend/app/modules/change/schema.py` — 追加 `TransitionRequest`、`FeedbackRequest`、`ArchiveGateResponse`、`ArchiveCheckItem` DTO |

## 实现要求

### 1. schema.py — 新增 4 个 Pydantic DTO

在文件末尾追加以下 DTO，与现有 schema 格式保持一致：

```python
# ── Workflow (task-03) ──────────────────────────────────────────────────


class TransitionRequest(BaseModel):
    """状态流转请求。"""
    target_stage: str = Field(..., description="目标阶段，对应 StageEnum 值")
    reason: str | None = Field(default=None, description="流转原因（可选）")


class FeedbackRequest(BaseModel):
    """反馈提交请求。"""
    category: str = Field(..., pattern=r"^[A-D]$", description="反馈类别: A=Bug, B=设计错误, C=信息不足, D=衍生新change")
    text: str = Field(..., min_length=1, max_length=2000, description="反馈内容")
    target_stage: str | None = Field(default=None, description="自定义返工目标（覆盖类别默认值，可选）")


class ArchiveCheckItem(BaseModel):
    """归档门禁单项检查结果。"""
    name: str = Field(..., description="检查项名称")
    passed: bool
    detail: str = Field(default="", description="未通过时的说明信息")


class ArchiveGateResponse(BaseModel):
    """归档门禁检查结果。"""
    can_archive: bool
    checks: list[ArchiveCheckItem] = Field(default_factory=list)
```

### 2. service.py — transition() 方法

在 `ChangeService` 类的 `# ── Progress / Approval / Documents` 区域之后（或 `reparse` 区域之前）追加 `# ── Workflow` 区域：

```python
# ── Workflow ────────────────────────────────────────────────────────────

async def transition(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    target_stage: str,
    user_role: str,
    *,
    reason: str | None = None,
) -> Change:
    """执行状态流转。

    Args:
        workspace_id: 工作空间 ID
        change_id: 变更 ID
        target_stage: 目标阶段（StageEnum 值）
        user_role: 当前操作者角色（business_user / reviewer / agent / system）
        reason: 可选流转原因

    Returns:
        更新后的 Change 对象

    Raises:
        InvalidTransition: 流转不合法（不在 TRANSITIONS 表中）
        PermissionDenied: 角色无权执行此流转
        ChangeNotFound: change 不存在
    """
    # 伪代码：
    # 1. 调用 self.get(workspace_id, change_id) 获取 change
    # 2. current = change.current_stage or "draft"
    # 3. 从 TRANSITIONS[current] 查找 target_stage 对应的 allowed_roles
    #    - 如果 target_stage 不在 TRANSITIONS[current] 中 → raise InvalidTransition
    #    - 如果 user_role 不在 allowed_roles 中 → raise PermissionDenied
    # 4. 记录流转日志到 change.stages JSON：
    #    stages = change.stages or {}
    #    transitions_log = stages.get("transitions", [])
    #    transitions_log.append({
    #        "from": current,
    #        "to": target_stage,
    #        "by_role": user_role,
    #        "reason": reason,
    #        "at": datetime.now(timezone.utc).isoformat(),
    #    })
    #    stages["transitions"] = transitions_log
    # 5. 更新 change.current_stage = target_stage
    # 6. 更新 change.stages = stages
    # 7. 更新 change.updated_at = now
    # 8. session.add(change) + session.commit()
    # 9. return change
```

### 3. service.py — submit_feedback() 方法

```python
async def submit_feedback(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    category: str,
    text: str,
    user_id: uuid.UUID,
    *,
    target_stage: str | None = None,
) -> Change:
    """提交反馈并自动流转至 rework_required。

    反馈类别 → 返工目标映射（design.md §4）：
      A → in_dev（Bug/快速修复）
      B → design_review（需求理解错误）
      C → clarifying（歧义/信息不足）
      D → accepted（衍生新 change，当前标记通过后另开）

    Args:
        workspace_id: 工作空间 ID
        change_id: 变更 ID
        category: 反馈类别 "A" | "B" | "C" | "D"
        text: 反馈内容
        user_id: 提交者 ID
        target_stage: 可选自定义返工目标（覆盖类别默认值）

    Returns:
        更新后的 Change 对象（stage 为 rework_required）

    Raises:
        ValueError: category 不在 A-D 范围内
        InvalidTransition: 当前 stage 不允许提交反馈
    """
    # 伪代码：
    # 1. 验证 category in ("A", "B", "C", "D")，否则 raise ValueError
    # 2. FEEDBACK_TARGETS = {"A": "in_dev", "B": "design_review", "C": "clarifying", "D": "accepted"}
    # 3. rework_target = target_stage or FEEDBACK_TARGETS[category]
    # 4. 调用 self.get(workspace_id, change_id) 获取 change
    # 5. 校验 change.current_stage in ("technical_verification", "business_review")
    #    - 否则 raise InvalidTransition("当前阶段不允许提交反馈")
    # 6. 保存反馈信息：
    #    change.feedback_category = category
    #    change.feedback_text = text
    #    change.reviewer_id = user_id
    # 7. 更新 stages JSON 中的 rework 信息：
    #    stages = change.stages or {}
    #    stages["last_feedback"] = {
    #        "category": category,
    #        "text": text,
    #        "rework_target": rework_target,
    #        "submitted_by": str(user_id),
    #        "submitted_at": datetime.now(timezone.utc).isoformat(),
    #    }
    #    change.stages = stages
    # 8. 如果 category == "D"：
    #    - 先执行内部流转：change.current_stage = "accepted"
    #    - 在 stages 日志中记录特殊流转
    # 9. 否则：
    #    - 调用 self.transition(workspace_id, change_id, "rework_required", "reviewer",
    #                           reason=f"反馈类别 {category}: {text[:100]}")
    #    - 在 stages 日志中记录 rework_target = rework_target
    # 10. session.add(change) + session.commit()
    # 11. return change
```

### 4. service.py — check_archive_gate() 方法

```python
async def check_archive_gate(
    self,
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
) -> ArchiveGateResponse:
    """归档门禁检查。

    从 accepted → archived 需通过 6 项检查（design.md §5）：
      1. 无未解决反馈 — feedback_category 为 null 或已关闭
      2. 所有 AC 确认 — stages["ac_confirmed"] == true
      3. 技术验证通过 — stages["tech_verification_passed"] == true
      4. 业务评审通过 — stages["business_review_passed"] == true
      5. 反馈已分类 — 无未分类的反馈记录
      6. 所有文档完成 — 所有 ChangeDocument.status 不为 null/empty

    Args:
        workspace_id: 工作空间 ID
        change_id: 变更 ID

    Returns:
        ArchiveGateResponse(can_archive, checks)
    """
    # 伪代码：
    # 1. 调用 self.get(workspace_id, change_id) 获取 change
    # 2. 校验 change.current_stage == "accepted"，否则所有检查标记为未通过
    #    （归档门禁仅在 accepted 阶段有意义）
    # 3. 依次执行 6 项检查（见下方详细实现说明）
    # 4. can_archive = all(check.passed for check in checks)
    # 5. return ArchiveGateResponse(can_archive=can_archive, checks=checks)
```

**6 项检查详细逻辑**：

```python
checks: list[ArchiveCheckItem] = []

# Check 1: 无未解决反馈
# passed = change.feedback_category is None
checks.append(ArchiveCheckItem(
    name="no_unresolved_feedback",
    passed=change.feedback_category is None,
    detail="" if change.feedback_category is None
           else f"存在未解决反馈，类别: {change.feedback_category}",
))

# Check 2: 所有 AC 确认
stages = change.stages or {}
ac_confirmed = stages.get("ac_confirmed", False)
checks.append(ArchiveCheckItem(
    name="ac_confirmed",
    passed=bool(ac_confirmed),
    detail="" if ac_confirmed else "验收标准尚未确认",
))

# Check 3: 技术验证通过
tech_passed = stages.get("tech_verification_passed", False)
checks.append(ArchiveCheckItem(
    name="tech_verification_passed",
    passed=bool(tech_passed),
    detail="" if tech_passed else "技术验证未通过",
))

# Check 4: 业务评审通过
biz_passed = stages.get("business_review_passed", False)
checks.append(ArchiveCheckItem(
    name="business_review_passed",
    passed=bool(biz_passed),
    detail="" if biz_passed else "业务评审未通过",
))

# Check 5: 反馈已分类
# 如果 feedback_category 不为 None，说明有反馈但已分类（Check 1 会失败）
# 此检查确保 stages 中不存在 uncategorized 反馈
feedback_records = stages.get("feedback_history", [])
uncategorized = [f for f in feedback_records if not f.get("category")]
checks.append(ArchiveCheckItem(
    name="feedback_categorized",
    passed=len(uncategorized) == 0,
    detail="" if not uncategorized
           else f"{len(uncategorized)} 条反馈未分类",
))

# Check 6: 所有文档完成
docs, _, _ = await self.get_documents(workspace_id, change_id)
incomplete = [d for d in docs if not d.status and d.exists]
checks.append(ArchiveCheckItem(
    name="documents_complete",
    passed=len(incomplete) == 0,
    detail="" if not incomplete
           else f"{len(incomplete)} 个文档未完成",
))
```

### 5. 新增 import

在 `service.py` 顶部追加必要的 import（如果尚未引入）：

```python
from app.core.errors import ChangeDocNotFound, ChangeNotFound  # 已有
# 新增：
from app.core.errors import InvalidTransition, PermissionDenied  # 如不存在需在 errors.py 中定义
from app.modules.change.schema import ArchiveGateResponse, ArchiveCheckItem  # 新 DTO
```

> **注意**：`InvalidTransition` 和 `PermissionDenied` 异常类需确认已在 `app/core/errors.py` 中定义。如果未定义，在本任务的 `allowed_paths` 约束下，应使用通用的 `ValueError` 或 `AppError` 作为替代，并在代码注释中标注后续由 task-04 统一补充。

## 接口定义

### 方法签名汇总

```python
class ChangeService:
    # ... 现有方法 ...

    # ── Workflow ────────────────────────────────────────────────────────

    async def transition(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        target_stage: str,
        user_role: str,
        *,
        reason: str | None = None,
    ) -> Change: ...

    async def submit_feedback(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        category: str,
        text: str,
        user_id: uuid.UUID,
        *,
        target_stage: str | None = None,
    ) -> Change: ...

    async def check_archive_gate(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> ArchiveGateResponse: ...
```

### DTO 定义

见上方「实现要求 §1」。

## 边界处理

1. **transition — 当前阶段与目标阶段相同**：`TRANSITIONS[current].get(target)` 返回 `None`（因为 TRANSITIONS 字典中不存在 `draft → draft` 这样的自环），直接抛出 `InvalidTransition("已在目标阶段，无需流转")`。不允许无意义的状态自流转。

2. **transition — change.current_stage 为 None**：视为 `draft`（新建 change 未设置 stage 的默认值）。在方法入口处 `current = change.current_stage or "draft"` 处理。

3. **transition — TRANSITIONS 字典中 current 不存在**：如果 `current` 不是 `StageEnum` 的合法值（如旧数据或脏数据），`TRANSITIONS.get(current)` 返回 `None`，抛出 `InvalidTransition(f"未知阶段: {current}")`。

4. **submit_feedback — 当前阶段不允许提交反馈**：仅 `technical_verification` 和 `business_review` 两个阶段可提交反馈。其他阶段调用时抛出 `InvalidTransition("当前阶段不允许提交反馈，仅限 technical_verification 和 business_review")`。

5. **submit_feedback — category 为 "D" 的特殊处理**：D 类反馈表示"衍生新 change"，不进入 `rework_required` 而是直接流转到 `accepted`（当前 change 标记通过，新需求另开 change 处理）。此分支不调用 `transition()`，而是直接更新 stage 并记录日志，避免 `accepted → rework_required` 的非法流转。

6. **submit_feedback — text 为空或超长**：Pydantic DTO 层已通过 `min_length=1, max_length=2000` 约束。service 层不做二次校验，信任 schema 验证结果。

7. **check_archive_gate — change 不在 accepted 阶段**：所有 6 项检查均标记为 `passed=False`，`can_archive=False`，detail 统一标注"当前阶段非 accepted，无法归档"。不抛异常，返回完整的检查报告。

8. **check_archive_gate — stages JSON 为 None 或缺少字段**：所有 `stages.get(key, False)` 的默认值为 `False`，确保不因 JSON 字段缺失而崩溃。`feedback_history` 默认为空列表。

9. **check_archive_gate — 文档列表为空**：`get_documents` 返回空列表时，`incomplete` 也为空列表，检查通过（无文档需求 = 文档完成）。这与"无文档不算完成"的解读一致：如果没有关联文档，说明该 change 不需要文档。

10. **并发安全**：`transition()` 和 `submit_feedback()` 在更新前通过 `self.get()` 获取最新数据，但在高并发场景下仍可能存在竞态。当前版本依赖数据库行级锁（SELECT FOR UPDATE 在 router 层或 service 层），乐观并发控制（version 字段）由后续迭代补充。

## 非目标（本任务不做的事）

- **不修改** `backend/app/modules/change/model.py` — model 层变更（`StageEnum`、`TRANSITIONS`、新字段）由 task-01 负责
- **不修改** `backend/app/modules/change/router.py` — router 层端点由 task-04 负责
- **不创建** 新的 Alembic 迁移 — 数据库变更由 task-02 负责
- **不修改** `backend/app/modules/change_writer/service.py` — `create_change` 默认 `draft` → `clarifying` 流转不在本任务范围
- **不修改** `backend/app/modules/change_writer/router.py` — `execute_change` 守卫不在本任务范围
- **不实现** PR 合并检查、CI pipeline 检查 — 归档门禁 v1 仅检查 stages JSON 中的布尔标记和文档状态，外部系统集成由后续迭代补充
- **不实现** 乐观并发控制（version 字段）— 由后续 task 补充
- **不实现** 最大返工次数限制 — design.md R3 中提到的防循环机制由后续迭代补充
- **不修改** `backend/app/core/errors.py` — 如 `InvalidTransition` / `PermissionDenied` 不存在，本任务使用 `ValueError` 替代并标注 TODO

## TDD 步骤

### 测试文件位置

由于 `allowed_paths` 不包含测试文件，测试文件路径约定为：`backend/tests/modules/change/test_workflow_service.py`

### Step 1 — 写测试（先红后绿）

编写以下测试用例（全部应失败，因为方法尚不存在）：

```python
# === transition() ===

async def test_transition_draft_to_clarifying_by_business_user():
    """business_user 角色：draft → clarifying 成功"""

async def test_transition_draft_to_clarifying_by_agent():
    """agent 角色：draft → clarifying 成功"""

async def test_transition_draft_to_in_dev_forbidden():
    """draft → in_dev 不在 TRANSITIONS 表中 → 抛出 InvalidTransition"""

async def test_transition_business_review_to_accepted_by_reviewer():
    """reviewer 角色：business_review → accepted 成功"""

async def test_transition_business_review_to_accepted_by_agent_forbidden():
    """agent 角色：business_review → accepted 权限不足 → 抛出 PermissionDenied"""

async def test_transition_from_archived_forbidden():
    """archived 是终态，任何转换均非法 → 抛出 InvalidTransition"""

async def test_transition_same_stage_forbidden():
    """draft → draft 自环 → 抛出 InvalidTransition"""

async def test_transition_logs_to_stages_json():
    """流转后 stages["transitions"] 包含 from/to/by_role/at 记录"""

async def test_transition_updates_current_stage():
    """流转后 change.current_stage 等于 target_stage"""

# === submit_feedback() ===

async def test_submit_feedback_category_a():
    """类别 A → rework_required，rework_target=in_dev"""

async def test_submit_feedback_category_b():
    """类别 B → rework_required，rework_target=design_review"""

async def test_submit_feedback_category_c():
    """类别 C → rework_required，rework_target=clarifying"""

async def test_submit_feedback_category_d():
    """类别 D → 直接 accepted（不经过 rework_required）"""

async def test_submit_feedback_invalid_category():
    """category="X" → 抛出 ValueError"""

async def test_submit_feedback_from_wrong_stage():
    """从 in_dev 阶段提交反馈 → 抛出 InvalidTransition"""

async def test_submit_feedback_from_technical_verification():
    """从 technical_verification 阶段提交反馈 → 成功"""

async def test_submit_feedback_from_business_review():
    """从 business_review 阶段提交反馈 → 成功"""

async def test_submit_feedback_saves_fields():
    """提交后 change.feedback_category / feedback_text / reviewer_id 正确"""

async def test_submit_feedback_custom_target_stage():
    """target_stage 覆盖默认返工目标"""

# === check_archive_gate() ===

async def test_archive_gate_all_pass():
    """6 项检查全部通过 → can_archive=True"""

async def test_archive_gate_unresolved_feedback():
    """存在未解决反馈 → can_archive=False, checks[0].passed=False"""

async def test_archive_gate_ac_not_confirmed():
    """AC 未确认 → 对应检查项失败"""

async def test_archive_gate_tech_not_passed():
    """技术验证未通过 → 对应检查项失败"""

async def test_archive_gate_biz_not_passed():
    """业务评审未通过 → 对应检查项失败"""

async def test_archive_gate_uncategorized_feedback():
    """存在未分类反馈 → feedback_categorized 检查失败"""

async def test_archive_gate_incomplete_docs():
    """存在未完成文档 → documents_complete 检查失败"""

async def test_archive_gate_not_in_accepted_stage():
    """change 不在 accepted 阶段 → can_archive=False"""

async def test_archive_gate_returns_6_checks():
    """返回恰好 6 个 ArchiveCheckItem"""

async def test_archive_gate_empty_docs_passes():
    """无关联文档 → documents_complete 检查通过"""
```

### Step 2 — 确认失败

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest backend/tests/modules/change/test_workflow_service.py -v
# 预期：全部 FAILED / ERROR（方法尚不存在）
```

### Step 3 — 写代码

1. 在 `schema.py` 末尾追加 4 个 DTO
2. 在 `service.py` 的 `ChangeService` 类中追加 3 个方法
3. 确保新增 import 正确

### Step 4 — 确认通过

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest backend/tests/modules/change/test_workflow_service.py -v
# 预期：全部 PASSED
```

### Step 5 — 回归测试

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest backend/ -v
# 预期：无新增失败
```

### 测试辅助函数

```python
import uuid
from datetime import datetime, timezone
from app.modules.change.model import Change


def _make_change(
    *,
    current_stage: str = "draft",
    stages: dict | None = None,
    feedback_category: str | None = None,
    feedback_text: str | None = None,
    status: str = "active",
) -> Change:
    """创建非持久化的 Change 对象用于单元测试。"""
    return Change(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        change_key="test-change-001",
        title="测试变更",
        status=status,
        location="local",
        path=".sillyspec/changes/local/test-change-001",
        affected_components=[],
        current_stage=current_stage,
        stages=stages or {},
        feedback_category=feedback_category,
        feedback_text=feedback_text,
    )
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | `schema.py` 包含 `TransitionRequest` DTO | 字段：`target_stage: str`, `reason: str \| None` |
| AC-02 | `schema.py` 包含 `FeedbackRequest` DTO | 字段：`category: str`（正则 `^[A-D]$`）, `text: str`（1-2000）, `target_stage: str \| None` |
| AC-03 | `schema.py` 包含 `ArchiveCheckItem` DTO | 字段：`name: str`, `passed: bool`, `detail: str` |
| AC-04 | `schema.py` 包含 `ArchiveGateResponse` DTO | 字段：`can_archive: bool`, `checks: list[ArchiveCheckItem]` |
| AC-05 | `transition()` 合法流转成功 | `draft → clarifying`（business_user）返回更新后的 Change，`current_stage == "clarifying"` |
| AC-06 | `transition()` 非法流转拒绝 | `draft → in_dev` 不在 TRANSITIONS 表中，抛出 `InvalidTransition` |
| AC-07 | `transition()` 角色权限检查 | `business_review → accepted`，agent 角色抛出权限异常，reviewer 角色成功 |
| AC-08 | `transition()` 记录 stages JSON 日志 | `stages["transitions"]` 列表中追加 `{from, to, by_role, at}` 记录 |
| AC-09 | `transition()` archived 终态不可流转 | 从 `archived` 出发的任何流转均抛出 `InvalidTransition` |
| AC-10 | `submit_feedback()` 类别 A/B/C 流转至 rework_required | `feedback_category` 正确保存，`current_stage == "rework_required"` |
| AC-11 | `submit_feedback()` 类别 D 直接 accepted | 不经过 `rework_required`，`current_stage == "accepted"` |
| AC-12 | `submit_feedback()` 无效类别拒绝 | `category="X"` 抛出 `ValueError` |
| AC-13 | `submit_feedback()` 阶段校验 | 非 `technical_verification` / `business_review` 阶段提交反馈抛出异常 |
| AC-14 | `submit_feedback()` 保存反馈字段 | `change.feedback_category`, `feedback_text`, `reviewer_id` 正确赋值 |
| AC-15 | `check_archive_gate()` 全部通过 | 6 项检查均为 True 时 `can_archive=True` |
| AC-16 | `check_archive_gate()` 单项失败 | 任一检查项失败 → `can_archive=False`，对应 `ArchiveCheckItem.passed=False` 且 `detail` 非空 |
| AC-17 | `check_archive_gate()` 非 accepted 阶段 | `can_archive=False`，所有检查项 `passed=False` |
| AC-18 | `check_archive_gate()` 返回恰好 6 项 | `len(response.checks) == 6` |
| AC-19 | `check_archive_gate()` 空文档通过 | 无关联 ChangeDocument 时 `documents_complete` 检查通过 |
| AC-20 | 现有 `ChangeService` 方法不受影响 | `list_`, `get`, `get_by_key`, `update_progress`, `approve`, `reject` 等方法行为不变 |
| AC-21 | 全量回归无失败 | `pytest` 全套通过，无新增失败/错误 |
