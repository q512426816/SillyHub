# 代码健壮性/性能/架构优化（2026-07-24）

> 性质：**事实 + 变更记录文档**。本轮按用户"全自主、尽量都改、不影响现有功能、再做一遍"指示，
> 对 backend(Python) / daemon(TS) / frontend(TSX) 三端做证据驱动的代码质量提升。
> 所有修改均有 file:line 依据（5 个并行只读审查代理 + 静态检查产出），每批跑对应测试验证零回归。
> 动手前已读 `docs/agent-platform-deep-audit-2026-07-12.md`（能力层审计，与本文件代码质量维度互补）。

---

## 0. 基线（动手前）

| 端 | 测试基线 | 静态检查 |
|---|---|---|
| backend | 2955 passed / 10 skipped / 5 xfailed | ruff ✅ / mypy ✅（全绿，零静态债务）|
| frontend | 1059 passed / 29 todo / 1 file skipped | tsc ✅ |
| daemon | 1945 passed / **7 failed(全超时,预存)** / 8 skipped | tsc ✅ |

> daemon 7 个预存失败全为 30s/60s 超时，集中在 spec-sync(task-09) 与 lease.kind 分流(D-002)，
> 属已知脆弱区（daemon-client spec 同步断裂/策略变更在途），**非本轮代码逻辑引入**，与本轮改动不在同一条代码路径。

---

## 1. 已修复（按 Wave）

### Wave A — 后端正确性（竞态 / TOCTOU / 安全）✅ 验证 2955 passed 零回归

| ID | 文件:行 | 问题 | 修法 |
|---|---|---|---|
| R1 | `daemon/lease/service.py:151` claim_lease | 两个 daemon 同时 claim 同一 lease 的 TOCTOU（都拿走工作区上下文/密钥）| `select(...).with_for_update()` 锁行到 commit |
| R2 | `auth/service.py:270` _consume_refresh_token | 并发 refresh 同一 token 都走"存活"分支→都签发新对，**复用检测永不触发（安全漏洞）**| 匹配后 `FOR UPDATE` 锁 session 行 + 复查 revoked_at，并发第二个转入 grace/重放路径 |
| R3 | `daemon/lease/service.py:713` expire_leases | 并发 expire cron 都选同一批→都标 expired→都触发 handle_lease_expiry 造重复新 lease | `with_for_update()` + `limit(200)` 有界 |
| R4 | `daemon/ws_hub.py:120` send_to_runtime | 锁外持 ws 引用，快速重连时 send 失误会误逐**新**连接 + 取消所有在途 RPC | 锁内快照 ws + 新增 `_evict_stale` 按对象身份 check-and-remove |
| R6 | `ppm/task/service.py:260` start | 双击"启动"产生重复 in-flight TaskExecute（1 plan : 2 execute，第二条永挂）| FOR UPDATE 锁 plan 行 |
| R7 | `ppm/problem/service.py:531` start_problem | 同 R6（problem 双击重复 execute）| FOR UPDATE 锁 problem 行 |
| R8 | `ppm/project/service.py:189` create | 并发建同 project_code，commit 撞唯一约束→500（预检注释承诺 409）| `try/except IntegrityError`→rollback→重跑预检转 409 |
| R9 | `admin/users_service.py:195` create_user | 并发建同 username→500 | 同 R8 模式 |
| R10 | `spec_workspace/service.py:143` ensure_spec_workspace | 并发 init-dispatch get-or-create 都 NotFound→都 create→第二个 500 | catch IntegrityError→rollback→重查 |
| R14 | `workspace/service.py:505` update | 并发改同 slug→500 | `try/except IntegrityError`→`_translate_integrity_error` 转 409（对齐 create 路径）|
| P8 | `daemon/ws_hub.py:147` broadcast | 顺序扇出，单个慢 daemon 拖到 N×10s | 锁内快照 targets + `asyncio.gather` 并发 |
| P10 | `daemon/lease/service.py:735` handle_lease_expiry | 批处理已持 lease 对象却按 agent_run_id 重查（每 GC tick N 次冗余 SELECT）| 加 `lease` 参数直传 |
| P14 | `daemon/lease/service.py:720` expire_leases | 无界 SELECT，后端宕机积压一次性入内存 | `.limit(200)` 分批 |

