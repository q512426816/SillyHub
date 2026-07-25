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

---

## 6. 🟢 第三批（2026-07-25，用户"再做一轮"指示）

> 性质延续前两批：证据驱动（2 并行只读审查 agent 产 file:line 清单 + 读源码核实每处），
> 按"真实阻塞收益 + 零回归风险"取舍——**不做过度优化**（小文件 write_text to_thread、
> 低频导入 N+1 等）。动手前已读本文件 §1-§5 + `docs/agent-platform-deep-audit-2026-07-12.md`。

### Wave C 续 — 后端/daemon 同步 I/O 移出事件循环 ✅ 零回归

| ID | 文件:行 | 问题 | 修法 |
|---|---|---|---|
| C6 | `change/service.py` list_files/read_file/write_file/sync_documents | rglob+stat / read_text / write_text（含循环）在 async 内 | 抽 `_list_files_sync`/`_read_file_sync`/`_write_text_sync` helper + `asyncio.to_thread` |
| C7 | `runtime/service.py` get_artifacts/_read_text | iterdir+stat（server-local 分支）/ read_text | 抽 `_list_artifacts_local`/`_read_text_local` + to_thread |
| C8 | `change/dispatch.py:1238` read_verify_result | read_text | 抽 `_read_verify_result_sync` + to_thread |
| C9 | `workspace/skills_view_service.py` list_skills/get_mcp_config | iterdir / read_text+json | 抽 `_list_skills_sync`/`_read_mcp_config_sync` + to_thread |
| C10 | `agent/skills_bundle_service.py` _gather_all_files/build_skills_bundle | 经同步 helper（glob/rglob/read_bytes）/ tarfile 构建 | `_collect_skill_files` 调用点 to_thread + 抽 `_build_tar_gz` + to_thread |
| C11 | `workspace/router.py:93` + `workspace/service.py:440` | scanner.scan（iterdir+parse）被 async 调用点同步调用 | 调用点 `asyncio.to_thread(service.scan, ...)` |
| C12 | `spec_workspace/service.py:560` _write_spec_root | tarfile 校验+extractall + rmtree staging（大 tar 阻塞） | 抽 `_extract_spec_tar_to_staging`（校验+解包）to_thread + rmtree to_thread；per-file read_bytes/DB/move 保留 loop（与 DB await 交织，小文件非瓶颈） |
| C13 | `change/projection.py:62` compute_pending_review | sqlite3 直读 sillyspec.db（mode=ro）在 async 内 | 抽 `_read_stage_progress_sync` + to_thread（对齐 `runtime/service.py:108` 范式） |
| D9 | `sillyhub-daemon/src/skill-manager.ts:171` extractSkillsBundle | gunzipSync（bundle 解压在 async 内） | `promisify(gunzip)` → `gunzipAsync` |

DEFER（带原因，非遗漏）：

| 项 | 原因 |
|---|---|
| `change_writer` create_change/generate_document/batch_generate（write_text）| KB 级 markdown 写，微秒级；to_thread 线程池开销 > 阻塞，过度优化 |
| `change/dispatch.py` _sync_stage_status_daemon_client（sqlite3）| 降级 `return StageSyncResult` 路径多、频率中、阻塞不大；重写风险/收益不划算 |
| daemon `workspace.ts` prepareWorkspace existsSync/statSync 探针 | 单次 syscall，收益微 |
| daemon `dist_router` get_install_ps1 / dispatch `_resolve_db_path` | 一次性小文件 / 单次 stat |
| `agent/context_builder` + `post_scan_validator`（async 调 sync helper）| 一次性 spec 读 / scan 校验，非高频瓶颈 |
| daemon `rmtreeWindowsSafe`（workspace.ts:369）| **有意同步设计**（R-06/FR-06）：Node v26 `fs.promises.rm` 在 vitest 有 rimraf callback 竞态，注释明示；改异步重引入测试竞态 |
| daemon `path-utils` realpathSync（写决策热路径）| 异步化要改 `resolveRealPath` 签名，波及 PolicyEngine 所有 canWrite/canCreate，中风险 |

