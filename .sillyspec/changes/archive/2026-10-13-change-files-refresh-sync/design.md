---
author: qinyi
created_at: 2026-10-13 12:54:11
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-10-13-change-files-refresh-sync

## 背景

变更详情页文件树接口 `GET /api/workspaces/{ws}/changes/{id}/files`（backend/app/modules/change/router.py:360）只读平台本地镜像目录（change/service.py:606 `list_files` → `_list_files_sync` os.scandir），数据新鲜度完全依赖 daemon 会话终态的 spec 同步——daemon 无会话活动期间（用户在开发机手改文档、手动跑 CLI 等），平台文件树持续滞后，页面上的「刷新」按钮没有意义。

用户诉求：刷新文件树时，若当前用户工作区绑定的 daemon 在线，则触发该 daemon 对**此变更**（非全量）执行 sillyspec 上行同步，同步完成后再返回文件树；离线则维持现状。

探索澄清的关键事实（step3）：用户点名的 `sillyspec platform sync-docs --change X` 只把四件套全文 upsert 进平台 DB documents 列（platform_sync/service.py:1133 `upsert_documents`），**不写文件树读取的镜像目录**；真正落镜像的是 `sillyspec platform sync --change X`（CLI spec-sync.js 以 spec-manifest 为锚 diff → `POST /changes/-/spec-sync` → `apply_ops` 落盘）。因此 daemon 串行执行两条命令（D-001@v1）。

## 设计目标

1. GET files 刷新时：当前用户工作区绑定的 daemon 在线 → 定向触发该 daemon 仅对此变更执行上行同步（`platform sync --change` + `platform sync-docs --change`），同步完成后返回新鲜文件树。
2. 降级铁律：未绑定 / 离线 / RPC 超时 / daemon 端失败（含老 daemon）四路全部静默返回现有镜像数据，GET 永不因同步失败报错（D-003@v1）。
3. 防抖：daemon 侧 15s TTL + in-flight 去重，频繁刷新不打爆 CLI（D-004@v1）。
4. 最小改动面：backend + daemon 两端，前端零改动；`service.list_files` 纯读语义零改动（D-005@v1）。

## 非目标

- 不做全树同步（只按 change 粒度定向同步）。
- 不改 files/content、files/raw、files/pending 端点（用户仅点名列表刷新；后续可复制同款前置，本期不做）。
- 不新增 HTTP 端点、不改任何请求/响应 schema（前端 api-types 无需再生成）。
- 不做跨用户共享防抖 / Redis 级防抖（daemon 单机内存态足够）。
- 不做「同步失败」的用户可见提示（静默降级，日志可见）。

## 拆分判断

单变更单 Wave 可吞吐：两仓合计约 5 个文件、逻辑链路单一（backend 前置 → RPC → daemon 执行 → 降级收口），无上下文分片需求。不拆两仓两个变更的原因：RPC method 是同一契约的生产方（backend）与消费方（daemon），拆开会产生悬空任务（有生产无消费或反之），plan 阶段对账与 review 都以同契约整体为单元才闭环。

## 总体方案

### Phase 1 — daemon 侧：新 RPC method `sillyspec_sync_change`

走既有 `daemon:rpc` 同步回执通道（不新增 fire-and-forget 消息类型），注册方式对齐 host_fs.* 十三方法（daemon.ts:6950 `_registerHostFsRpcHandler` 同款 `ws.registerRpcHandler`）。handler 逻辑：

1. **参数清洗**：`change` 过 `SAFE_CHANGE_NAME_RE`（daemon.ts:1611，与墓碑收敛双端对齐，拒路径穿越）；`workspace_id` 过 `isWorkspaceIdShape`（daemon.ts:1335）。不合法 → RpcError invalid_params。
2. **查本地根**：复用 `_sillyspecStatusRoots`（daemon.ts:5263，claim 时登记的 workspaceId→主仓根 LRU 映射，落盘重启可恢复）取根；查不到 → result `{ok:false, reason:'no_workspace_root'}`（该工作区从未在此 daemon claim 过，合理边界）。
3. **防抖**（D-004@v1）：模块级 Map<`${workspaceId}:${change}`, {ts, ok}>：15s 内已结束过一次（无论成败）→ `{skipped:'debounced', last_sync_at}`；同 key in-flight → `{skipped:'in_flight'}`。Map 惰性清理过期项 + 1000 条硬帽（防异常膨胀）。
4. **串行执行**：cwd=本地根，execFile 依次 `sillyspec platform sync --change X` → `sillyspec platform sync-docs --change X`，单条超时 120s（对齐 `SILLYSPEC_COMMAND_TIMEOUT_MS`）；执行器方法 `runSyncChange(change, workspaceId)` 落 SillySpecCommandExecutor 接口（daemon.ts:1554，runResolve/runTombstoneCleanup 同款惯例）。
5. **结构化回执**：`{ok:true, actions:[{cmd, code, ms}...]}`；CLI 非零/超时 → `{ok:false, reason:'cli_failed', failed_cmd, stderr_tail}`——result 正常回传不 reject，backend 据此降级。

