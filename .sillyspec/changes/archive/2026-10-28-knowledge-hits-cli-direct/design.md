---
author: flow-machine-draft
created_at: 2026-10-27T20:44:33.086Z
---
# 设计记录（Design Record）— 2026-10-28-knowledge-hits-cli-direct

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

CLI 直报主通道（用户拍板方案的收尾，前序变更 2026-10-27-knowledge-hits-flush-button 已落 daemon 补数兜底）的接收侧：CLI 只持有 `shpsync_` 平台令牌（`sillyspec platform connect` 写入 local.yaml 的 platform.url/token），workspace 归属编在令牌里、无显式 workspace_id 可传；现有 `POST /knowledge/hits/batch` 走 `require_permission` 用户鉴权（四轨分轨下 shpsync_ 调不通）。方案：在 platform_sync 命名空间新增字面量端点 `POST /changes/-/hits-sync`（照 spec-manifest/spec-sync 先例：`-` 占位段 + 注册序前置 + `require_platform_sync_write` 鉴权 + workspace 从令牌派生 + 无归属 403 fail-closed），落库一行不写新逻辑——直接复用 `HitsService.ingest_batch` 与 `HitsBatchIn/HitsBatchOut` schema（行 sha256 幂等去重、坏行宽容语义与 daemon 通道完全同源）。选型依据：四轨鉴权知识（patterns.md#四轨鉴权）钉死 shpsync_ 轨不能混用用户轨端点；复用 ingest_batch 保证双通道（CLI 直报 / daemon 上行）行为零分叉，行级幂等使两通道并存重报零副作用（承接前序变更 D-001 三通道并存裁决）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- **新端点 `POST /changes/-/hits-sync`**（platform_sync/router.py，注册序必须在 `/changes/{name}/...` 路由之前——字面量路由铁律）：鉴权 `require_platform_sync_write`（仅 shpsync_，JWT/shk_live_ 403）；workspace_id 从令牌 scope 派生，`scope.workspace_id is None` → 403 fail-closed；请求体 `HitsBatchIn`（`lines: list[str]` + `daemon_local_id: str | None`，CLI 传 `cli-<user>`）、响应 `HitsBatchOut`（`{ingested, skipped_bad, duplicates}`）——两 schema 自 knowledge 模块复用 import，与 hits/batch 完全同构。
- **既有端点/服务零改动**：`POST /knowledge/hits/batch`（daemon 通道）与 `HitsService.ingest_batch`、`stats` 聚合口径均不动。
- **数据层零改动**：knowledge_hits 表结构与索引不变；`daemon_local_id` 列语义微扩（既有 daemon 实例 id 之外新增 `cli-*` 形态，原样落库不 FK 的设计本就容纳任意调用方标识）。
- OpenAPI schema 新增端点 → 前端与 daemon gen:types 三件同变更再生成（FR-05）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。CLI 直报与 daemon 上行并发写同表——ingest_batch 既有 `(workspace_id, line_hash)` 唯一约束幂等（先 SELECT 判存 + IntegrityError 逐行 savepoint 重放）对两通道无差别；同一行被双通道重复上报只是 duplicates 计数，零重复入库。CLI 直报无 offset/游标概念（写一行报一行），乱序到达不影响正确性（行自含 occurred_at）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   多机器 CLI 并发直报 + daemon 周期上行同刻落库——全部收敛到 ingest_batch 既有并发路径（批内 seen_hashes 去重 + DB 判存 + uq 约束兜底竞态），本变更加的端点是无状态转发层，不引入新并发面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。端点无状态（不落游标、不记通道进度）——CLI 直报失败重试或放弃都由本地文件 + daemon 兜底通道兜住（前序变更已落），服务端无中途状态可脏。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不串台。workspace 从 shpsync_ 令牌派生而非请求参数——同一仓库绑多工作区（多令牌）时各令牌各落各 workspace，行级 (workspace_id, line_hash) 去重隔离；与 daemon 通道（junction 显式 wsId）指向同一张表时，同一物理行会在各绑定 workspace 各落一份——既有行为（前序变更盲维四问答同款），非本变更引入。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：**shpsync_ 令牌的写面扩大**——此前 shpsync_ 只开放 spec 同步族端点，本变更新增一个遥测接收端点。缓解：端点只写不读（不返回任何既有数据，回执仅计数）、复用 ingest 宽容语义（坏行跳过不炸）、且遥测数据本就来自令牌持有方自己的仓库执行期——伪造收益仅污染自己 workspace 的遥测统计。次风险：CLI 侧（另仓变更）直报失败的静默面——由 best-effort 语义 + 本地文件必写 + daemon 兜底三层覆盖（前序变更 D-001）。

试过但放弃的方案：
- **扩展现有 hits/batch 端点兼容 shpsync_**（require_permission 加分轨分支）：破坏四轨分轨铁律（patterns.md#四轨鉴权——shpsync_ 与用户轨混开鉴权分支正是分轨设计要防的形态），且该端点 query 显式 workspace_id 与令牌派生两来源冲突；
- **CLI 走用户 JWT**（platform.token 换用户令牌）：platform connect 发的就是 shpsync_ 同步令牌（绑定 workspace 的长寿命令牌），CLI 无用户登录态可持有，改造成本远超新增端点；
- **daemon 代转**（CLI 不直报、等 daemon 周期上行）：即维持现状断流形态，已被用户拍板否决（要实时性主通道）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/platform_sync/router.py | 新端点 POST /changes/-/hits-sync（字面量路由前置注册 + shpsync_ 派生 + ingest_batch 复用） |
| 新增 | backend/app/modules/platform_sync/tests/test_hits_cli_direct.py | 端点单测（派生落库/403 双路/通道标识/幂等计数，复用 conftest shpsync_headers fixture） |
| 修改 | backend/openapi.json | OpenAPI 导出（gen:types 前置） |
| 修改 | frontend/src/lib/api-types.ts | gen:types 再生成（闸门⑨三件） |
| 修改 | sillyhub-daemon/src/api-types.ts | gen:types 再生成 |