### Wave B — N+1 查询批量化（部分）✅ 零回归

> 只读审查 agent 核实 DEFER 清单 8 处：真 N+1 共 5 处，本批改 3 处（高频/清晰），2 处低频导入 defer；另 5 处审查确认**已批量/非 N+1**（get_pending_leases 已用复合索引+单 JOIN / _find_role_members 单查 / _cleanup_before_dispatch 固定 3 查 / scan_docs reparse 已批量 / placement 单 run 决策）。

| ID | 文件:行 | 问题 | 修法 |
|---|---|---|---|
| B3 | `agent/router.py:730` list_missions | 每 mission 调 worker_runs + cost_so_far（**内部重复 worker_runs**）+ _load_mission_artifacts = 3 SELECT × N | 一次 runs `IN mission_ids` + 一次 artifacts `IN run_ids`；cost 复用 runs 聚合（sum total_cost_usd） |
| B4 | `change/service.py:975` reparse → _sync_docs | 每 change 一次 `_fetch_existing_docs`（ChangeDocument WHERE change_id） | 循环前一次 `ChangeDocument WHERE change_id IN (...)` → dict 分组；_sync_docs 加 `existing_docs` 参数（None 兜底旧调用方） |
| B5 | `daemon/permission_service.py:578` list_pending_dialogs（chat 分支）| 每 chat 型 dialog 一次 `SELECT AgentRunLog LIMIT 1` | 预推导 session_type + 一次 `SELECT AgentRunLog WHERE run_id IN (...) ORDER BY timestamp DESC` → Python 端按 run_id 取首条 |

DEFER（带原因）：

| 项 | 原因 |
|---|---|
| `ppm/problem` import_commit._build_module_maps（每项目 4 表 JOIN）| 手动 Excel 导入低频，N=项目数小 |
| `ppm/plan` import_commit 两段循环（_find_existing_module + _ensure_task_for_detail）| 最复杂：`kanban_order=max+1` 需 per-user 递增计数器 + _resolve_project_context/_lookup_user_name 批量反查；低频导入，风险/收益不划算 |

### Wave C — R5 converge 重复收敛守卫 ✅ agent 317 passed 零回归

| ID | 文件:行 | 问题 | 修法 |
|---|---|---|---|
| R5 | `agent/finalizer.py:469` converge_mission_for_completed_run | 两个 worker 同时 complete → 都 derive 出 done/degraded → 都跑 finalize（重复 GLM 合并 / 重复 merge artifact / 重复计费） | `AgentMission` 加 `converged_at` 列 + migration `202607251000`；finalize 前原子 `UPDATE...WHERE converged_at IS NULL` 抢占，`rowcount=0` 跳过 |

> **为何用原子 UPDATE 而非 with_for_update 行锁**：`finalize_bootstrap_mission`/`finalize_execute_mission` 内部有 commit（会释放行锁），行锁挡不住"finalize commit 后、converged_at 置位前"的并发窗口；原子 `UPDATE...WHERE IS NULL` 是单 SQL，不受后续 commit 影响。
> **为何守卫放 finalize 前而非 collect 前**：`collect_completed_artifacts` 幂等（execution.py:305 注释 + 321 查重，已有 artifact 的 run 跳过），重复 collect 无害，守卫只需挡重的 finalize。
> **不破坏重入**：`mcp_tools.converge_mission` 的冲突重入靠 `_finalize_merge_for_mission`（独立调 finalize_execute_mission，task-06 §5.2），不依赖 `converge_mission_for_completed_run` 内的 finalize；`test_converge_mission_reentrant` mock 了 `converge_mission_for_completed_run`，不触及守卫。

### Wave C — A6 缓存 token 聚合（DEFER）