> 统一修法两类：(a) check-then-modify 单行路径加 `with_for_update`（SQLite no-op / Postgres 行锁，对齐 `session/service.py:1225`）；(b) 唯一约束 commit/flush 路径加 `try/except IntegrityError`→领域 409（对齐 `tool_gateway/policy_router.py:65`）。

### Wave C — 后端同步 I/O 移出事件循环 ✅ 验证 2955 passed 零回归

> 系统级最大阻塞风险：单线程 worker 上一个慢同步 I/O 卡死所有协程 + WS 连接。统一 `asyncio.to_thread`（照抄 `post_scan_validator` / PPM Excel 模板）。

| ID | 文件:行 | 问题 | 修法 |
|---|---|---|---|
| C1 | `tool_gateway/service.py:152` ToolPolicyService.check | check 内同步 `socket.getaddrinfo`（SSRF 检查）在每个工具调度阻塞事件循环 | `await asyncio.to_thread(ToolPolicyService.check, ...)`（纯函数，异常透传）|
| C2 | `tool_gateway/service.py:248/266` _handle_file_read/write | 同步 read_text/write_text 在事件循环 | `asyncio.to_thread` |
| C3 | `tool_gateway/service.py:285/316` _handle_file_list/search | 同步 rglob/iterdir 遍历（递归列大目录阻塞数秒）| 闭包封装遍历 + `asyncio.to_thread` |
| C4 | `worktree/service.py:112,151` acquire/release cleanup | `shutil.rmtree` 整个 git checkout 在事件循环（release 每次都拆全检出）| `asyncio.to_thread(self._exec_env.cleanup, lease_root)` |
| C5 | `workspace/service.py:957` _ensure_spec_workspace | `shutil.rmtree`+`copytree` 整个 .sillyspec 树（文档/变更/技能）在事件循环 | 闭包封装 + `asyncio.to_thread` |

### Wave D — daemon 健壮性 ✅ typecheck 通过，vitest 验证中

| ID | 文件:行 | 问题 | 修法 |
|---|---|---|---|
| D1 | `task-runner.ts:887` _runLeaseHeartbeatLoop | 可中断 sleep 两条路径都不移除 abort 监听器→每个 lease 跑超 25s 累积 10+ 监听器触发 MaxListenersExceededWarning + 内存膨胀 | `done` 守卫 + 统一 cleanup 在定时器/abort 两路径都移除两信号监听器 |
| D2 | `interactive/codex-app-server-driver.ts:718` handleLine | `adapter.parse(line)` 未包 try/catch→畸形行抛异常被 cli.ts 全局处理器吞掉，但 currentTurnPromise 永不 resolve→交互式会话永久卡死 | 包 try/catch（对齐 task-runner.ts:1420），记 warn 后 return |
| D4 | `resilience/service.ts:197` drainOutbox | 外层 `void` 调用，runs()/外层 markDelivered 异常会成未处理 rejection 被静默吞、drain 中途终止 | 加外层 catch 兜底记 warn（_draining 由 finally 复位）|

### Wave E — 前端健壮性 ✅ 验证 1059 passed 零回归

| ID | 文件 | 问题 | 修法 |
|---|---|---|---|
| F1 | `app/error.tsx` + `app/global-error.tsx`（新建）| 全应用无任何 Next.js 错误边界，任意页面渲染期抛错→整页白屏只能刷新 | 新建路由级 error.tsx（保留外层 layout）+ 全局 global-error.tsx（root layout 自身崩溃兜底，自带 html/body + 内联样式）|

---

## 2. 本轮有意 DEFER 的高价值后续（带原因，非遗漏）

