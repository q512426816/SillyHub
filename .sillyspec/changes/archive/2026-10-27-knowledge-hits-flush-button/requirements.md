---
author: flow-machine-draft
created_at: 2026-10-27T08:16:17.881Z
# 知识遥测补数链路：daemon 新路径与变更页同步按钮（2026-10-27）
---

## 功能需求

### FR-01: daemon hits 读取路径优先 .runtime/state/knowledge-hits.jsonl、旧路径回退，周期器对新路径恢复增量上行（本仓实测积压行补进 knowledge_hits 表）

- daemon 上行器与周期器读知识命中遥测时，必须优先解析 `<specDir>/.runtime/state/knowledge-hits.jsonl`（sillyspec CLI 2026-10-18 runtime 布局分层后的新位置），新路径文件不存在时必须回退读旧路径 `<specDir>/.runtime/knowledge-hits.jsonl`；两处均不存在时保持现行语义（视为该工作区无命中数据，静默跳过、零日志）。offset/行指纹增量机制与分批上行语义必须不变（新路径文件即旧文件迁移后的延续，已上行 10070 行的 offset 对新文件前段天然有效）。

#### 场景：新布局主路径

- Given：specDir/.runtime/state/knowledge-hits.jsonl 存在（当前 CLI 形态）
- When：周期器轮询或 flush 指令触发上行
- Then：读该文件并按既有 offset/行指纹增量上行；服务端 (workspace_id, line_hash) 去重吸收历史重报

#### 场景：旧布局回退

- Given：state/ 下文件不存在而 .runtime/knowledge-hits.jsonl 存在（旧版 CLI 环境或迁移前形态）
- When：触发上行
- Then：回退读旧路径，行为与现行完全一致

#### 场景：两处皆无

- Given：两个路径的文件都不存在
- When：周期器轮询
- Then：记空印静默跳过（无数据工作区是常态，零日志噪音——现行语义不变）

### FR-02: daemon 注册 sillyspec_hits_flush RPC：收到指令即对该工作区强制执行一次上行（绕过 mtime 短路）并回执

- daemon 必须注册 `sillyspec_hits_flush` RPC 处理器：workspace_id 参数必须做 UUID 形态守卫（照 `sillyspec_sync_change` 先例，非法抛 RpcError invalid_params）；收到指令即直接调用上行器执行一次该工作区的增量上行（上行器自身不走周期器的 mtime 短路），返回结构化回执 `{ok: boolean, reason?: string}`；上行器内部异常必须被捕获转成 `ok:false` 回执（不向 RPC 层抛）；并发到达的重复指令必须做 in-flight 去重（照 `_runSyncChangeWithDebounce` 先例，执行中的重复请求秒回 `ok:true, reason:'in_flight'`）。

#### 场景：有积压行

- Given：该工作区 hits 文件有未上行的新行
- When：RPC sillyspec_hits_flush 到达（workspace_id 合法）
- Then：立即上行新行并回执 {ok:true}；服务端行级去重保证重报零重复

#### 场景：无新行

- Given：文件行数已全部上行（offset 追平）
- When：flush 指令到达
- Then：无批可发，回执 {ok:true}（无新行不是错误）

#### 场景：非法参数

- Given：workspace_id 非 UUID 形态
- When：flush 指令到达
- Then：抛 RpcError invalid_params（参数守卫先例同 sillyspec_sync_change）

### FR-03: backend 新端点照 _sync_change_via_daemon 降级铁律：daemon 在线触发 RPC 返回结构化回执（triggered/ok/reason），未绑定/离线/超时均不抛

- backend 必须新增 `POST /changes/{change_id}/hits-sync` 端点（CHANGE_READ 权限，照 GET files?sync=1 先例）：先取变更实体，再走与 `_sync_change_via_daemon` 同款降级铁律链路——per-member 绑定解析（无绑定回 reason=no_binding）→ daemon 在线判断（离线回 reason=daemon_offline）→ `send_rpc('sillyspec_hits_flush')`（超时/远端错误含老 daemon method not found 均回 ok=false+reason，不抛）。端点任何失败路径必须返回 HTTP 200 携带回执字段，禁止向调用方抛 5xx。