| 项 | 原因 |
|---|---|
| `stream-json.ts` cache token 聚合（L461 `+=` / L549 `=` / L706 `+=`）| **语义微妙 + SAFE=N**：message_start（L461 `+=`）累加每个 API call 的 cache（一 turn 多 tool-use call 各自增量），message_delta（L549 `=`）是累计覆盖——这不是简单"+= → ="，需对照真实 Claude stream-json 输出确认每事件的 cache 语义。代码经 ql-token-fix/task-01 修正过，盲目改破坏计费。留专项（需真实数据 diff 验证）。印证 memory `claude-cache-token-semantics`。 |

### 验证（累计三批）

| 端 | 第三批改后 |
|---|---|
| backend | 2955 passed（Wave C 续 + Wave B + R5，零回归）|
| backend 静态 | ruff ✅ / mypy ✅（494 文件全绿）|
| frontend | 未改（本轮无前端改动）|
| daemon | skill-manager 25 passed；全量 1950 passed / 2 failed（task-09 B1+B2 超时 flaky，重跑 B1 14 passed 确证非本轮引入）；tsc ✅ |

> daemon 全量 2 failed（B1+B2）均为 task-09 spec-sync 的 vitest hook 10s 超时（环境性 flaky），重跑 `daemon-interactive-spec-sync.test.ts` 14 passed 确证；memory `sillyspec-324-verify-archive-pitfalls` 标注该区为已知脆弱。skill-manager 改动（gunzipAsync）单测 25 passed，与 spec bundle（pullSpecBundle）不同代码路径。
> 三批累计 alembic 单头 `202607251000`（接 `202607250100`），migration 链无分叉。

---

## 7. 🟢 第四批（2026-07-25，用户"重新分析"指示）

> 性质延续前三批：证据驱动（4 并行只读审查 agent 因账户 429 挂 3 个，但后端正确性的
> 数据一致性子代理 + 后端性能 + daemon 三份报告成功返回，共 336 次工具调用），5 个最高
> 价值 HIGH 全部主 agent 亲自读源码核实（行号准确）。DEFER 项逐一复评，顺带纠正前批 D8 误判。

### Wave F — 后端正确性/性能 + daemon 卡死 + 前端轮询健壮性 ✅ 零回归

| ID | 文件:行 | 问题 | 修法 |
|---|---|---|---|
| F1 | `change/dispatch.py:840` | gate_retry_count 被 dispatch() 用新 dict 覆盖→**R12 死循环防护生产完全失效**（verify gate 失败无限重跑烧钱）；现有 test_gate_retry 全 mock dispatch 绕过覆盖点，单测全绿却掩盖 | :840 改 merge 保留 count + 跨 stage 重置；补不 mock dispatch 的 e2e（同 stage 保留 / 跨 stage 重置两条） |
| F2 | `auth/service.py:278,330` | refresh token 校验循环内同步 bcrypt（cost-12，250-400ms/次 × N session 全表扫）**阻塞事件循环**；api_key 同模式已修（to_thread + Redis），refresh 漏修且每~20min 轮换更高频。R2 只修并发未修 blocking | `_consume_refresh_token` + `_find_revoked_session` 两处 verify 包 `asyncio.to_thread`（对齐 api_key_service:237） |
| F3 | `daemon/session/service.py:1719` | session 日志 min_ts_subq 对最大表 agent_run_logs **全表 GROUP BY 无 session 过滤**，随日志增长线性恶化 | 子查询加 `WHERE run_id IN (该 session 的 runs)` 收敛聚合范围 |
| F4 | `ppm/workbench/service.py:502,520` | 工作台"我的待办"①② 无 limit + concat 包裹 now_handle_user 致索引失效全表扫（含 Text 大列），首屏必跑；③ 已有 limit | ①② 各加 `.limit(_TODO_SOURCE_LIMIT)` 对齐③（止血全表实体化；根治 concat-LIKE 需拆关联子表 + migration，DEFER） |
| F5 | `codex-app-server-driver.ts:669` | exit handler 仅 code!==0 才 finalize → codex 干净退出(0)/被信号杀(null) 时不置 finalized，consume 主循环永不退出、currentTurnPromise 永不 resolve → **交互式会话永久卡死**（主 agent lease 永不过期，卡到 daemon 重启）。现有测试都先 close() input 让 consume break 再 _emitExit，故未捕获 | exit handler 改任何 !h.closing 退出都 finalizeWithError（对称于 'error' handler，加 signal 参数）+ 补不 close input 的 fake child exit(0)/exit(null) 回归测试。finalizeWithError 幂等（finalized 守卫） |
| F6 | `workspace-config-card.tsx` | MED-1: handleInit initPoll 无 5min deadline（daemon 卡住时无限轮询，handleSyncManual 已有 R-06 5min 兜底）；LOW-1: handleSyncManual 5min setTimeout 未存 ref，unmount 未 clearTimeout | handleInit 加 5min deadline（initDeadlineRef）对齐 R-06；setTimeout 存 syncDeadlineRef；unmount + 自停分支 clearTimeout |
| F7 | `frontend/lib/daemon.ts:459` | streamQuickChat 死代码（无生产调用方，仅 2 个 test 的 vi.mock 字段 + 废弃注释） | 删除函数（test 用 vi.mock 独立 vi.fn()，零影响） |

