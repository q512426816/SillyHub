---
id: task-01
title: "Backend状态机核心 — model.py新增StageEnum + TRANSITIONS + can_transition()"
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-03, task-04]
allowed_paths:
  - backend/app/modules/change/model.py
---

# Task-01: Backend状态机核心

## 修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/app/modules/change/model.py` | 修改 | 新增 `StageEnum`、`TRANSITIONS`、`can_transition()`、`feedback_category` / `feedback_text` 字段 |

## 实现要求

### 1. 新增 `StageEnum` 枚举类

在文件顶部（import 之后、`Change` 类之前）新增：

```python
import enum

class StageEnum(str, enum.Enum):
    """Change 工作流 10 阶段枚举。"""
    draft = "draft"
    clarifying = "clarifying"
    design_review = "design_review"
    ready_for_dev = "ready_for_dev"
    in_dev = "in_dev"
    technical_verification = "technical_verification"
    business_review = "business_review"
    rework_required = "rework_required"
    accepted = "accepted"
    archived = "archived"
```

> 继承 `str` 使其可直接序列化为 JSON 字符串，与现有 `String` 列类型兼容。

### 2. 新增 `TRANSITIONS` 合法流转字典

```python
TRANSITIONS: dict[StageEnum, dict[StageEnum, list[str]]] = {
    StageEnum.draft: {
        StageEnum.clarifying: ["business_user", "agent"],
    },
    StageEnum.clarifying: {
        StageEnum.design_review: ["reviewer"],
    },
    StageEnum.design_review: {
        StageEnum.ready_for_dev: ["reviewer"],
        StageEnum.clarifying: ["reviewer"],          # 评审退回澄清
    },
    StageEnum.ready_for_dev: {
        StageEnum.in_dev: ["system"],
    },
    StageEnum.in_dev: {
        StageEnum.technical_verification: ["agent"],
    },
    StageEnum.technical_verification: {
        StageEnum.business_review: ["agent", "reviewer"],
        StageEnum.rework_required: ["reviewer"],
    },
    StageEnum.business_review: {
        StageEnum.accepted: ["reviewer"],
        StageEnum.rework_required: ["reviewer"],
    },
    StageEnum.rework_required: {
        StageEnum.clarifying: ["reviewer"],           # feedback_category == ambiguity
        StageEnum.design_review: ["reviewer"],        # feedback_category == requirement_error
        StageEnum.in_dev: ["reviewer"],               # feedback_category == bug
    },
    StageEnum.accepted: {
        StageEnum.archived: ["system"],
    },
    StageEnum.archived: {},                           # 终态，无出边
}
```

共 **14 条合法边**（不含 `archived` 的空字典）：
`draft→clarifying`, `clarifying→design_review`, `design_review→ready_for_dev`, `design_review→clarifying`, `ready_for_dev→in_dev`, `in_dev→technical_verification`, `technical_verification→business_review`, `technical_verification→rework_required`, `business_review→accepted`, `business_review→rework_required`, `rework_required→clarifying`, `rework_required→design_review`, `rework_required→in_dev`, `accepted→archived`。

### 3. 新增 `can_transition()` 函数

```python
def can_transition(current: StageEnum, target: StageEnum) -> bool:
    """检查从 current 到 target 的流转是否合法（仅检查边是否存在，不检查角色）。"""
    return target in TRANSITIONS.get(current, {})
```

### 4. 新增 `feedback_category` 字段

在 `Change` 类现有字段（`rejection_reason` 之后）新增：

```python
feedback_category: str | None = Field(
    default=None,
    sa_column=Column(String(30), nullable=True, default=None),
)
```

合法值为：`"bug"` | `"requirement_error"` | `"ambiguity"` | `"new_requirement"`。

| 值 | 含义 | 返工目标阶段 |
|----|------|-------------|
| `bug` | 实现缺陷 / 快速修复 | `in_dev` |
| `requirement_error` | 需求理解偏差 → 重设计 | `design_review` |
| `ambiguity` | 歧义 / 信息不足 | `clarifying` |
| `new_requirement` | 衍生新需求，当前标记通过 | `accepted`（不走 rework） |

