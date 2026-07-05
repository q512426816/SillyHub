---
author: WhaleFall
created_at: 2026-06-04 10:50:53
task: task-01
title: 统一 StageEnum + 新增 HumanGate + TRANSITIONS 更新
wave: W1
priority: P0
estimate: 2h
depends_on: []
---

# task-01: 统一 StageEnum + 新增 HumanGate + TRANSITIONS 更新

## 目标

将 `StageEnum` 精简为 SillySpec 技能阶段 + 业务辅助阶段（draft/blocked），移除混合状态 `rework_required`/`accepted`；新增 `HumanGate` 枚举表达人工等待语义；重写 `TRANSITIONS` 邻接表适配新阶段拓扑。完成后 `model.py` 成为后续 task-02~04 的类型基础。

## 不在范围

- 不修改 Change 模型字段（human_gate 列由 task-03 迁移添加）
- 不修改 schema.py / router.py / service.py（后续 task 负责）
- 不写数据库迁移脚本（task-03）
- 不修改前端代码

## 输入

- `backend/app/modules/change/model.py` — StageEnum、TRANSITIONS、can_transition() 现有实现
- `.sillyspec/changes/agent-driven-change-center/design.md` — 目标 StageEnum / HumanGate / 状态组合矩阵

## 产出

- `backend/app/modules/change/model.py` — 修改 StageEnum、新增 HumanGate、重写 TRANSITIONS

## 实现步骤

### 步骤 1：修改 StageEnum

在 `model.py` 的 `StageEnum` 类中：

1. **删除** `REWORK_REQUIRED = "rework_required"` 和 `ACCEPTED = "accepted"` 两个成员
2. **新增** `BLOCKED = "blocked"` 成员，放在 Hub 业务扩展阶段分组中
3. **新增** `ARCHIVED = "archived"` 终态成员（design.md 中 archived 作为独立阶段）
4. 修改后 StageEnum 完整成员：

```python
class StageEnum(enum.StrEnum):
    """统一工作流阶段枚举：SillySpec 8 主阶段 + Hub 3 业务扩展。"""

    # ── SillySpec 主阶段（由 CLI 管理） ──
    SCAN = "scan"
    BRAINSTORM = "brainstorm"
    PROPOSE = "propose"
    PLAN = "plan"
    EXECUTE = "execute"
    VERIFY = "verify"
    ARCHIVE = "archive"
    QUICK = "quick"

    # ── Hub 业务扩展阶段 ──
    DRAFT = "draft"
    BLOCKED = "blocked"
    ARCHIVED = "archived"
```

5. **修改** `hub_stages()` 返回 `[cls.DRAFT, cls.BLOCKED, cls.ARCHIVED]`
6. `spec_stages()` 和 `all_stages()` 无需改动（`all_stages` 自动拼接）

### 步骤 2：新增 HumanGate 枚举

在 `StageEnum` 类之后、`TRANSITIONS` 之前插入新枚举：

```python
class HumanGate(enum.StrEnum):
    """人工等待门控枚举 — 表达「人在等什么」。"""

    NONE = "none"
    NEED_REQUIREMENT_INPUT = "need_requirement_input"
    NEED_PROPOSAL_REVIEW = "need_proposal_review"
    NEED_PLAN_REVIEW = "need_plan_review"
    NEED_HUMAN_TEST = "need_human_test"
    NEED_ARCHIVE_CONFIRM = "need_archive_confirm"
    BLOCKED = "blocked"  # 自动修复超限等，需人工介入
```

### 步骤 3：重写 TRANSITIONS 邻接表

将现有 `TRANSITIONS` 字典整体替换。设计依据 design.md 状态组合矩阵：