### DEFER 复评结论（维持不做，附核验依据）

| 项 | 复评结论 |
|---|---|
| 后端新增索引 | **无需**：性能 agent 逐一核实候选（AgentRunLog.channel/subagent_type、DaemonTaskLease.kind、ChangeDocument.last_modified_at 等），leading filter 已被既有索引覆盖或仅写入无查询；剩余 LOW 遵循 Wave1 YAGNI |
| daemon D3/D5/D6/D7 | 维持不做：D3 回调实际安全（fire-and-forget 不 reject）；D5 重连 5s 对齐 Python parity；D6 30s 超时够；D7 背压 parity |
| **daemon D8 `_fire` 一次性任务重用** | **确认是前批误判**：daemon.ts:1714-1769 每次 crash 后 .catch 内递归调 _fire 新建 AbortController + promise（_controllers finally 删旧），非重用 one-shot controller。代码实际正确 |
| daemon ND-2 codex _close 不等 exit | 维持 DEFER：仅 daemon 异常 shutdown 时 codex 子进程可能孤儿，待 shutdown 链路专项 |
| daemon god 文件拆分 | 维持不做：高耦合 lease payload 鸭子类型几十处，无低风险切片 |
| import_commit N+1（_build_module_maps/两段循环） | 维持 DEFER：手动 Excel 导入低频，N 小；批量化需重写 kanban per-user 计数器 |
| A6 stream-json cache token 聚合 | 维持 DEFER：语义微妙（+= vs =）+ SAFE=N，需真实数据 diff |

### 其余已识别但未在本批做的 HIGH/MED（留后续批次）

> 本批聚焦"已核实 + 零回归 + 无需 migration"的 7 项。以下数据一致性 HIGH 需设计/migration，留专项：
> - file 存储一致性三连（upload 补偿 / soft_delete reaper / import_commit 原子化）—— platform-file-center 收尾债
> - PPM 父表删除不级联（plan/problem/task/project）—— 需逐表 + PG migration
> - workspace soft_delete 不取消在跑任务 / create 多事务孤儿
> - submit_feedback blocked 死锁、transition() 对 blocked 抛 500、write_file 顺序颠倒、PPM helper 内部 commit 破坏原子性、execute_problem 无行锁、PPM 全域缺乐观锁（已有 coordinator 范式）

### 验证（第四批）

| 端 | 改动 | 改后 |
|---|---|---|
| backend | F1-F4 | change 272 / auth 98 / session 21 / workbench 57（全零回归）；ruff ✅ / mypy ✅（4 文件） |
| daemon | F5 | codex-app-server-driver 23 passed（含 2 新回归）；tsc ✅ |
| frontend | F6/F7 | workspace-config-card 18 / runtime-session-dialog+interactive-session-panel 50（全零回归）；tsc ✅ |