#### 场景：在线成功

- Given：绑定 daemon 在线且回执 ok=true
- When：POST /changes/{id}/hits-sync
- Then：返回 {triggered:true, ok:true, reason:null}

#### 场景：未绑定

- Given：操作用户对该工作区无成员绑定
- When：POST /changes/{id}/hits-sync
- Then：HTTP 200 {triggered:false, ok:null, reason:"no_binding"}

#### 场景：daemon 离线

- Given：绑定存在但 daemon 不在线
- When：POST /changes/{id}/hits-sync
- Then：HTTP 200 {triggered:false, ok:null, reason:"daemon_offline"}

#### 场景：RPC 超时/远端错误

- Given：daemon 在线但 RPC 超时或老 daemon 未注册 method
- When：POST /changes/{id}/hits-sync
- Then：HTTP 200 {triggered:true, ok:false, reason:"<超时/错误标识>"}，不抛

### FR-04: 变更详情页新增「同步变更」按钮：点击调新端点、按回执提示成败原因、成功后刷新沉淀资产卡

- 变更详情页沉淀资产卡必须新增「同步变更」按钮：点击调用 hits-sync 端点；必须按回执给用户可读提示（成功提示同步完成、失败提示原因文案——daemon 离线/未绑定/超时）；回执 triggered 且 ok 后必须刷新沉淀资产查询（invalidate changeAssets query）使「知识触达」分组即时出现；请求进行中按钮必须置禁用防连点。

#### 场景：成功补数

- Given：daemon 在线、本机有未上行遥测行
- When：用户点击「同步变更」
- Then：提示同步完成，沉淀资产卡数据刷新，知识触达分组随新数据出现

#### 场景：daemon 离线

- Given：绑定 daemon 不在线
- When：用户点击「同步变更」
- Then：提示 daemon 离线及含义（本机数据无法上传），数据不变更

### FR-05: backend schema 有改动时同变更内跑前端与 daemon 的 pnpm gen:types 并提交

- backend 新端点使 OpenAPI schema 变更后，同一变更内必须执行前端 `pnpm gen:types` 与 `pnpm -C sillyhub-daemon gen:types`，并提交再生成的 `frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-types.ts` 与 `backend/openapi.json`（断言面闸门⑨义务，不让类型落后后端形成债）。

#### 场景：schema 变更即再生成

- Given：backend 新端点已写入并导出 openapi.json
- When：变更收口前
- Then：两个 gen:types 均已跑过且三件产物与 schema 一致并入库

### FR-06: 相关单测通过（backend 端点降级路、daemon 路径回退与 flush、frontend 按钮交互）

- 本变更三面单测必须通过且只跑本变更相关测试（禁全量）：backend 端点降级路径（未绑定/离线/超时不抛）、daemon 路径回退与 flush 强制上行、frontend 按钮交互（点击→请求→提示→成功后刷新）。

#### 场景：收口实测

- Given：三面实现完成
- When：分别跑 backend/daemon/frontend 的相关测试文件
- Then：全部通过，失败即修（禁止改测试迁就实现）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/test/knowledge-hits-upload.test.ts「新路径优先：state/knowledge-hits.jsonl 被读取上行」
FR-01: sillyhub-daemon/test/knowledge-hits-upload.test.ts「旧路径回退：state 文件缺省时读 .runtime/knowledge-hits.jsonl」
FR-02: sillyhub-daemon/test/knowledge-hits-flush.test.ts「flush 指令强制上行并回执 ok」
FR-02: sillyhub-daemon/test/knowledge-hits-flush.test.ts「非法 workspace_id 抛 invalid_params」
FR-03: backend/app/modules/change/tests/test_hits_sync.py「未绑定/离线/超时各降级回执不抛」
FR-04: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「同步按钮：点击请求→回执提示→成功后刷新资产查询」
FR-05: 不适用：构建产物再生成义务，由 CI 断言面闸门⑨兜底，无独立断言测试面
FR-06: 不适用：汇总性条款——FR-01~04 测试绑定行即其对账面
