---
author: flow-machine-draft
created_at: 2026-10-27T08:16:17.881Z
# 知识遥测补数链路：daemon 新路径与变更页同步按钮（2026-10-27）
---

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

断流根因：sillyspec CLI 2026-10-18「runtime 布局分层」把 `knowledge-hits.jsonl` 一次性迁移到 `.runtime/state/`，daemon 上行器仍读旧路径 `.runtime/` 根——文件 ENOENT 被上行器视为「该工作区无命中数据」常态静默跳过，10-17 后全平台零上行。用户拍板终态：CLI 直报为主（sillyspec 仓另立轻量变更）+ 平台按钮经 daemon 按需补数；本变更落平台仓三件：

1. **daemon 读路径双兼容**：上行器与周期器的 hits 文件解析改为 state/ 新路径优先、旧路径回退——新文件即旧文件迁移延续，既有 offset/行指纹状态对新文件前段天然有效（b97f8231 已上行 10070 行直接续走），积压约 1300 行随周期器恢复自动补进库；
2. **daemon 注册 `sillyspec_hits_flush` RPC**：直接调上行器强制跑一轮（上行器本身无短路，短路在周期器 stamp 层——天然绕过），in-flight 去重照 `_runSyncChangeWithDebounce` 先例；
3. **backend `POST /changes/{id}/hits-sync` 端点 + 前端「同步变更」按钮**：端点照 `_sync_change_via_daemon` 降级铁律（绑定解析→在线判断→send_rpc，各失败路不抛、回执带原因），按钮挂沉淀资产卡、成功后 invalidate 刷新。

选型依据：接收端复用既有 `POST /knowledge/hits/batch`（行级 sha256 幂等去重，多通道重报零副作用）——零新表、零新鉴权分支；触达链路复用既有 WS RPC 通道与降级先例——零新协议。否决决策对账：`D-sillyhub-daemon-001@v1`（2026-10-16-conflict-full-tree-compare）曾否决「新增 daemon RPC」，否决前提是「等 daemon 自更新铺开才生效、收益是假想的未来变化」——该前提已被其后落地的 `sillyspec_sync_change` RPC 先例推翻（本项目 daemon 随平台仓自分发），且本变更有真实断流需求与用户拍板，不复潮。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- **daemon `knowledge-hits-upload.ts`**：新增导出 `resolveHitsPath(specDir: string): string`——优先 `state/knowledge-hits.jsonl`、回退旧路径（同步 statSync 判存，读盘方与周期器 stamp 方共用）；`uploadKnowledgeHitsIfNeeded` 的读文件改走该解析。返回签名不变（boolean）。
- **daemon `knowledge-hits-periodic.ts`**：stamp 探测改双路径，stamp 键带来源前缀（`state:`/`legacy:`）防新旧文件同 mtime 误短路。
- **daemon RPC `sillyspec_hits_flush`**：入参 `{workspace_id: string}`；回执 `{ok: boolean, reason?: 'in_flight' | string}`；非法 workspace_id 抛 RpcError invalid_params。specDir 经既有 resolveSpecDir(wsId) 解析。
- **backend 端点 `POST /changes/{change_id}/hits-sync`**（CHANGE_READ，query 参数 workspace_id 同本模块其余端点形态）：响应 `ChangeHitsSyncResult {triggered: bool, ok: bool | null, reason: string | null}`；行为照 GET files?sync=1 的 `_sync_change_via_daemon` 降级铁律，任何失败路 HTTP 200 带回执。OpenAPI schema 新增 → 前端与 daemon 的 gen:types 同变更再生成（FR-05）。
- **frontend**：`lib/changes.ts` 新增 `syncChangeHits(workspaceId, changeId)`；`ChangeAssetsCard` 新增「同步变更」按钮（pending 禁用、回执 toast、成功 invalidate `["changeAssets", …]`）。
- **文件格式**：knowledge-hits.jsonl 行格式零改动；上行状态文件 schema 零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。flush 与周期器并发触发同一上行器——上行状态 offset 批成功后原子前进、失败不动，两执行体交错重报同批由服务端 (workspace_id, line_hash) 唯一约束去重吸收；flush RPC 已超时返回但 daemon 仍在上行（sillyspec_sync_change 同款窗口错位）无害——数据照常落库，按钮下次点击去重。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   两个 flush 并发到达——daemon 侧 in-flight Map 去重（执行中的重复请求秒回 ok:true, reason:'in_flight'），不做 TTL 防抖（flush 是显式用户动作，只有防重入无需防抖）；CLI 同时在 append 新行——上行器只报以 \n 结尾的完整行，尾行半行留下轮（既有 R-01 语义）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。上行中途断连/进程被杀——offset 未前进，下轮（周期器或再次 flush）从断点重试；状态文件 tmp+rename 原子写（既有 writeFileAtomic）；flush 请求中途取消——daemon 侧 Promise 继续跑完，回执丢失零副作用。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不串台。按 workspace_id 隔离——上行状态文件 `.hits-upload-state-{wsId}.json` 既有形态；同一 spec 树多绑定（repo-native junction 多工作区）时各绑定 offset 独立、行按 (workspace_id, line_hash) 各自去重（行会进各绑定工作区各一份——既有行为，非本变更引入）；按变更粒度——本设计是全量增量 flush 而非按 change 名过滤行（效果覆盖该变更且实现更简，行级幂等使多余行零成本），回执不区分变更。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：**线上 daemon 版本铺开滞后**——旧 daemon 未注册 `sillyspec_hits_flush`，backend 收 method not found 走既有 DaemonRpcRemoteError 降级路回 ok=false+reason，按钮如实提示（铁律已覆盖，无新增失败形态）；同理旧 daemon 读不到新路径文件，补数不可用但无副作用。次风险：周期器随路径修复自然恢复（本变更不主动停用——停用是额外代码，保留它作为 CLI 直报上线前的窗口保障与无 TOKEN 环境的兜底通道；双通道并存靠行级幂等零冲突。若用户终态确认要彻底停周期器，删一行挂载即可，届时另起小变更）。用户已裁决主通道为 CLI 直报（另仓变更），本变更的周期器恢复是对「没必要止血」的顺带结果而非独立止血变更。