> 第四批无 alembic migration（全代码层修复），migration 链仍单头 `202607251000`。
> 本批最高价值：F1（gate 死循环防护生产失效，一行 merge + e2e 闭环）+ F5（codex 主 agent 会话永久卡死）。

---

## 8. 🟢 第五批（2026-07-25，用户"后续批次"指示）

> 第四批识别的 HIGH/MED 中，本批做可安全代码层修复的 file 存储一致性 + workspace
> soft_delete 防烧 token + 第四批遗留注释；需 migration / 跨文件 / 逐表设计的项 DEFER。

### Wave G — file 存储一致性 + workspace soft_delete 防烧 token ✅ 零回归

| ID | 文件:行 | 问题 | 修法 |
|---|---|---|---|
| G1 | `file/service.py:80,122` | upload_file MinIO put 先于 DB commit 无补偿 → commit 失败留孤儿对象；soft_delete 仅置 deleted_at 不删存储本体（注释称"后续清理流程"但全仓不存在）→ MinIO 孤儿单调增长（账单泄漏） | upload commit 失败 best-effort 补偿 `delete_object`；soft_delete 同步删对象本体（先 commit DB 后删 MinIO，宁可孤儿不可损坏） |
| G2 | `workspace/service.py:456` | soft_delete 仅置 deleted_at/status，**不取消该 workspace 下在跑 AgentRun** → daemon 继续 burn token / 向已删实体回写 | 复用 P0-2 链路：查 active runs（经 AgentRunWorkspace JOIN）逐个 `cancel_lease`（含 pending 兜底），best-effort 单 run 失败不中断 |
| G3 | `frontend/lib/daemon.ts:398` | 第四批删 streamQuickChat 后注释仍提及（纯注释瑕疵） | 清理注释 |

### DEFER 复评（修正 a4f18dab 判断 + 大工程留专项）

| 项 | 复评结论 |
|---|---|
| **PPM 父表删除级联** | **修正 a4f18dab 的"生产 PG FK 500"判断**：`delete_module` 注释 :437 明示 PPM FK 为**软关联无约束**（migration 202607220900），删父行**不会 FK 违约 500**，而是留孤儿子行（**MED 数据质量**，非 HIGH 崩溃）。4 父表（plan/problem/task/project）子表需逐表确认 + 显式级联，留 PPM 数据一致性专项 |
| PPM 全域乐观锁 | DEFER：需 version 列 migration（多表）+ update WHERE version + 前端并发 409 协调，大工程走专项 brainstorm（复用 `agent/coordinator.update_with_optimistic_lock` 范式） |
| workspace create 单事务 | DEFER：helper（_ensure_empty_spec_workspace / upsert_my_binding）内部 commit 跨文件，改 flush + commit 上提涉及其它入口，风险中，留专项 |
| import_commit :1250 边缘 commit | DEFER：file_urls 回写 commit 失败留"File 行存在但 file_urls 不引用"边缘场景；当前 best-effort 附件设计（D-009/R-05）可接受，且 G1 upload 补偿已覆盖单图 upload |
| workspace soft_delete 子表清理 | DEFER：软删后子表（member binding / lease / AgentRunWorkspace）残留是数据冗余不影响功能，G2 cancel run 是防烧 token 核心 |

### 验证（第五批）

| 端 | 改动 | 改后 |
|---|---|---|
| backend | G1/G2 | file 9 passed / workspace 183 passed（全零回归）；ruff ✅ / mypy ✅ |
| frontend | G3 | daemon.ts 注释（tsc 不影响） |

> 第五批无 alembic migration，链仍单头 `202607251000`。
> 关键修正：核实 PPM FK 为软关联无约束，a4f18dab 的"删父表 FK 500"判断不准（实为 MED 孤儿数据）。