### Phase 2 — backend 侧：GET files 同步前置与降级链

`list_change_files`（change/router.py:360）在调 `service.list_files` 前插入 `_sync_change_via_daemon(session, workspace_id, change, user_id)`：

1. `resolve_member_binding_or_none`（workspace/member_runtimes/resolver.py:41）→ None（未绑定）→ 返回 skipped；
2. `query_daemon_online_by_id`（member_runtimes/queries.py:27）→ None（离线）→ 返回 skipped；
3. `get_daemon_ws_hub().send_rpc(daemon_id, 'sillyspec_sync_change', {change: change.change_key, workspace_id: str(workspace_id)}, timeout=15)` 整体 try/except：`DaemonRuntimeOffline` / `DaemonRpcTimeout` / `DaemonRpcRemoteError` 一律 `log.info` 后放行（D-003@v1）。

**service.list_files 本体零改动**（其它调用方不受影响）。前端零改动，响应 schema 不变。

### Phase 3 — 测试与部署顺序

- daemon（vitest，tests/sillyspec-sync-change-rpc.test.ts）：参数清洗拒穿越 / 15s 防抖跳过 / in-flight 跳过 / 无根映射结构化失败 / 两条命令按序串行 / CLI 失败 result 结构 / 硬帽清理。
- backend（pytest，tests 新文件，mock hub.send_rpc）：在线触发成功后才 list / 未绑定·离线·超时·远端错误四路降级均正常返回 / change_key 与 workspace_id 透传正确 / 既有 test_files_router.py 不破坏。
- 部署顺序：daemon 先发（新增注册对旧 backend 无感），backend 后发——新 backend + 老 daemon → `DaemonRpcRemoteError(method not found)` → 自动降级，无破坏窗口。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/router.py | list_change_files 前插 `_sync_change_via_daemon`（绑定解析 + send_rpc + 四路降级）；新增 import（MemberBindingResolver/query_daemon_online_by_id/get_daemon_ws_hub/异常类） |
| 修改 | sillyhub-daemon/src/daemon.ts | `SillySpecCommandExecutor` 接口新增 `runSyncChange(change, workspaceId)`；`_registerHostFsRpcHandler` 同款注册 `sillyspec_sync_change` handler（参数清洗/防抖 Map/调执行器/结构化回执） |
| 修改 | sillyhub-daemon/src/sillyspec-manager.ts | 新增 `runSyncChange` 执行器：`_sillyspecStatusRoots` 查根 → cwd=根串行 execFile 两条 CLI（各 120s 超时）→ 聚合 actions 结果 |
| 新增 | NEW:backend/app/modules/change/tests/test_files_refresh_sync.py | pytest：四路降级 + 触发成功 + 参数透传（mock send_rpc / binding / online 查询） |
| 新增 | NEW:sillyhub-daemon/tests/sillyspec-sync-change-rpc.test.ts | vitest：handler 参数清洗/防抖/in-flight/无根/串行执行/失败结构 |

## 接口定义

**RPC method（daemon 协议面新增，HTTP 端点面零变化）**：

本变更接口面：0 端点（HTTP 层无新增/修改端点；下方为 daemon WS RPC 协议契约，非 HTTP 端点）

```
method: "sillyspec_sync_change"          # daemon:rpc envelope 内层 method（execute 期对齐既有
                                          # sillyspec_conflict_snapshot/file_diff/scope_audit 平名惯例，
                                          # 由设计期草稿 "sillyspec_sync_change" 精化——Reverse Sync 修正）
params: { change: string, workspace_id: string }   # change=change_key（backend change.change_key 透传）；workspace_id=UUID 字符串
result（正常回执，不 reject）:
  | { ok: true, actions: [{ cmd: "sync"|"sync-docs", code: number, ms: number }, ...] }
  | { ok: false, reason: "no_workspace_root" | "cli_failed", failed_cmd?: string, stderr_tail?: string }
  | { skipped: "debounced", last_sync_at: number }
  | { skipped: "in_flight" }
```

**backend 新私有函数**：

```python
# backend/app/modules/change/router.py
async def _sync_change_via_daemon(session, workspace_id: uuid.UUID, change: Change, user_id: uuid.UUID) -> None:
    """四路失败（未绑定/离线/超时/远端错误）一律 log.info 后静默返回；成功与否都不抛。"""
```

**producer→consumer 数据流（防抖回执字段）**：daemon handler（producer）→ `daemon:rpc_result` envelope `result` 字段 → backend `send_rpc` 解包（ws_hub.py:617 取 result dict）→ `_sync_change_via_daemon` 仅 log 消费（skipped/ok 均放行）→ 不进响应体（GET 响应 schema 不变，consumer 终点=日志）。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| sillyspec_sync_change RPC 请求 | backend | daemon | rpc_id, change, workspace_id | daemon 防抖 Map 标记 in-flight |
| sillyspec_sync_change RPC 回执 | daemon | backend | rpc_id, result（ok/skipped 结构） | in-flight 解除；TTL 时间戳落 Map |

