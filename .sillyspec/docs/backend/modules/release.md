---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# release

> 最后更新：2026-05-31
> 最近变更：`bead9ea` fix: QA round 1 — 6 issues from test report
> 模块路径：`app/modules/release/**`

## 职责

发布管理模块，管理从变更到部署的完整发布生命周期。支持创建发布、审批投票、环境晋升（staging / production）、部署执行和回滚。内置部署窗口检查（默认周一至周五 10:00-18:00 UTC）和多审批人门控（默认至少 2 人批准）。

## 当前设计（架构 + 关键逻辑）

**生命周期状态机**：`draft → staging → approved → deploying → deployed → rolled_back`

核心流程：
1. **创建**：指定版本号、目标环境（staging / production）、关联变更 ID、部署策略
2. **晋升 staging**：`promote_to_staging()` 仅允许从 draft 状态晋升
3. **审批**：`approve()` 每人仅可投票一次，创建者不可自审；approve 达到门槛后自动转 approved
4. **部署**：staging 环境自动部署；production 环境要求审批数达标 + 在部署窗口内
5. **回滚**：仅 deployed 状态可回滚，记录回滚时间

**部署策略（deploy_policy）**：
- `deploy_window`：`{days: [0-6], start_hour, end_hour}`，默认 Mon-Fri 10-18 UTC
- `min_approvers`：最少审批人数，默认 2

## 对外接口

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| POST | `/workspaces/{ws_id}/releases` | 创建发布 | DEPLOY_STAGING |
| GET | `/workspaces/{ws_id}/releases` | 列出发布（支持 ?status= 过滤） | 登录用户 |
| POST | `/releases/{rel_id}/approve` | 提交审批投票 | DEPLOY_PRODUCTION |
| GET | `/releases/{rel_id}/approvals` | 列出审批记录 | 登录用户 |
| POST | `/releases/{rel_id}/deploy` | 执行部署 | DEPLOY_PRODUCTION |
| POST | `/releases/{rel_id}/promote` | 晋升至 staging | DEPLOY_STAGING |
| POST | `/releases/{rel_id}/rollback` | 回滚已部署版本 | DEPLOY_ROLLBACK |

## 关键数据流

```
创建发布 → draft
  ↓ POST /promote → staging
  ↓ POST /approve（×N，达到 min_approvers） → approved
  ↓ POST /deploy（staging: 自动；production: 检查窗口+审批数） → deployed
  ↓ POST /rollback → rolled_back

审批流程：
  POST /releases/{id}/approve {verdict: "approve"/"reject", comment: "..."}
    → 检查：verdict 合法 + 非自审 + 未重复投票
    → approve 时调用 _check_approval_threshold()
      → count("approve") >= min_approvers → status = "approved"
    → reject 不影响状态（需手动重新 propose）
```

## 设计决策

| 决策 | 原因 |
|------|------|
| 审批门槛自动触发状态变更 | 避免额外 API 调用，减少竞态窗口 |
| 创建者不可自审 | 防止单人绕过审批流程 |
| staging 自动部署无审批 | 快速迭代环境，降低流程摩擦 |
| deploy_policy 存储在 Release 行内 | 不同发布可有不同策略，灵活性高 |
| 部署窗口默认工作日 10-18 UTC | 遵循行业惯例，降低人为失误风险 |
| `ux_release_approvals_release_user` 唯一索引 | 数据库层保证每人仅一票 |

## 依赖关系

- **上游**：workspace（workspace_id 外键）、auth（User，creator_id / approver_id）
- **模型**：Release（releases 表）、ReleaseApproval（release_approvals 表）
- **下游**：change（change_ids 关联的变更列表）

## 注意事项

- 当前 `deploy()` 仅设置状态和文本输出，未对接真实部署管线（`deploy_output` 为硬编码字符串）
- `change_ids` 以 JSON 数组存储，未建立外键约束，删除变更可能导致孤立引用
- 部署窗口检查使用 UTC 时区，需注意与本地时区的换算
- `deploying` 状态在 VALID_STATUSES 中定义但当前代码未使用（直接跳到 deployed）

## 变更索引

| 日期 | 变更 |
|------|------|
| 2026-05-31 | 初始归档文档 |
