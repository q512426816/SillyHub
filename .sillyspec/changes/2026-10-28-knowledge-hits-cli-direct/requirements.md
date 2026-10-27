---
author: flow-machine-draft
created_at: 2026-10-27T20:44:33.086Z
---
# 需求规格（Requirements）— 2026-10-28-knowledge-hits-cli-direct

## 功能需求

### FR-01: backend 新增 POST /changes/-/hits-sync（platform_sync 命名空间，字面量路由注册序先例同 spec-sync）：require_platform_sync_write 鉴权，workspace_id 从 shpsync_ 令牌派生，无归属 403 fail-closed

- backend 必须在 platform_sync 命名空间新增 `POST /changes/-/hits-sync` 端点（`-` 字面量占位段，注册序在 `/changes/{name}/...` 之前，照 `spec-manifest`/`spec-sync` 先例）；鉴权必须用 `require_platform_sync_write`（仅 shpsync_ token 可写，JWT/shk_live_ 有效也 403——四轨分轨铁律）；落库工作区必须从 shpsync_ 令牌派生（不信任请求方传 workspace 标识），令牌无工作区归属时必须 403 fail-closed（同 spec-sync 防御分支）。

#### 场景：shpsync_ 直报落库

- Given：shpsync_ 令牌绑定工作区 W
- When：POST /changes/-/hits-sync 携带 jsonl 行数组
- Then：行落 W 名下 knowledge_hits（行 hash 幂等去重），HTTP 200 回执 {ingested, skipped_bad, duplicates}

#### 场景：无工作区归属令牌

- Given：令牌形态异常无 workspace 派生
- When：POST /changes/-/hits-sync
- Then：HTTP 403 fail-closed（同 spec-manifest 防御分支）

### FR-02: 请求体 HitsBatchIn / 响应 HitsBatchOut 与现有 hits/batch 完全同构，落库复用 HitsService.ingest_batch（行 hash 幂等去重语义不变），daemon_local_id 落调用方标识（CLI 传 cli-<user> 或缺省）

- 请求体必须复用 `HitsBatchIn`（lines + daemon_local_id）、响应复用 `HitsBatchOut`，与现有 `POST /knowledge/hits/batch` 完全同构；落库必须复用 `HitsService.ingest_batch`（行 sha256 幂等去重、坏行宽容跳过计数语义零改动）；CLI 通道行的 `daemon_local_id` 应落 `cli-` 前缀标识（请求方显式携带，缺省 None）——数据层留通道归属，便于区分 CLI 直报与 daemon 上行。

#### 场景：CLI 通道标识

- Given：请求 body 携带 daemon_local_id="cli-alice"
- When：落库
- Then：knowledge_hits 行 daemon_local_id="cli-alice"，与 daemon 上行行（daemon 实例 id）可区分

### FR-03: daemon_local_id 与既有通道行可区分（数据层留归属，统计口径不受影响——USAGE_TYPES 聚合同源）

- 统计口径必须不受本变更影响：`HitsService.stats` 与变更详情「知识触达」查询只按 workspace_id/type 聚合、不按 daemon_local_id 过滤——CLI 直报行与 daemon 上行行同源进聚合；实现面零改动即为满足，测试以「CLI 标识行同样进入 ingest 计数」验证。

#### 场景：双通道行同源

- Given：同一 workspace 下 daemon 上行行与 CLI 直报行各若干
- When：ingest 与统计
- Then：两类行同等落库去重、同等进 USAGE_TYPES 聚合

### FR-04: 相关单测通过：shpsync_ 鉴权派生落库路 / 无归属 403 / 坏行宽容计数与既有 ingest 语义一致

- 必须新增端点单测并全部通过（只跑本变更相关测试，禁全量）：shpsync_ 鉴权派生落库（行进令牌派生 workspace）、无归属 403、JWT/shk_live_ 403（四轨分轨）、坏行 skipped_bad 宽容计数、重复行 duplicates 计数（幂等重报零新增）。

#### 场景：收口实测

- Given：实现完成
- When：跑 platform_sync 的 hits 直报测试文件
- Then：全部通过

### FR-05: backend schema 改动同变更内跑前端与 daemon 的 pnpm gen:types 并提交三件

- backend 新端点使 OpenAPI schema 变更后，同一变更内必须执行前端 `pnpm gen:types` 与 `pnpm -C sillyhub-daemon gen:types` 并提交三件（backend/openapi.json、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts）——断言面闸门⑨义务。

#### 场景：schema 变更即再生成

- Given：端点写入且 openapi.json 导出
- When：变更收口前
- Then：两个 gen:types 已跑、三件入库且含新端点

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/platform_sync/tests/test_hits_cli_direct.py「shpsync_ 直报行落令牌派生工作区」
FR-01: backend/app/modules/platform_sync/tests/test_hits_cli_direct.py「无工作区归属令牌 403 fail-closed」
FR-02: backend/app/modules/platform_sync/tests/test_hits_cli_direct.py「daemon_local_id 通道标识原样落库」
FR-03: backend/app/modules/platform_sync/tests/test_hits_cli_direct.py「重复行幂等与坏行宽容计数同既有 ingest 语义」
FR-04: backend/app/modules/platform_sync/tests/test_hits_cli_direct.py「JWT/shk_live_ 凭据 403（四轨分轨）」
FR-05: 不适用：构建产物再生成义务，由 CI 断言面闸门⑨兜底，无独立断言测试面