对应代码任务：Phase 1 handler + Phase 2 前置；测试任务：两仓新测试文件各覆盖两事件。daemon 侧子进程生命周期（execFile 120s 超时自灭）见非功能生命周期节。

## 数据模型

无 schema 变更、无迁移。防抖状态为 daemon 进程内存 Map（不落盘、不入库）。

## 兼容策略（brownfield 必填）

- **新 backend + 老 daemon**：RPC method 未注册 → `DaemonRpcRemoteError(method not found)` → 降级返回现有镜像数据，行为与现状完全一致。
- **老 backend + 新 daemon**：老 backend 不发新 method，daemon 新注册闲置无害。
- **未配置/未绑定 daemon 的用户**：`resolve_member_binding_or_none` 返回 None → 跳过，行为与现状一致。
- **回退路径**：backend 侧前置函数整体删除即回滚（service 层无改动，无数据残留）；daemon 侧 handler 注销即回滚。
- **不改变的 API**：GET files 请求/响应 schema 不变；不新增/不修改任何 HTTP 端点与表结构；前端 api-types 无需重新生成。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | GET 延迟增加（CLI 冷启动常态 3~8s，大变更可能更久） | P1 | 15s RPC 超时预算 + daemon 15s 防抖（二次刷新秒回）+ 超时降级（CLI 后台跑完，下次刷新见新数据）；上线后观察接口耗时日志 |
| R-02 | daemon `_sillyspecStatusRoots` 无该工作区根（从未 claim 过）→ no_workspace_root | P2 | 结构化降级不报错；该场景下同步本就无处执行（该 daemon 无此工作区副本），语义正确 |
| R-03 | daemon 本机 sillyspec CLI 未连接平台（platform connect 未配）→ cli_failed | P2 | 结构化降级 + stderr_tail 落日志可排查；不影响 GET 可用性 |
| R-04 | 多成员工作区：A 用户刷新只触发 A 绑定的 daemon，B 机器数据不更新 | P2 | 用户点名语义即「当前用户绑定的 daemon」；B 用户自己刷新触发自己的 daemon，各自收敛 |
| R-05 | RPC 超时（15s）与 daemon 侧 120s CLI 执行的窗口错位：超时后 CLI 仍在跑 | P2 | in-flight 标记在 CLI 结束才解除（期间重复刷新返回 in_flight 秒回）；TTL 从 CLI 结束起算，无重入竞态 |
| R-06 | 防抖 Map 无界增长 | P2 | 惰性清理过期项 + 1000 条硬帽（超帽淘汰最旧） |
| R-07 | 无长驻进程/外部资源遗留——CLI 子进程由 execFile timeout 120s 硬帽自灭（daemon 为父，daemon 退出则子进程随进程树终止），生命周期面无孤儿风险 | P2 | 显式留痕：无长驻进程/外部资源，生命周期面不适用（子进程自灭条件=完成/超时/父进程退出） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案 Phase 1 第 4 步（串行两条 CLI）；接口定义 actions[].cmd 枚举 | 已覆盖 |
| D-002@v1 | 总体方案 Phase 2（send_rpc 触发）；生命周期契约表两事件 | 已覆盖 |
| D-003@v1 | 总体方案 Phase 2 第 3 步（四路降级）；兼容策略；R-01/R-03 | 已覆盖 |
| D-004@v1 | 总体方案 Phase 1 第 3 步（防抖）；R-05/R-06 | 已覆盖 |
| D-005@v1 | 总体方案 Phase 2（router 层前置、service 零改动）；非目标；文件变更清单 | 已覆盖 |
| D-006@v1 | 拆分判断（落选 fire-and-forget 形态不复述为实现）；复潮条件=R-01 恶化 | 已覆盖（rejected） |
| D-007@v1 | 非目标（不加显式端点）；复潮条件=GET 缓存语义被证明污染 | 已覆盖（rejected） |

无未解决决策；无多裁定组合死锁面（D-003 降级与 D-004 防抖相互独立：降级在 backend 发送前/异常路径，防抖在 daemon 接收后，不作用于同一状态机）。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale——scale 按 step8 规模评估落值）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-007 全引用，见决策追踪表）
- [x] 涉及生命周期关键词（daemon）→ 含「生命周期契约表」
- [x] UI 原型分级：纯 backend + daemon 逻辑改动、无任何界面变化（文件树页面/刷新交互/加载态全部维持现状），原型跳过——依据 brainstorm step5 指引「纯后端逻辑/CLI/配置/文档，无任何界面变化」跳过级
- [x] 非功能生命周期：R-07 显式留痕（子进程自灭条件）
- [x] 不确定的问题标注：无 ⚠️ 自审存疑 项——全部依赖设施均已源码实证（send_rpc/绑定解析/根映射/CLI 命令语义）