| 项 | 原因 |
|---|---|
| Wave B 索引（`agent_run_workspaces.agent_run_id`、`PlanTask.ps_plan_node_detail_id`、leases 复合索引 `(runtime_id,status,created_at)`、`agent_run_logs channel` 部分索引、`agent_runs.started_at`）| 单改模型 `__table_args__` 而不配 alembic migration 会误导（prod PG 不生效）；migrations 已有多个 merge revision，需先 `alembic heads` 核实真实 head 再接一个 migration 防链断裂。**应作为"索引 + migration"专项**，本轮避免半成品。|
| Wave B N+1 查询重写（list_daemon_instances、get_pending_leases、dialogs、import_commit、_find_role_members、_cleanup_before_dispatch、reparse、placement、list_missions 等 ~10 处）| 每处需读懂查询结构 + 批量化改写，涉及面广；与索引专项一起做更高效。|
| Wave C 其余同步 I/O（spec_workspace `_write_spec_root` 混合 DB await 需拆分、worktree/workspace `shutil`、scan_docs/knowledge/task/workspace 解析器 4 处）| 模板同 C1-C3，但 spec_workspace 那处混合 await 不能整块 to_thread 需谨慎拆分；其余可批量照抄。|
| R5 converge_mission 双重 finalize（`finalizer.py:498`）| 光加行锁不够（两并发 converge 串行后第二个仍看到"全终态"再 finalize）；需持久化守卫字段（`converged_at` 列 + migration），属需设计的 MED 项。|
| R12 remove_member 最后所有者 TOCTOU、R11 kanban order、R13 _BreakerState 模块级可变无锁 | LOW，触发条件极窄（双管理员同时删两个不同 owner / 同卡序并发），收益低。|
| A6 缓存 token 聚合不一致（`stream-json.ts` `+=` vs `=`，重复计费）| SAFE=N（改变上报数字），需对照既有输出 diff 验证；印证 memory `claude-cache-token-semantics`。|
| D3 ws-client 回调 try/catch、D5 重连退避、D6 大负载超时、D7 背压、D8 _fire 一次性任务重用、daemon god 文件拆分 | D3 当前回调均 void-async 实际安全（纯防御）；D5/D7 需设计决策（故意为之的 5s 对齐）；god 文件拆分属高风险大改。|
| 前端 F2(useSession 选择器)、F3(permission-panel token 依赖)、F4(log-viewer 预计算)、F6(can_edit helper)、架构 A1/A3/A5 去重 | 均为明确的安全改进，本轮范围/time 已覆盖三大端核心；留二轮。|

---

## 3. 验证

| 端 | 改前 | 改后 |
|---|---|---|
| backend | 2955 passed | 2955 passed（Wave A + Wave C，零回归）|
| frontend | 1059 passed | 1059 passed（Wave E F1，零回归）|
| daemon | 1945 passed / 7 failed(超时) | 1951 passed / 1 failed(基线 flaky 超时 task-09 B2，非本轮引入)|

> 三端静态检查改后仍全绿（ruff/mypy/tsc）。并发修复在 SQLite 测试环境 `with_for_update` 为 no-op（测试不验证并发），Postgres 生产环境加行锁；happy-path 语义不变，故现有测试零回归即证明未破坏现有功能。

---

## 4. 方法论

1. 静态检查建立基线（ruff/mypy/两端 tsc 全绿→无 lint 债务，提升空间在深层）。
2. 5 个并行只读审查代理（后端性能/后端竞态/daemon/前端/架构）产出 file:line 证据清单；后端竞态/性能代理各自再拆子代理深审（lease/router/permission/audit 等）。
3. 自己 Grep 补扫后端 fire-and-forget 异步任务（结论：代码库已用规范"强引用+done-callback"，非问题）。
4. 按"正确性→性能→健壮性"优先级分 Wave，每 Wave 改完跑对应测试对照基线。
5. DEFER 项逐条注明原因（避免半成品 / 需设计 / 需 schema / 当前安全）。

