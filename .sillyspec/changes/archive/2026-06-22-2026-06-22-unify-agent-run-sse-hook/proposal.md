---
author: qinyi
created_at: 2026-06-22T11:16:01+08:00
---

# Proposal — 统一 Agent Run SSE 客户端

变更：`2026-06-22-unify-agent-run-sse-hook`

## 动机

`/workspaces/{id}/agent` 页的 scan run 中，Claude Code `AskUserQuestion` 触发了远程人审（日志 `agent-run-25116cfa.log:958`），但页面**没弹审批卡片**，5 分钟后被 daemon 兜底超时回退（日志 :960 `permission request timeout (5min fallback)`）。同样的缺陷也存在于 `changes/[cid]` 页（task 执行中的 AskUserQuestion）。

根因：前端存在**两套并行 SSE 客户端**，其中 `streamAgentRunLogs` 在 `agent.ts:137` 把无 `timestamp` 的 `permission_request` 事件直接丢弃；而 `AgentRunStreamClient` 已是它的严格超集（重连/预取/permission 解析全具备），纯属重复实现并存。

## 关键问题（为什么现有方案不够）

1. **审批卡片缺失导致 5min 兜底**：`/agent` 与 `changes/[cid]` 用 `streamAgentRunLogs`，丢弃 permission 事件，AskUserQuestion 无法及时应答，daemon 兜底回退推荐项 —— 用户决策权丢失。

2. **两套 SSE 客户端并存，能力是超集关系**：`AgentRunStreamClient`（class，根页面用，全功能）与 `streamAgentRunLogs`（函数，另 3 处用，缺 permission/重连）。类型已共享，底层差异是假差异。

3. **4 个调用点状态管理重复**：3 处 `onMessage` 回调体几乎一字不差；3 套 `inputValues/submitting/inputErrors/replied` + `handleSubmitInput` 在根/agent/changes 页面各写一份。零碎、易漂移。

## 变更范围

1. 新增 `useAgentRunStream` hook（`lib/use-agent-run-stream.ts`）：封装连接/重连/日志去重/logs/status/loading/error + permission（dialog 恢复 + dismissPerm）+ pending_input 回复，内部用 `AgentRunStreamClient`。
2. 新增 `AgentRunPanel` 组件（`components/agent-run-panel.tsx`）：封装 `AgentLogViewer` + 审批卡片 + input 控件组装，调用点一行 JSX。
3. 4 个调用点迁移到 `<AgentRunPanel>`：根 `page.tsx`（Bootstrap run）、`agent/page.tsx`（活跃 run）、`changes/[cid]/page.tsx`（两触发点合一）。
4. 删除 `streamAgentRunLogs`（`agent.ts:117-162`）+ 清理 3 处 import。
5. 新增 hook 单测 + panel 集成测试。
6. 顺带统一三处 pending_input UI/交互（命名/样式/行为）。

## 不在范围内（显式清单）

- **不改后端**（backend `agent`/`daemon` 模块）—— SSE/REST 契约零改动。
- **不改 `sillyhub-daemon`** —— permission 事件发布链路不变。
- **不改 `AgentLogViewer`** —— 已支持 permissionRequests，只喂数据。
- **不接管"已完成 run 的历史展开"**（`agent/page.tsx` expandedLogs + 下载按钮）—— 保持现有一次性 `getAgentRunLogs` + 直接 `AgentLogViewer`。
- **不做版本兼容**（规则7，未上线），`streamAgentRunLogs` 直接删除。
- **不重构后端 daemon-service**（另一活跃变更 `2026-06-22-daemon-service-split` 的范围，与本变更零文件重叠）。

## 成功标准（可验证）

- ✅ `/agent` 页 scan run 触发 `AskUserQuestion` → 审批卡片在页面弹出，用户可决策（不再 5min 兜底）。
- ✅ `changes/[cid]` 页 task 执行 `AskUserQuestion` → 卡片弹出。
- ✅ `grep -r streamAgentRunLogs frontend/src` 无结果（已删除）。
- ✅ 4 个调用点均渲染 `<AgentRunPanel>`（grep 确认），无残留 `streamAgentRunLogs`/`eventSourceRef`/`dispatchOwnsSseRef`/`connectLogStream` 胶水。
- ✅ 三处 pending_input UI 命名/样式/行为一致（同一 `AgentLogInputControls` 契约）。
- ✅ `cd frontend && pnpm lint && pnpm typecheck && pnpm test` 全过。
- ✅ hook 单测覆盖：permission_request→perms 增、permission_resolved→perms 减、`isActive=false` 不连 SSE、pending_input submit→API+replied、runId 切换重连。
- ✅ panel 集成测试：perms 非空时渲染审批卡片（端到端覆盖 bug）。
- ✅ 后端/daemon 零改动（`git diff backend sillyhub-daemon` 为空）。