```python
TRANSITIONS: dict[StageEnum, dict[StageEnum, list[str]]] = {
    # ── draft → SillySpec 入口（Agent 接管） ──
    StageEnum.DRAFT: {
        StageEnum.BRAINSTORM: ["agent"],
        StageEnum.SCAN: ["agent"],
    },
    # ── SillySpec 主线流程 ──
    StageEnum.SCAN: {
        StageEnum.BRAINSTORM: ["agent"],
    },
    StageEnum.BRAINSTORM: {
        StageEnum.PROPOSE: ["agent"],
    },
    StageEnum.PROPOSE: {
        StageEnum.PLAN: ["reviewer", "agent"],
        StageEnum.BRAINSTORM: ["reviewer"],
    },
    StageEnum.PLAN: {
        StageEnum.EXECUTE: ["reviewer", "agent"],
        StageEnum.PROPOSE: ["reviewer"],
        StageEnum.BRAINSTORM: ["reviewer"],
    },
    StageEnum.EXECUTE: {
        StageEnum.VERIFY: ["agent"],
    },
    StageEnum.VERIFY: {
        StageEnum.QUICK: ["agent"],
        StageEnum.ARCHIVE: ["reviewer", "agent"],
        StageEnum.BLOCKED: ["agent"],
    },
    StageEnum.QUICK: {
        StageEnum.VERIFY: ["agent"],
        StageEnum.BLOCKED: ["agent"],
    },
    StageEnum.BLOCKED: {
        StageEnum.PROPOSE: ["reviewer"],
        StageEnum.PLAN: ["reviewer"],
        StageEnum.EXECUTE: ["reviewer"],
    },
    StageEnum.ARCHIVE: {
        StageEnum.ARCHIVED: ["system"],
    },
    StageEnum.ARCHIVED: {},
}
```

关键变化说明：
- `DRAFT` 现在只能由 agent 推进到 `BRAINSTORM` 或 `SCAN`（移除 business_user 直接到 PROPOSE/QUICK）
- `VERIFY` 不再转 `ACCEPTED`，改为转 `QUICK`（自动修复）、`ARCHIVE`（通过后直接归档门控）、`BLOCKED`（超限）
- `QUICK` 不再转 `ACCEPTED`，改为转 `VERIFY`（修复后重验证）、`BLOCKED`（超限）
- 移除 `REWORK_REQUIRED` 和 `ACCEPTED` 的整个 key
- 新增 `BLOCKED` 的出口：reviewer 可决定回退到 PROPOSE/PLAN/EXECUTE
- 新增 `ARCHIVED` 终态（空邻接）

### 步骤 4：确认 can_transition() 无需修改

`can_transition()` 函数逻辑不变（只查 TRANSITIONS 字典），确认签名和返回值兼容即可，无需改动。

## 验收标准

- [ ] `StageEnum` 不再包含 `REWORK_REQUIRED` 和 `ACCEPTED`
- [ ] `StageEnum` 新增 `BLOCKED` 和 `ARCHIVED`
- [ ] `hub_stages()` 返回 `[DRAFT, BLOCKED, ARCHIVED]`
- [ ] `HumanGate` 枚举包含 7 个值：none, need_requirement_input, need_proposal_review, need_plan_review, need_human_test, need_archive_confirm, blocked
- [ ] `TRANSITIONS` 字典不再包含 `REWORK_REQUIRED` 和 `ACCEPTED` 的 key
- [ ] `TRANSITIONS` 新增 `BLOCKED` 和 `ARCHIVED` 的 key
- [ ] `VERIFY` 的出口为 `{QUICK, ARCHIVE, BLOCKED}`
- [ ] `QUICK` 的出口为 `{VERIFY, BLOCKED}`
- [ ] `can_transition()` 函数签名和逻辑未变，仅因 TRANSITIONS 数据变化而行为变化
- [ ] `python -c "from app.modules.change.model import StageEnum, HumanGate, TRANSITIONS"` 可正常导入无报错
- [ ] 全局搜索无残留的 `rework_required` / `accepted` 引用（在 model.py 内）

## 风险

| 风险 | 等级 | 对策 |
|---|---|---|
| 其他文件引用 StageEnum.REWORK_REQUIRED / .ACCEPTED 会在运行时报错 | 高 | task-01 只改 model.py，后续 task-16 统一清理引用；本次在 model.py 内不残留即可 |
| TRANSITIONS 边遗漏导致某些流程断路 | 中 | 对照 design.md 状态组合矩阵逐条验证，验收标准中列出关键出口 |
| ARCHIVED vs ARCHIVE 命名混淆 | 低 | ARCHIVE 是动作阶段（归档进行中），ARCHIVED 是终态（已归档），注释中明确标注 |

## DoD

- [ ] 代码修改完成
- [ ] 相关测试通过
- [ ] 无 lint/type 错误
