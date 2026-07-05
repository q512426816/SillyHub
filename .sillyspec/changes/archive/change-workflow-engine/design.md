---
author: hermes
created_at: "2026-05-31T15:30:00"
status: draft
title: "Change Workflow Engine 重设计"
---

# Change Workflow Engine — 设计文档

## 1. 架构概述：10 阶段状态机

当前 change 仅有 `draft / active / archived` 三态，无法支撑多角色协作与自动化流程。本次重设计引入 **10 阶段线性状态机**，每个阶段对应明确的角色与动作边界。

```
draft → clarifying → design_review → ready_for_dev
  → in_dev → technical_verification → business_review
  → accepted → archived

（rework_required 可从 technical_verification / business_review 回退）
```

### 状态流转图

| # | 阶段 | 说明 | 允许操作的角色 |
|---|------|------|----------------|
| 1 | `draft` | 新建草稿，尚未提交 | business_user, agent |
| 2 | `clarifying` | 需求澄清中，补充上下文 | business_user, reviewer |
| 3 | `design_review` | 设计方案评审 | reviewer |
| 4 | `ready_for_dev` | 评审通过，等待开发 | system |
| 5 | `in_dev` | 开发执行中 | agent |
| 6 | `technical_verification` | 技术验证 / 自测 | agent, reviewer |
| 7 | `business_review` | 业务验收 | business_user, reviewer |
| 8 | `rework_required` | 需返工（回退态） | reviewer |
| 9 | `accepted` | 验收通过 | reviewer |
| 10 | `archived` | 已归档，流程终态 | system |

> `rework_required` 是一个回退汇聚节点，可从 `technical_verification` 或 `business_review` 进入，返回目标由 `feedback_category` 决定（见 §4）。

---

## 2. 文件变更清单

### 2.1 后端（6 文件）

| 文件 | 变更说明 |
|------|----------|
| `backend/app/modules/change/model.py` | 新增 `StageEnum`（10 值）、`TRANSITIONS` 合法流转字典、`feedback_category` / `feedback_text` / `reviewer_id` 字段 |
| `backend/app/modules/change/schema.py` | 新增 DTO：`TransitionRequest(stage, reason)`、`FeedbackRequest(category, text, target_stage?)`、`ArchiveGateResponse(can_archive, failed_checks[])` |
| `backend/app/modules/change/service.py` | 核心方法：`transition()`、`submit_feedback()`、`check_archive_gate()` |
| `backend/app/modules/change/router.py` | 3 个新端点：`POST /{id}/transition`、`POST /{id}/feedback`、`GET /{id}/archive-gate` |
| `backend/app/modules/change_writer/service.py` | `create_change` 默认 `draft`；创建后自动流转至 `clarifying` |
| `backend/app/modules/change_writer/router.py` | `execute_change` 增加前置守卫：当前 stage 必须为 `ready_for_dev`，否则 409 |

### 2.2 前端（4 文件）

| 文件 | 变更说明 |
|------|----------|
| `frontend/src/lib/changes.ts` | 新增 `transitionChange()`、`submitFeedback()`、`checkArchiveGate()` API 函数 |
| `frontend/src/app/workspaces/[id]/changes/[cid]/page.tsx` | 工作流 UI：阶段进度条、流转按钮、反馈表单、归档检查面板 |
| `frontend/src/app/workspaces/[id]/changes/page.tsx` | 列表页：每条 change 显示阶段 badge（颜色编码） |
| `frontend/src/components/StageBadge.tsx` | **新增**组件：统一阶段标签渲染（颜色 + 图标） |

### 2.3 数据库迁移（1 文件）

| 文件 | 变更说明 |
|------|----------|
| `alembic/versions/xxxx_add_change_workflow_fields.py` | 添加 `feedback_category`、`feedback_text`、`reviewer_id` 列；将旧 `status` 值映射为新 `stage` 值 |

---

## 3. 流转规则与角色权限

### 3.1 合法流转表（TRANSITIONS）

```python
TRANSITIONS: dict[StageEnum, dict[StageEnum, list[str]]] = {
    StageEnum.draft:                 {StageEnum.clarifying: ["business_user", "agent"]},
    StageEnum.clarifying:            {StageEnum.design_review: ["reviewer"]},
    StageEnum.design_review:         {
        StageEnum.ready_for_dev: ["reviewer"],
        StageEnum.clarifying:    ["reviewer"],   # 评审退回澄清
    },
    StageEnum.ready_for_dev:         {StageEnum.in_dev: ["system"]},
    StageEnum.in_dev:                {StageEnum.technical_verification: ["agent"]},
    StageEnum.technical_verification: {
        StageEnum.business_review:   ["agent", "reviewer"],
        StageEnum.rework_required:   ["reviewer"],
    },
    StageEnum.business_review:       {
        StageEnum.accepted:          ["reviewer"],
        StageEnum.rework_required:   ["reviewer"],
    },
    StageEnum.rework_required:       {
        # 根据 feedback_category 决定目标，见 §4
        StageEnum.clarifying:        ["reviewer"],
        StageEnum.design_review:     ["reviewer"],
        StageEnum.in_dev:            ["reviewer"],
    },
    StageEnum.accepted:              {StageEnum.archived: ["system"]},
    StageEnum.archived:              {},  # 终态
}
```

### 3.2 权限检查逻辑

```python
def transition(change_id: UUID, target: StageEnum, actor_role: str) -> Change:
    current = get_change(change_id)
    allowed_roles = TRANSITIONS[current.stage].get(target)
    if allowed_roles is None:
        raise InvalidTransition(f"{current.stage} → {target} 不合法")
    if actor_role not in allowed_roles:
        raise PermissionDenied(f"角色 {actor_role} 无权执行 {current.stage} → {target}")
    current.stage = target
    return save(current)
```