试过但放弃的方案：
- **CLI 直报并入本变更**：跨仓（sillyspec CLI 仓）改动，轻量变更单仓边界，另立 `sillyspec` 仓轻量变更独立做；
- **按变更名过滤行再上报**（严格实现「哪个变更就同步哪个」）：daemon 侧需加行过滤参数与文件全读开销，而全量增量 flush 效果是超集（该变更行必含其中）、行级幂等使多余行零成本——放弃过滤，回执不分变更；
- **daemon 周期上行器停用**（用户字面「后面都不读这个文件了」）：停用需额外删挂载代码，且 flush 补数与周期器共用同一读路径代码——保留即自然恢复，作为窗口期保障；主动停用反而增加本变更体积。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | sillyhub-daemon/src/knowledge-hits-upload.ts | 新增 resolveHitsPath（state/ 优先、旧路径回退），读盘改走该解析 |
| 修改 | sillyhub-daemon/src/knowledge-hits-periodic.ts | stamp 探测双路径 + stamp 键带来源前缀 |
| 修改 | sillyhub-daemon/src/daemon.ts | 注册 sillyspec_hits_flush RPC（UUID 守卫 + in-flight 去重） |
| 新增 | sillyhub-daemon/test/knowledge-hits-flush.test.ts | flush RPC 单测（强制上行/非法参数/并发去重） |
| 修改 | sillyhub-daemon/test/knowledge-hits-upload.test.ts | 路径优先与回退单测（既有文件扩用例） |
| 修改 | backend/app/modules/change/router.py | 新端点 POST /changes/{id}/hits-sync + _flush_hits_via_daemon helper（照 _sync_change_via_daemon） |
| 修改 | backend/app/modules/change/schema.py | ChangeHitsSyncResult DTO |
| 新增 | backend/app/modules/change/tests/test_hits_sync.py | 端点降级路径单测 |
| 修改 | frontend/src/lib/changes.ts | syncChangeHits API 函数 |
| 修改 | frontend/src/lib/api-types.ts | gen:types 再生成 |
| 修改 | sillyhub-daemon/src/api-types.ts | gen:types 再生成 |
| 修改 | backend/openapi.json | OpenAPI 导出 |
| 修改 | frontend/src/components/changes/detail/change-assets-card.tsx | 「同步变更」按钮（pending 禁用/toast/invalidate） |
| 修改 | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | 按钮交互测试扩用例 |