### 5. 新增 `feedback_text` 字段

```python
feedback_text: str | None = Field(
    default=None,
    sa_column=Column(Text, nullable=True, default=None),
)
```

### 6. 保留现有字段

**所有已有字段保持不变**，包括：
- `id`, `workspace_id`, `change_key`, `title`, `status`, `location`, `path`
- `affected_components`, `change_type`, `owner_id`
- `created_at`, `updated_at`, `archived_at`
- `current_stage`, `stages`
- `approval_status`, `approved_by`, `approved_at`, `rejection_reason`

> `status` 字段暂不删除，由 task-02（DB迁移）处理旧→新映射；`current_stage` 字段保留供过渡期使用。

## 接口定义

### 模块级公开 API

| 符号 | 类型 | 签名 | 说明 |
|------|------|------|------|
| `StageEnum` | enum.Enum | 10 个字符串枚举值 | 阶段标识，可直接比较 / 序列化 |
| `TRANSITIONS` | dict | `dict[StageEnum, dict[StageEnum, list[str]]]` | 全量合法流转映射（含角色权限） |
| `can_transition` | function | `(current: StageEnum, target: StageEnum) -> bool` | 检查边是否存在 |
| `Change.feedback_category` | Column | `String(30), nullable` | 反馈分类 |
| `Change.feedback_text` | Column | `Text, nullable` | 反馈文本 |

## 边界处理

1. **`can_transition` 对非法枚举值**：若传入的 `current` 不在 `TRANSITIONS` 字典中（如直接传入字符串而非 `StageEnum`），`get()` 返回空 dict，函数返回 `False`，不会抛异常。
2. **`archived` 终态不可流出**：`TRANSITIONS[StageEnum.archived]` 为空 dict，任何 `can_transition(StageEnum.archived, ...)` 均返回 `False`。
3. **`rework_required` 的多目标路由**：该阶段有 3 条出边（`clarifying`、`design_review`、`in_dev`），具体走哪条由 `feedback_category` 在 service 层决定（task-03），model 层仅定义合法性。
4. **`feedback_category` 合法值约束**：model 层不做 CheckConstraint（由 service 层校验），但列长度限制为 `String(30)` 足以容纳最长值 `requirement_error`（18字符）。
5. **`feedback_text` 无长度限制**：使用 `Text` 类型，允许长文本反馈；空字符串与 `NULL` 均视为"无反馈"。
6. **现有 `status` 字段共存**：`status` 字段保留不动，`StageEnum` 与 `status` 暂无直接绑定关系，后续 task-02 迁移脚本处理映射。
7. **`ChangeDocument` 类不受影响**：本次变更仅修改 `Change` 类及模块级符号，`ChangeDocument` 类完全不变。

## 非目标

- ❌ 不实现 `transition()` 服务方法（属于 task-03）
- ❌ 不实现角色权限检查逻辑（属于 task-03）
- ❌ 不新增 `reviewer_id` 字段（属于 task-02 迁移脚本范畴，因需外键约束）
- ❌ 不修改 `status` 字段或做旧→新映射（属于 task-02）
- ❌ 不新增 API 路由（属于 task-04）
- ❌ 不新增 Pydantic schema / DTO（属于 task-03）
- ❌ 不添加 CheckConstraint 或数据库级约束（属于 task-02）

## TDD 步骤

### Red → Green 循环

