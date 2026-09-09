---
author: qinyi
created_at: 2026-09-09T20:50:00
---

# 决策台账 — 2026-09-09-conflict-root-workspace-scoping

本变更的需求澄清/方案讨论中产生的、有实现或验收影响的决策。长期术语在 archive/scan 时再提升到 glossary.md。

## D-001@v1: 根治方案选 A——全链强制 workspace_id + daemon 映射查根

- type: architecture
- status: accepted
- source: user（Step 4 方案选择轮）
- question: 对比 RPC / 裁决指令按工作区取根的落地形态，候选：A 全链强制 workspace_id + daemon 映射查根；B daemon 扫描所有已知根自动探测；C backend 用平台 spec_root 直传 root_path。
- answer: **方案 A**。对比 RPC `sillyspec_conflict_snapshot` 与裁决指令 `sillyspec_resolve` 全链（REST 请求体 → WS payload → daemon 消息处理 → 前端弹窗下传）强制携带 `workspace_id`；daemon 用 `_sillyspecStatusRoots.get(workspaceId)` 解析根，**映射未命中不得回退单槽位**，抛 RpcError `workspace_root_unknown`（提示该工作区尚未被本机会话认领）；无 workspace_id 的旧调用形态保留单槽位 legacy 语义。辅防：无 workspaceId 的 claim 不再覆盖单槽位。与根因文档 `docs/sillyspec/conflict-compare-wrong-status-root.md` 已定稿口径一致。
- 落选理由:
  - B（扫描猜根）: 多工作区同名 change 二义；裁决是写操作，猜错根会在错误目录执行命令——正是本 bug 的危害模式；违背定稿口径。
  - C（backend 直传 root_path）: 平台 DB 的 spec_root 可能过期，本地映射（claim 实时观察）才是本地真实根；写操作根控制权外移违背定稿口径。
- impacts: [daemon RPC handler / SILLYSPEC_RESOLVE 消息处理 / sillyspec-manager conflictSnapshot+runResolve 签名 / backend ws_hub+machines 端点 / 前端 conflict-compare-modal / OpenAPI + pnpm gen:types]
- 模块域: [sillyhub-daemon, backend, frontend]
- evidence: 方案选择轮（brainstorm Step 4）；代码锚点验证：daemon.ts L6320 RPC 仅透传 change/kind、L6615 RESOLVE payload 仅 change/strategy、L4690-4740 _noteSillySpecStatusRoot 单槽位双写、sillyspec-manager.ts L1131 conflictSnapshot 用 _statusCwd() 单槽位、backend sillyspec_compare.py L371 _fetch_snapshot 无 workspace、前端弹窗 workspaceId 未下传
- priority: P0