---

## 5. 🟢 第二批（用户"干"后续，2026-07-25）

### Wave B（部分）— 后端性能（索引 / N+1 / 去重）✅ 验证 2955 passed 零回归

| ID | 文件:行 | 问题 | 修法 |
|---|---|---|---|
| B-idx | `workspace/model.py:167` / `ppm/task/model.py:47` / `daemon/model.py:294` + migration `202607250100` | 3 个高频查询缺索引（agent_run_workspaces.agent_run_id 10+ 调用点、PlanTask.ps_plan_node_detail_id 7+ 调用点、daemon_task_leases 复合 (runtime_id,status,created_at) 覆盖 get_pending_leases 轮询）| 模型 `__table_args__` 加 Index + 1 个 alembic migration（接 head `202607231200`，单头核验 `202607250100`，零数据改动）|
| B2 | `daemon/router.py:904` list_daemon_instances | N+1：循环每实例单独查 runtimes + 循环内重 import | RuntimeService 加 `_get_runtimes_by_instances` 批量 IN 查询 + 按 daemon_instance_id 分组（对齐 list_machines）|
| A1 | `daemon/permission_service.py:388` _resolve_daemon_id_for_runtime | 与 `session/service.py:83` 完全重复（docstring 自承 mirrors），演进漂移风险 | 委托 session.service 单一真相源（lazy import 避循环）|

### Wave E（续）— 前端 F2 useSession 选择器（安全子集）✅ 验证 1059 passed 零回归

F2 只做**安全子集**：11 个只读 `user`、不做登录守卫的叶子页，`{ user }` → `useSession((s)=>s.user)`，
token 轮换（~20min + 401 刷新）不再重渲染这些页（含 3000 行的 milestone-details），只在 user 变化时重渲染。
涉及：account / admin(roles/organizations/users) / ppm(task-plans/problem-list/work-hours/milestone-details 桌面+移动 共 8)。

> **F2 故意只做子集**：(a) **layout 守卫页跳过**——dashboard/admin layout 用 `{ hydrated, accessToken }` 做登录守卫，
> 收窄订阅会丢失登出反应（安全回归），需逐组件仔细设计反应性（getState + 选择器混合），本轮不做。
> (b) **mcp 页回退**——其测试 mock 的 useSession 不支持 selector 参数，按 rule 9（测试逻辑无误不改测试通过）
> 回退该页而非改测试 mock（mcp 设置页价值低）。其余 11 页无测试冲突。

### 本批 DEFER（带原因）

| 项 | 原因 |
|---|---|
| Wave B 其余 N+1（get_pending_leases/dialogs/import_commit/_find_role_members/_cleanup_before_dispatch/reparse/placement/list_missions）| **已被新加的索引缓解**（每轮迭代查询走索引变廉价）；完整批量重写涉及面广、查询逻辑改动有风险，留专项。|
| A5 isRecord 4 处去重 | trivial 类型守卫（4×3 行），去重需 8 编辑读 4 import 块或留文件中段 import，churn 不值。|
| F2 layout 守卫页 / app-shell | 需逐组件反应性设计（accessToken 响应式 vs getState），半做破坏 auth gate。|
| F6 can_edit helper / A3 分层倒置 | 纯维护性去重，无性能/正确性收益，边际。|
| R5 converge / A6 缓存 token / god 文件拆分 | 需 schema / SAFE=N / 大重构（见 §2）。|

### 验证（累计）

| 端 | 改前 | 改后（两批累计）|
|---|---|---|
| backend | 2955 passed | 2955 passed（Wave A+C+B 索引/B2/A1，零回归）|
| frontend | 1059 passed | 1059 passed（Wave E F1+F2 安全子集 11 页，零回归）|
| daemon | 1945 passed / 7 failed(超时) | 1951 passed / 1 failed(基线 flaky 超时 task-09 B2，非本轮引入)|