---

## 4. 反馈分类体系

当 `rework_required` 被触发时，必须附带 `feedback_category`，决定返工流向：

| 类别 | 含义 | 返工目标 | 典型场景 |
|------|------|----------|----------|
| **A** | Bug / 快速修复 | `in_dev` | 实现与设计不符、代码缺陷 |
| **B** | 需求理解错误 → 重设计 | `design_review` | agent 对需求理解偏差，需重新评审方案 |
| **C** | 歧义 / 信息不足 | `clarifying` | 需求描述模糊，需业务方补充上下文 |
| **D** | 衍生新 change | `accepted`（当前标记通过） | 发现新需求，另开 change 处理 |

### 数据模型

```python
class Change(Base):
    ...
    feedback_category: Mapped[Optional[str]]  # "A" | "B" | "C" | "D"
    feedback_text: Mapped[Optional[str]]
    reviewer_id: Mapped[Optional[UUID]]
```

---

## 5. 归档门禁（Archive Gate）

从 `accepted` → `archived` 需通过 **6 项检查**，全部通过才允许归档：

| # | 检查项 | 条件 |
|---|--------|------|
| 1 | **关联 PR 已合并** | 所有 linked PR 状态为 `merged` |
| 2 | **无未解决反馈** | `feedback_category` 为 null 或已关闭 |
| 3 | **测试通过** | CI pipeline 最后一次运行结果为 `success` |
| 4 | **文档已更新** | 对应 doc marker 已标记 `completed` |
| 5 | **无子 change 未关闭** | 子 change 全部为 `accepted` 或 `archived` |
| 6 | **业务方确认** | business_user 已在 business_review 阶段点击确认 |

### API 响应

```json
{
  "can_archive": false,
  "failed_checks": [
    {"check": "prs_merged", "message": "PR #42 仍为 open 状态"},
    {"check": "tests_pass", "message": "CI 上次运行失败"}
  ]
}
```

---

## 6. Agent 边界

Agent（自动化执行者）在整个流程中 **仅活跃于以下区间**：

```
ready_for_dev ──→ in_dev ──→ technical_verification
```

| 规则 | 说明 |
|------|------|
| **入口守卫** | `execute_change` 仅当 `stage == ready_for_dev` 时可调用，否则返回 `409 Conflict` |
| **出口** | agent 完成 `technical_verification` 后将 stage 推至 `business_review`，交由人类评审 |
| **禁止越权** | agent 不可执行 `business_review` → `accepted`，不可直接归档 |
| **被动创建** | `create_change` 可由 agent 发起，但 stage 仅从 `draft` 开始 |

---

## 7. 兼容性策略

### 7.1 旧状态映射

| 旧 `status` 值 | 新 `stage` 值 |
|-----------------|---------------|
| `draft` | `draft` |
| `active` | `in_dev`（活跃中的统一映射） |
| `archived` | `archived` |

### 7.2 迁移脚本逻辑

```python
def upgrade():
    # 1. 新增列
    op.add_column("changes", sa.Column("feedback_category", sa.String(1), nullable=True))
    op.add_column("changes", sa.Text("feedback_text"), nullable=True)
    op.add_column("changes", sa.Column("reviewer_id", sa.UUID, nullable=True))

    # 2. 重命名 status → stage（或保持兼容读取层）
    # 映射旧值
    op.execute("""
        UPDATE changes SET stage = CASE
            WHEN status = 'draft'    THEN 'draft'
            WHEN status = 'active'   THEN 'in_dev'
            WHEN status = 'archived' THEN 'archived'
        END
    """)

    # 3. 后续版本移除旧 status 列
```

### 7.3 API 兼容

- 旧端点 `/changes?status=active` → 内部映射为 `stage=in_dev`
- 响应中同时返回 `status`（deprecated）与 `stage`（新字段），过渡期 2 个版本后移除 `status`

---

## 8. 风险登记

| # | 风险 | 影响 | 可能性 | 缓解措施 |
|---|------|------|--------|----------|
| R1 | 旧客户端使用 `status` 字段，升级后报错 | 高 | 中 | API 双写过渡期，v2.4 标记 deprecated，v2.6 移除 |
| R2 | 状态机死锁（流转规则覆盖不全） | 高 | 低 | 单元测试覆盖所有 10×10 转换组合，CI 强制通过 |
| R3 | `rework_required` 循环返工，change 永不收敛 | 中 | 中 | 设置最大返工次数（默认 5），超限自动通知管理员 |
| R4 | 归档门禁检查依赖外部系统（CI、PR）不可用 | 中 | 中 | 门禁检查设置超时（5s），超时项标记 `unknown` 而非 `failed` |
| R5 | Agent 在 `in_dev` 阶段长时间无响应 | 中 | 中 | 设置 stage 超时（24h），超时后 system 自动标记需人工介入 |
| R6 | 并发流转冲突（多人同时操作） | 低 | 低 | 数据库行锁 + `version` 字段乐观并发控制 |

---

## 附录：核心代码结构预览

```
backend/app/modules/change/
├── model.py          # StageEnum, TRANSITIONS, Change ORM
├── schema.py         # TransitionRequest, FeedbackRequest, ArchiveGateResponse
├── service.py        # transition(), submit_feedback(), check_archive_gate()
└── router.py         # 3 new endpoints

backend/app/modules/change_writer/
├── service.py        # create_change → draft → clarifying
└── router.py         # execute_change guard (ready_for_dev)

frontend/src/
├── lib/changes.ts                         # API helpers
├── components/StageBadge.tsx               # 阶段标签组件
└── app/workspaces/[id]/changes/
    ├── page.tsx                            # 列表（stage badges）
    └── [cid]/page.tsx                      # 详情（workflow UI）
```
