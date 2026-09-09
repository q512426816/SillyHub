---
author: qinyi
created_at: 2026-09-09 20:54:48
---
# 提案书（Proposal）

## 动机

2026-09-09 实证：平台冲突对比弹窗 502（`conflict_record_missing`），根因是
「半改造」——列表（心跳采集）已工作区级化，但对比 RPC 与裁决指令仍读**单槽位**
`_sillyspecStatusRoot`，而该单槽位被「无 workspaceId 的 claim、rootPath=Temp」
投毒（`~/.sillyhub/daemon/sillyspec-status-root.json` 落盘 Temp）。更危险的是
**裁决是写操作，会在错误 cwd（Temp）下执行 sillyspec CLI**。

依据：`docs/sillyspec/conflict-compare-wrong-status-root.md`（根因实证 + 已定稿
根治口径）；决策 D-001@v1（方案 A）。

## 关键问题

1. **对比失败且报错误导**：单槽位指向 Temp → `conflict_record_missing` →
   backend 映射 502「请稍后重试」，用户误判为机器/网络故障，重试无效。
2. **裁决有在错误目录执行写操作的实际风险**：`runResolve` →
   `_requireCommandPrecondition` → `_statusCwd()` 单槽位——修好前点「保本地/
   取平台」等于在 Temp 下跑 sillyspec。
3. **投毒入口未封**：`_noteSillySpecStatusRoot` 对无 workspaceId 的 claim 仍
   覆盖并落盘单槽位，重启 daemon 无效（落盘恢复），下一次无身份 claim 再投毒。

## 变更范围

- daemon：`sillyspec_conflict_snapshot` RPC 与 `daemon:sillyspec_resolve` 指令
  透传可选 `workspace_id`；`conflictSnapshot` / `runResolve` /
  `_requireCommandPrecondition` 按工作区映射取根，未命中抛
  `workspace_root_unknown` / 记 failed，**不回退单槽位**（无 workspaceId 的
  legacy 调用保留单槽位读语义）；`_noteSillySpecStatusRoot` 无 workspaceId
  claim 不再覆盖单槽位（辅防）。
- backend：compare RPC params 透传 `workspace_id`；resolve 请求体 + WS payload
  加必填 `workspace_id`；resolve 端点补 workspace 成员校验；（可选）502 网关
  文案按 daemon_code 分叉。
- frontend：裁决弹窗把已有 `workspaceId` 下传进请求体；`pnpm gen:types` 同步
  契约产物。

## 不在范围内（显式清单）

- 不做 `sillyspec_ghost_cleanup` 工作区级化（机器级、无 workspace 上下文）。
- 不做 Temp 目录黑名单（根因文档明确「拒 Temp 不能当主修——错根不只有 Temp」）。
- 不动心跳采集 / `statusTargets` / `sillyspec_status_map`（已工作区级化）。
- 不做 UI 布局/结构改动（纯数据流，HTML 原型跳过）。

## 成功标准（可验证）

- 单槽位被投毒为任意错误目录后：对比请求带 workspace_id 仍能按映射取到正确根
  并返回快照（不再受单槽位影响）。
- 映射未命中时：对比返回 `workspace_root_unknown` 明确报错（非
  conflict_record_missing、非静默回退）；裁决记 failed「尚未被本机会话认领」
  且不 spawn 进程。
- 无 workspaceId 的 claim（rootPath=Temp）执行后：单槽位值不变（投毒入口封死）。
- resolve REST 请求缺 workspace_id → 422；非 workspace 成员 → 403。
- 前端裁决请求体带 workspace_id（测试断言）。
