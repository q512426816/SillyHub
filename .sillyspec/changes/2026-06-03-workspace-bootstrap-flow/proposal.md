---
author: WhaleFall
created_at: 2026-06-03 15:17:41
---

# Proposal

## 动机

「添加 Workspace」弹窗里点击「生成项目规范」时，当前流程是：弹窗内调用 `scan-generate` → 弹窗内订阅 SSE 看日志 → done 后弹窗内 `createWorkspace`。这条路径把日志回显锁死在弹窗内，与「点击项目详情进入之后实时查询进度并回显 agent 日志」的目标不一致，且 Bootstrap（scan agent）一旦启动，关闭弹窗或刷新页面就再也看不到进度。

本变更把「生成项目规范」统一为 **Bootstrap 流程**：弹窗只负责扫描 + 新建 workspace，随即跳转到 Workspace 详情页；详情页承载 Bootstrap 的触发、实时 SSE 回显，并在进入页面时自动检测「是否还在 Bootstrap」并恢复回显。Bootstrap 完成后，自动解析子组件配置创建对应子 workspace。整个过程防止重复触发。

## 关键问题

1. **日志回显被锁在弹窗内**：现状 SSE 订阅在 `workspace-scan-dialog.tsx` 内，用户一旦关闭弹窗或刷新，正在执行的 scan agent 日志就丢失，无法重新观察进度。需求明确要求「进入项目详情后实时查询进度并回显」。
2. **进入详情页无法恢复进行中的 Bootstrap**：详情页 `load()` 只拉取静态信息，不查询该 workspace 是否有进行中的 scan/bootstrap run，因此重进页面看不到正在跑的 agent，按钮也不会因「正在运行」而禁用。
3. **子组件不会自动创建**：scan agent 完成后只更新 run 状态，不触发 `reparse`。用户必须手动再点一次才能把 `projects/*.yaml` 里声明的子组件建出来，违背「生成项目规范结束之后如有子组件则创建对应子组件」的预期。
4. **防重复点击只在前端**：现状仅靠前端 `disabled`，多标签页 / 并发请求下仍可能对同一 workspace 重复发起 scan run。

## 变更范围

- 后端 `WorkspaceService.scan_generate`：触发 scan 前查询该 workspace 是否已有进行中（pending/running）的 scan run（`change_id is None`），有则幂等返回该 run，不新建。
- 后端 `AgentService._execute_scan_run`：成功收尾（exit_code==0）后自动调用 reparse 逻辑，解析 `spec_root/projects/*.yaml` 创建子 workspace + relations；reparse 失败仅记 warning，不连带 run 标记 failed。
- 前端 `workspace-scan-dialog.tsx`：移除弹窗内 SSE / `generating` 阶段，「生成项目规范」按钮改为 `scanGenerate` 后 `router.push('/workspaces/{id}')` 并关闭弹窗。
- 前端 `workspaces/[id]/page.tsx`：`load()` 时查询最近的 scan/bootstrap run，若 status 为 pending/running 则自动连接 SSE 恢复回显并禁用 Bootstrap 按钮；SSE done 后 `load()` 刷新子组件计数。

## 不在范围内（显式清单）

- 不改动 `spec-bootstrap` 接口本身的 Agent 执行管线（复用 2026-06-02-spec-bootstrap-agent-stream-interaction 已交付的能力）。
- 不新增「进程级暂停 / 恢复」协议，用户输入仍走现有 AgentRunLog / pending_input 机制。
- 不重构 reparse 的解析逻辑，只是在收尾处调用它。
- 不改变 `createWorkspace`「直接创建」（已检测到 .sillyspec 时）的行为。
- 不引入新的数据库表或字段。

## 成功标准（可验证）

- 点击「生成项目规范」后立即跳转到 `/workspaces/{id}` 详情页，弹窗关闭，不再在弹窗内显示日志。
- 进入详情页时若该 workspace 有 pending/running 的 scan run，页面自动连接 SSE 并实时回显 agent 日志，Bootstrap 按钮处于禁用态。
- Bootstrap 执行期间，无论从详情页还是弹窗，都无法对同一 workspace 重复发起 scan run（前端禁用 + 后端幂等返回进行中 run）。
- scan agent 成功完成后，`spec_root/projects/*.yaml` 中声明的子组件被自动创建为子 workspace，详情页「项目组组件」计数刷新后增加。
- 刷新详情页或重新进入，正在运行的 Bootstrap 回显能继续恢复。