| # | 测试用例 | 类型 | 预期结果 |
|---|---------|------|---------|
| 1 | `test_stage_enum_values` — 验证 `StageEnum` 有且仅有 10 个值，且值与字符串完全匹配 | 单元测试 | `len(StageEnum) == 10`，每个 `.value` 等于其名字字符串 |
| 2 | `test_stage_enum_is_str` — 验证 `StageEnum("draft")` 可正常构造且 `isinstance(..., str)` | 单元测试 | 不抛异常，返回 `True` |
| 3 | `test_transitions_has_14_edges` — 遍历 `TRANSITIONS` 所有 key/value，计算总边数为 14 | 单元测试 | `sum(len(v) for v in TRANSITIONS.values()) == 14` |
| 4 | `test_transitions_all_keys_are_stage_enum` — 验证外层 key 和内层 key 类型均为 `StageEnum` | 单元测试 | 全部 `isinstance(..., StageEnum)` |
| 5 | `test_transitions_all_roles_are_lists` — 验证每条边的角色值为 `list` 且非空 | 单元测试 | 全部 `isinstance(v, list) and len(v) > 0` |
| 6 | `test_can_transition_valid` — 验证所有 14 条合法边返回 `True` | 单元测试 | `can_transition(StageEnum.draft, StageEnum.clarifying) is True` 等 |
| 7 | `test_can_transition_invalid` — 验证不合法的流转返回 `False`（如 `draft → accepted`、`archived → draft`） | 单元测试 | `can_transition(StageEnum.draft, StageEnum.accepted) is False` |
| 8 | `test_can_transition_archived_is_sink` — 验证 `archived` 到任何阶段均返回 `False` | 单元测试 | 对所有 `StageEnum` 值，`can_transition(archived, x) is False` |
| 9 | `test_can_transition_reflexive_false` — 验证所有阶段自环（`draft→draft`）返回 `False` | 单元测试 | 对所有 `StageEnum` 值，`can_transition(x, x) is False` |
| 10 | `test_change_model_feedback_fields_default_null` — 创建 `Change` 实例，验证 `feedback_category` 和 `feedback_text` 默认为 `None` | 单元测试 | 两者均为 `None` |
| 11 | `test_change_model_feedback_category_accepts_valid` — 设置 `feedback_category = "bug"`，验证可赋值 | 单元测试 | `.feedback_category == "bug"` |
| 12 | `test_change_model_existing_fields_intact` — 验证所有原有字段（`status`, `current_stage`, `stages` 等）仍可正常读写 | 单元测试 | 字段存在且类型正确 |

### 执行顺序

```
1. 先写 test_stage_enum_values + test_stage_enum_is_str → 实现 StageEnum → Green
2. 再写 test_transitions_* → 实现 TRANSITIONS → Green
3. 再写 test_can_transition_* → 实现 can_transition() → Green
4. 最后写 test_change_model_* → 新增 feedback 字段 → Green
5. 全量跑通确认无回归
```

## 验收标准

| # | 标准 | 验证方法 |
|---|------|---------|
| AC-1 | `StageEnum` 包含 10 个枚举值，每个值类型为 `str` | `len(StageEnum) == 10`，`all(isinstance(e.value, str) for e in StageEnum)` |
| AC-2 | `TRANSITIONS` 包含 14 条合法流转边，覆盖所有 10 个阶段（作为 key 出现） | 边计数 == 14，`set(TRANSITIONS.keys()) == set(StageEnum)` |
| AC-3 | `can_transition(current, target)` 对 14 条合法边返回 `True`，其余组合返回 `False` | 遍历全部 10×10 组合，合法 14 条 `True`，其余 86 条 `False` |
| AC-4 | `archived` 为终态：无任何出边 | `can_transition(StageEnum.archived, any) == False` |
| AC-5 | `Change` ORM 模型新增 `feedback_category`（`String(30), nullable`）和 `feedback_text`（`Text, nullable`）字段，默认均为 `None` | 实例化 `Change()`，断言两字段为 `None` |
| AC-6 | 所有现有 `Change` 字段不受影响，无破坏性变更 | 现有后端测试全量通过 |
| AC-7 | 无新 import 引入非标准库或第三方非已有依赖 | 仅使用 `enum`（标准库）+ 已有 sqlalchemy/sqlmodel |
| AC-8 | 文件可被 Python 正常导入，无语法错误 | `python -c "from app.modules.change.model import StageEnum, TRANSITIONS, can_transition, Change"` 成功 |
