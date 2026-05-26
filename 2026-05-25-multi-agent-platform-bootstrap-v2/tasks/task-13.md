---
id: task-13
title: 实现审批与状态机
phase: V3
priority: P1
status: draft
owner: qinyi
estimated_hours: 32
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/approval/
  - backend/app/modules/state_machine/
  - backend/app/modules/spec_guardian/
  - frontend/src/app/(dashboard)/approvals/
depends_on:
  - task-05
  - task-06
  - task-12
blocks:
  - task-14
  - task-16
---

## 1. 目标

落地 Change 与 Task 状态机、Spec Guardian 门禁、Review 封驳、审批节点、状态守恒。让 Change 生命周期从字符串字段升级为有合法转换保护的状态机。

## 2. 输入

- `requirements.md` FR-011
- `references/02-lifecycle-from-requirement-to-deployment.md`
- `references/05-permission-and-risk.md`
- `references/17-db-schema.md` §4
- `references/18-error-recovery.md` §5

## 3. 产出清单

### 3.1 Change 状态机

```text
draft → reviewing → approved → in_progress → verifying → done → archived
            ↘ rejected (回 draft)
in_progress → blocked → in_progress
任意 → cancelled
```

### 3.2 Task 状态机

```text
draft → ready → in_progress → review → done
                       ↘ blocked → in_progress
review → in_progress (改 changes_requested)
任意 → cancelled
```

合法转换矩阵硬编码在 `state_machine/transitions.py`，所有 transition 必须经 `StateMachine.transition()`，否则报 `InvalidTransition`。

### 3.3 Spec Guardian

编码前检查（Task 从 ready → in_progress 时触发）：

```python
RULES = {
  "feature": ["proposal", "requirements", "design", "plan"],
  "bugfix":  ["proposal", "requirements"],
  "hotfix":  ["proposal"],
  "docs":    ["proposal"],
  "refactor":["proposal", "design"],
}
```

- 缺必需文档 → 阻止 transition + 提示
- 文档存在但 status != approved → 阻止 transition

编码后检查（Task review → done 时触发）：

- 代码 diff 含 API 变更但未更新 design.md / API contract → 提示更新
- 代码 diff 含 DB 变更但未更新 migration → 阻止
- verification.md 未填或未通过 → 阻止

### 3.4 审批

```text
关键节点：
- Change: reviewing → approved（必须 1+ approver）
- Change: 准备 merge PR 前（task-12 联动）
- Task: review → done（必须 reviewer 通过）
- Deploy 生产（task-16）
```

数据表见 `references/17-db-schema.md` §4 `approvals` / `approval_decisions`。

### 3.5 后端模块

```text
backend/app/modules/state_machine/
├─ transitions.py
├─ runner.py
├─ schema.py
└─ tests/
   └─ test_transitions.py

backend/app/modules/approval/
├─ router.py
├─ service.py
├─ policy.py             # 决定哪些操作需要审批
├─ schema.py
├─ model.py
└─ tests/

backend/app/modules/spec_guardian/
├─ rules.py
├─ checker.py
├─ schema.py
└─ tests/
```

### 3.6 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/changes/{cid}/transition` | `change:update` | 触发 Change 状态转换 |
| POST | `/api/tasks/{tid}/transition` | `task:assign` | 触发 Task 状态转换 |
| GET | `/api/approvals` | 自己 / admin | 待审批列表 |
| POST | `/api/approvals/{aid}/decide` | 见 policy | 审批或拒绝 |
| GET | `/api/spec-guardian/check?task_id=...&phase=before_coding` | `task:read` | 主动触发检查 |

### 3.7 前端

`approvals/page.tsx`：

- 我的待审批列表
- 卡片显示：目标类型 / 目标标题 / 原因 / payload / 申请人 / 截止时间
- 操作：批准 / 拒绝 / 请求修改 + 评论

每个 Change / Task 详情页加入"状态机"组件：

- 当前状态徽章
- 可用 transition 按钮（按权限筛选）
- transition log 时间轴

### 3.8 状态守恒 daemon

`backend/app/core/daemons/state_reaper.py`：

- 见 `references/18-error-recovery.md` §5
- 每 5 分钟扫一次，弹回 stuck 状态

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 合法 transition draft→reviewing | 成功 |
| AC-02 | 非法 transition draft→done | 拒绝 `InvalidTransition` |
| AC-03 | Spec Guardian 缺 requirements 时阻止 ready→in_progress | 拒绝 + 提示 |
| AC-04 | requirements 未 approved 时同样阻止 | 拒绝 |
| AC-05 | Change reviewing → approved 缺审批 | 拒绝 |
| AC-06 | 审批通过后再 transition | 成功 |
| AC-07 | reviewer 请求修改后任务回 in_progress | 状态正确 |
| AC-08 | state_reaper 5 分钟弹回 stuck in_progress | 日志验证 |
| AC-09 | task_status_log 每次 transition 都有记录 | DB 行 |
| AC-10 | 单测覆盖率 | ≥ 90% |
| AC-11 | 红队：尝试越权 transition | 全部拒绝 |
| AC-12 | UI 状态机时间轴正确 | 截图 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 状态机配置散落 | 难维护 | 唯一来源 `transitions.py` |
| Spec Guardian 误报 | 阻塞流程 | 支持 `--override` 标记 + 写入审计 |
| 审批死锁 | 流程卡住 | approval 必须有 `expires_at`，过期自动 `expired` |
| 多人同时 transition | 状态竞争 | 行级锁 SELECT ... FOR UPDATE |

## 6. 完成定义

- [ ] 12 个 AC 通过
- [ ] 单测 + UI 截图
- [ ] `verification.md` 追加 task-13 记录
- [ ] PR 合并
