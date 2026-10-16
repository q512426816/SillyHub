---
author: flow-machine-draft
created_at: 2026-10-16T07:50:41.181Z
---
# 设计记录（Design Record）— 2026-10-16-change-files-sync-result

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

现场两案例实证三层静默失败：fire-ledger 变更（centos8 daemon）刷新 4 次全失败——1 次 3s 超时降级 + 3 次 daemon 快败回执被后端丢弃；auth-random-logout（本机 daemon）刷新从未触发、用户零感知（其文件没上平台另有服务端根因：2026-10-16 迁移后 `/data/spec-workspaces` 属主由容器用户 999 变 ubuntu 755，后端写落盘 `PermissionError` 致 `POST /api/changes/-/spec-sync` 恒 500——已 ops 侧 `chown -R 999:999` 修复并写进 deploy skill 验证探针，不在本变更代码面重复兜底）。

代码面修三处：① `backend/app/modules/change/router.py` 同步预算 3s→15s（实测同步 5.5~13.5s，3s 下真同步恒超时）；`_sync_change_via_daemon` 从「None + 静默」改为返回结构化回执 dict，daemon ok:false / skipped / 四路异常全部映射，失败记 warning。② `schema.py` 的 `ChangeFileList` 新增可选 `sync_result`，openapi 与双端 api-types 重生成。③ 前端新增零依赖纯函数 `lib/change-file-sync.ts` 把回执翻成中文提示，`change-file-tree.tsx` 刷新点击后接线展示非阻塞琥珀色提示条。

选此方案：延续 2026-10-14「GET 显式 sync」既定路线，历史否决案 D-006@v1（fire-and-forget + 二次刷新）与 D-007@v1（新增 POST 端点）不触碰——GET 纯读语义、单一触发面、无新端点都不动，只补齐「预算按实测校准 + 回执不丢 + 失败用户可见」三件事。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `GET /api/workspaces/{ws}/changes/{id}/files` 响应新增字段：`sync_result: {triggered: bool, ok: bool|null, reason: str|null, stderr_tail: str|null} | null`——仅 `?sync=1` 时非 null，纯读恒 null；纯增量、旧前端忽略即可（向后兼容）。
  - `ok` 三态语义：true=daemon 执行成功；false=执行失败/超时（reason ∈ rpc_timeout / rpc_remote_error / runtime_offline / exception / cli_failed / no_workspace_root / …）；null=未触发（triggered=false，reason ∈ no_binding / daemon_offline）或已触发但防抖跳过（skipped_in_flight / skipped_debounced）。
- `_sync_change_via_daemon(session, workspace_id, change, user_id)` 返回类型 `None` → `dict[str, Any]`；「任何情况不抛」语义不变（D-003@v1）。
- 模块常量：`_FILES_REFRESH_SYNC_RPC_TIMEOUT_S = 15.0`；新增 `_FILES_REFRESH_SYNC_STDERR_TAIL_MAX = 500`（尾段硬帽，daemon 侧已截短、此处兜底）。
- 日志事件（结构化）：triggered / done / skipped（info）｜failed（warning，含 reason 与 stderr_tail）。
- 前端新导出 `changeFileSyncWarningText(sr: ChangeFileSyncResult | null): string | null`（`lib/change-file-sync.ts`，零依赖纯函数）；组件新增提示条节点 `data-testid="change-files-sync-warning"`（行为可见变化仅此一条 UI 元素）。
- 零改动面：`service.list_files` 纯读语义、daemon RPC 协议（`sillyspec_sync_change` 入参与回执形态）、GET 路由签名与鉴权。

## 文件变更清单（本变更交付面自声明）

- backend/app/modules/change/router.py（预算 15s + 回执消费 + warning 日志）
- backend/app/modules/change/schema.py（ChangeFileSyncResult + ChangeFileList.sync_result）
- backend/app/modules/change/tests/test_files_refresh_sync.py（12 用例）
- backend/openapi.json（gen:types 重生成）
- frontend/src/lib/api-types.ts（gen:types 重生成）
- frontend/src/lib/change-files.ts（类型接线 + 注释更新）
- frontend/src/lib/change-file-sync.ts（新增：回执→中文提示纯函数）
- frontend/src/lib/__tests__/change-file-sync.test.ts（新增 10 例）
- frontend/src/components/change-file-tree.tsx（刷新提示条接线）
- frontend/src/components/__tests__/change-file-tree-sync-feedback.test.tsx（新增 6 例）
- sillyhub-daemon/src/api-types.ts（gen:types 重生成）
- .zcode/skills/deploy-to-server/SKILL.md（迁移属主坑条 + 部署验证探针）
- .sillyspec/changes/2026-10-16-change-files-sync-result/**（本变更流程产物）

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：daemon 防抖（15s TTL / in-flight 去重）可能回 `skipped_*`——映射 ok=null 且前端不提示（不误报失败）；「上轮 CLI 超时后仍在跑、下轮点击命中 in_flight 秒回」的既有窗口错位被本回执如实表达（老数据 + skipped 说明），语义自洽。
2. 并发写：后端只读回执、写响应，无可变共享态；stderr_tail 长度硬帽防响应放大。前端 `syncWarning` 为组件内 state，快速连点以最后一次响应为准（每次响应自带各自回执，不会错配到别的点击）。
3. 切换/生命周期：请求发出后用户切换 workspace/change 时，旧响应可能后到覆盖——这是 `setTree` 既有风险面，本变更未放大（提示条同样只反映最近一次响应）；GET 超时/异常一路降级不抛，请求中断安全。
4. 作用域：回执绑定单 (workspace_id, change_id, 请求者的绑定 daemon) 三元组，无跨工作区/跨仓串台面；未绑定即 no_binding 明确表达（不借用他人 daemon，原语义保持）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：15s 预算让「刷新」在同步窗口内最长等 15s（原 3s 秒回旧数据）——用「等待换正确」；极端大仓首同步 >15s 仍会超时，但 daemon 侧继续完成、防抖 TTL 内重点秒回新数据（有明确降级路径，不卡死）。若未来实测普遍 >15s，应改异步推送而非继续加预算（本变更未做，留作后续观察项）。
- 死路（已否决，勿复潮）：fire-and-forget + 前端二次刷新启发式（2026-10-13 D-006@v1）；新增显式 POST 同步端点（D-007@v1）；「继续 3s 只补日志」——治不了「刷不到」主诉，只增排障信息，不采。
- 运维同根因（服务器属主漂移致 spec-sync 500）属部署面，已由 ops 修复 + deploy skill 探针守护，代码面不做属主自动修补（越权面）。
