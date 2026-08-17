
## ql-20260812-007-d086 | 2026-08-12 20:43:59 | 修 daemon preflight Win execSync timeout 杀不掉 npm 孙进程致启动卡死
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/preflight.ts, sillyhub-daemon/tests/preflight.test.ts
需求：修 daemon preflight Win execSync timeout 杀不掉 npm 孙进程致启动卡死。
根因：runCmd/runCmdBoolean execSync+timeout，Win timeout 只杀 npm.cmd 不杀孙 node.exe，npm view 国内慢时卡死 daemon。
方案：runWithTreeKill（spawn+超时 taskkill /T 杀树），runCmd 等改 async，测试 mock execSync→spawn。
结果：17 测试绿 typecheck 0 错，daemon 启动心跳持续 CPU 0.67s（修复前 88s 空转）。git add preflight.ts/test.ts/sillyhub-daemon.md。

## ql-20260812-008-c860 | 2026-08-12 21:36:52 | 测试质量审查6维度后修P0安全/正确性项
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/worktree/tests/test_router.py（补7个安全分支测试(revoked/expired 503、cross-user extend 403、已释放 409、no repo_url 503、文件系统失败 rollback)）
- backend/app/modules/worktree/service.py（修_assert_identity_usable tz不健壮(SQLite naive vs aware)）
- backend/app/modules/daemon/tests/test_allowed_roots_policy_push.py（patch _derive_policy_version注入递增version,消除wall-clock flaky）
- backend/tests/e2e/test_three_member_collaboration.py（SC-5 spy resolve_runtime_for_writeback断言member-binding路径）
- backend/app/modules/change_writer/tests/test_proxy.py（顺补 current_stage draft→brainstorm）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（变更索引 ql-008）
需求：测试质量审查6维度后修P0安全/正确性项。
根因：①worktree service.py 7个安全分支(revoked/expired identity、cross-user extend、已释放lease、no repo_url、文件系统失败回滚)零覆盖,删校验全量仍绿;②e2e SC-5 except pass 空断言,member-binding核心路径没验证;③allowed_roots time.sleep(0.005)推wall-clock做单调version断言,Windows时钟粒度下flaky。
方案：①worktree test_router照cross_user_release模板补7测试+修service.py:241 tz不健壮(SQLite naive datetime vs now(UTC) aware TypeError);②e2e spy resolve_runtime_for_writeback断言member-binding路径被走;③patch _derive_policy_version注入可控递增version源;④顺补test_proxy current_stage draft→brainstorm。
结果：worktree 15 passed(原8+新7)、allowed_roots 3次稳定passed、e2e SC-5 passed、test_proxy passed;全量3867 passed,P0五项零回归;另1 failed(test_provider_switch xdist偶发flaky单独过)+1 error(test_bootstrap teardown并发conftest fixture)均非本次引入。

## ql-20260812-009-976d | 2026-08-12 21:42:49 | 测试审查 P1 批隔离/flaky 加固（后台 task 残留 / redis 跨 worker / webhook 4xx / team-progress 真 timer 等 6 项）
状态：已完成
关联变更：（无）
文件：
- backend/conftest.py（P1-1 redis 按 worker 分库：PYTEST_XDIST_WORKER gw0..gw15→db0..db15（%16），非 xdist 保持 db15 / P1-2 新增 `_isolate_background_tasks` autouse fixture：每测试 clear + teardown cancel/await 四处 fire-and-forget task 强引用集（bootstrap._BACKGROUND_BOOTSTRAP_TASKS / AgentService / ExecutionCoordinatorService / RunSyncService._background_tasks），teardown 用 isinstance(asyncio.Task) 守卫跳过 spec_workspace 测试注入的 _FakeTask（无 cancel）——即 ql-008 提到的 test_bootstrap teardown error 的根治 / P1-5 spec_data_root 改会话级独立子目录（按 worker/pid）+ atexit rmtree / P1-6 新增 `_reset_lazy_singletons` autouse 每测试置 core.db._engine、storage.factory._backend 为 None）
- backend/app/modules/mcp_gateway/tests/test_webhook.py（P1-3 补 test_deliver_4xx_abandoned_no_retry：404 响应只投递 1 次不重试，防 service.py:617 放弃分支被误改成走重试触发 5×[1+4+16+64]s≈85s 退避占 worker 的回归）
- frontend/src/components/__tests__/team-progress.test.tsx（P1-4「活跃态自动轮询」从真 timer 等 50ms×3 改 vi.useFakeTimers({toFake:[setTimeout,setInterval,...]})+advanceTimersByTimeAsync，对齐 workspace-config-card 模式，消撞 1s 兜底 flaky）
- frontend/vitest.config.ts（加 clearMocks:true；restoreMocks 试用破 21 个依赖 describe/beforeAll 级 spy 持久化的既有测试已撤，留注释说明采用需独立重构下沉 spy）
需求：修复上一轮 6 维度测试审查的 P1 批 6 项隔离与 flaky 隐患（纯测试基建，零生产逻辑改动）。
根因：测试基建债——①4 处 fire-and-forget 后台 task 的强引用 set 跨测试残留、绑定旧 event loop（与既有 _isolate_permission_timers 同款坑，原只补了 permission_timers）；②WebhookDispatcher 4xx 放弃分支零覆盖；③team-progress 轮询测试用真 timer 撞 CI event loop 抖动；④vitest 无 clearMocks 致文件内 mock 调用计数堆叠；⑤xdist 多 worker 共享 redis db15，各 worker function 级 FLUSHDB 互清他者 login:fail/captcha；⑥spec_data_root 指 temp 根从不清理 + 懒加载 _engine/_backend 单例无 reset（当前潜在）。依据：审查 high/medium 项 + 既有 _isolate_permission_timers 范本。
方案：conftest 四处加固（P1-1/P1-2/P1-5/P1-6 见文件括注）+ webhook 补 4xx 放弃不重试用例（P1-3）+ team-progress 轮询改 fake timer（P1-4）+ vitest 加 clearMocks（restoreMocks 破 21 测试已撤）。P1-2 一并覆盖审查漏报的同模式 ExecutionCoordinatorService/RunSyncService 两处。模块文档 backend.md/frontend.md 变更索引补 ql-009。
结果：后端全量 `pytest -n auto` 3868 passed/0 fail/5 skipped/5 xfail；前端全量 vitest 144 文件 1402 passed/0 fail；ruff 干净 + mypy 605 文件 no issues，前端改动文件 eslint 干净（既有 warning 在未触碰文件）；webhook 10 + team-progress 12 针对性全过。修复途中实测踩中 2 个真问题并修：conftest 初版 .values() 误用（set 非 dict）+ teardown 无脑 cancel 撞 _FakeTask，均加守卫修复。6 文件已 git add 暂存待提交。

## ql-20260813-001-f9af | 2026-08-13 08:42:37 | 测试质量审查 P2 重构脆裂项评估并修值得改的
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/permission_service.py（加公共 has_pending(request_id)）
- backend/app/modules/daemon/tests/test_ws_hub_permission.py（5处 _timers 私有改 has_pending+去冗余 cancel）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（ql-001 索引含 P2 不改理由）
需求：测试质量审查 P2 重构脆裂项评估并修值得改的。
根因：test_ws_hub_permission 断言私有 perm._timers（5处），重构 _permission_timers 数据结构时测试脆裂。
方案：permission_service 加公共 has_pending(request_id)，test_ws_hub_permission 断言改用 has_pending + 去冗余手工 task cancel（依赖 conftest _isolate_permission_timers teardown）。
结果：test_ws_hub_permission 12 passed，全量 3868 passed 0 failed 0 error。P2 其余项评估不改（已附理由：vitest clearMocks 已由 ql-009 完成、DI 接线 isinstance 是类型契约、ws_rpc 边缘case 无公共API、seam/已有公共覆盖、guard 契约合理、password_hasher 良性）。

## ql-20260813-002-cf43 | 2026-08-13 09:20:44 | 修复全量 pytest 9 failed+9 error
状态：已完成
关联变更：（无）
文件：
- backend/pyproject.toml（addopts 加 -o dist=loadscope(xdist 按模块分组消跨文件污染)）
- backend/app/modules/task/tests/test_router.py（workspace_with_tasks fixture 加 reparse retry(治 Windows 文件锁间歇)）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（ql-002 索引）
需求：修复全量 pytest 9 failed+9 error。
根因：xdist 默认 load 分发(按测试 round-robin)致跨文件状态污染,task/change/runtime/workspace 的 spec reparse 间歇 created=0 → fixture next() StopIteration/文件列表空;残留 task 间歇=Windows Defender 瞬时锁 copytree 新文件致首扫 parsed=0。
方案：①pyproject addopts 加 -o dist=loadscope(按模块/类分组,消除跨模块污染,9→0~2);②task workspace_with_tasks fixture 加一次 reparse retry(锁瞬时重扫恢复,治残留 0~2)。
结果：连续两次全量 3868 passed 0 failed 0 error 稳定,无 -n 不报错。

## ql-20260813-003-f61b | 2026-08-13 11:07:12 | 修复 daemon /daemon/install.ps1 分发给 PowerShell irm 管道 iex 时中文乱码
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/dist_router.py（install.ps1 media_type 加 charset=utf-8 + 注释说明 starlette 非 text/* 不自动补 + docstring 同步）
- backend/tests/test_daemon_dist.py（test_install_ps1 断言增强精确等于 application/x-powershell charset=utf-8 回归锚点）
- backend/openapi.json（gen:types 同步 install.ps1 description）
- frontend/src/lib/api-types.ts（gen:types 同步注释）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（加 install.ps1 charset 契约约定 + 变更索引 ql-20260813-003-f61b）
需求：修复 daemon /daemon/install.ps1 分发给 PowerShell irm 管道 iex 时中文乱码。
根因：dist_router.py 的 install.ps1 端点 Response media_type=application/x-powershell 非 text/* ，starlette 不自动补 charset，PowerShell irm 按 latin1 解码 UTF-8 body 致脚本中文执行前损坏成 mojibake；对照 install.sh（text/x-shellscript 自动补 charset）不乱码，install.ps1 源码第36-38行已设控制台UTF8 反证问题在响应读取层非显示层。
方案：media_type 改 application/x-powershell 显式加 charset=utf-8 + docstring 同步 + test_daemon_dist 精确断言回归锚点 + gen:types 同步 openapi/api-types + daemon 模块文档加 charset 契约约定与变更索引。
结果：test_daemon_dist 9 passed（含新精确断言）+ daemon 模块全量 803 passed + gen:types diff 干净仅 install.ps1 description 变化。

## ql-20260813-004-a004 | 2026-08-13 14:02:17 | 修 daemon 同步到服务器（kind=spec-sync 回灌）HTTP 500 崩溃
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/spec-sync.ts（buildTarHeader 支持 >100 字节 name(GNU LongLink)；packSpecDir 默认排除 runtime(无点)+worktrees，保留 .runtime）
- sillyhub-daemon/tests/spec-sync.test.ts（新增长名 round-trip/排除 runtime/排除 worktrees 3 用例）
- backend/app/modules/spec_workspace/service.py（_write_spec_root read_bytes 跳过缺失成员纵深防御）
- backend/tests/modules/spec_workspace/test_apply_sync.py（新增 LongLink 长名/缺失成员跳过 2 用例）
- .sillyspec/docs/sillyhub-daemon/modules/spec-sync.md（同步 packSpecDir 排除行为 + LongLink 契约）
- .sillyspec/docs/backend/modules/spec_workspace.md（补 read_bytes 纵深防御备注）
需求：修 daemon 同步到服务器（kind=spec-sync 回灌）HTTP 500 崩溃。
根因：postSpecSync 打包 runtime/(无点, scan-runs 超长文件名) 触发手工 ustar 100 字节 name 截断 → 后端 _write_spec_root read_bytes FileNotFoundError → 500。
方案：B 修 buildTarHeader 支持 >100 字节 name（GNU LongLink typeflag='L'）+ W packSpecDir 默认排除 runtime(无点)+worktrees(任意深度) 保留 .runtime(有点, D-003 守护) + C 后端 read_bytes 跳过缺失成员纵深防御。
结果：daemon spec-sync.test 11 passed + tsc 通过；backend test_apply_sync 7 passed + ruff 通过；模块文档已同步。

## ql-20260813-005-5f20 | 2026-08-13 14:08:14 | 修复 2026-08-13-change-center-rework verify-result gap②——pending_review_only 分页精度
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/service.py（list_ 加 pending_review_only 参数：先 _resolve_pending_change_keys 批量取 latest_progress 经 _map 算 pending 集合 → SQL WHERE change_key IN 分页，total=全局真实 N；新增 _resolve_pending_change_keys 方法）
- backend/app/modules/change/router.py（透传 pending_review_only 到 service.list_，删 router 层 enrich 后 Python filter）
- backend/app/modules/change/tests/test_router.py（gap② 回归锚点：page_size=1 pending=2 时 total=2 非本页 1 + 分页 page1/2 偏移正确）
需求：修复 2026-08-13-change-center-rework verify-result gap②——pending_review_only 分页精度。
根因：pending_review 是计算字段(latest_progress+_map)非 SQL 列,旧实现 router enrich 后 Python filter + total=本页过滤后 len,待处理>page_size 时 N 偏低、分页偏移。
方案：方案B 集合IN(用户确认,跨库稳)——service.list_ 加 pending_review_only,先 _resolve_pending_change_keys(批量取 latest_progress 经 _map 算 pending 非空集合)再 SQL WHERE change_key IN 分页,total=IN 后计数=全局真实 N;router 透传删 filter。
结果：test_router 18 passed(+1 gap② 测试:page_size=1 pending=2 时 total=2 非本页1+分页 page1/2 正确)+全 change 242 passed(1 预存债 test_dispatch)+ruff format/check 全过+mypy 0。文件:backend/app/modules/change/service.py(+_resolve_pending_change_keys+list_ 加参数/WHERE IN)+router.py(透传删 filter)+tests/test_router.py(全局 N 分页回归锚点)。

## ql-20260813-006-38fd | 2026-08-13 20:16:42 | d004-no-taskkill-source-gate 门禁过严
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/tests/d004-no-taskkill-source-gate.test.ts（加 classifyTaskkill：/PID 放行 / /IM+无flag 违规，Hit 加 kind，两条断言改用 /IM 违规判定）
- .sillyspec/local.yaml（移除 daemon 模块测试 d004 exclude + 注释说明 ql-20260813-006 已修门禁恢复纳入）
需求：d004-no-taskkill-source-gate 门禁过严，把 PID-targeted taskkill 也判违规，preflight.runWithTreeKill（修 Windows preflight 卡死）被误拦。
根因：D-004 真禁令是 /IM 通杀（按进程名匹配会误杀当前会话），但门禁实现成「可执行代码 0 次 taskkill」，没区分 /PID 定点 vs /IM 通杀。
方案：改 d004 测试分类逻辑——非注释命中按 /PID（定点，放行）/IM（通杀，违规）/无 flag（违规）分类；preflight.ts:366 的 spawn('taskkill', ['/PID',pid,'/T','/F']) 放行；移除 local.yaml daemon 模块测试的 d004 排除（恢复纳入主批）。
结果：d004 测试 3 passed（分桶 注释=8 /PID 定点=1 违规=0），tsc 0 error，daemon 主批（含 d004 恢复）135 文件 2266 passed 0 failed。

## ql-20260813-007-5fb2 | 2026-08-13 21:11:34 | 工作区配置页「同步到服务器」恒失败
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/spec-sync.ts（packSpecDir 默认排除 .runtime 整树：excludeTop.add('.runtime') 无条件 + docstring 改）
- backend/app/modules/spec_workspace/service.py（_write_spec_root 加 .runtime 任一段跳过 continue + 两处 decode 后 .replace('\x00','') NUL strip 兜底）
- backend/app/modules/spec_workspace/tests/test_bundle_sync.py（test_sync_receives→test_sync_skips：.runtime/sillyspec.db 不落盘断言）
- backend/tests/modules/spec_workspace/test_apply_sync.py（:102/:135 .runtime 改跳过断言 + 新增 test_apply_sync_skips_runtime_db_with_nul_bytes NUL 回归）
- sillyhub-daemon/tests/spec-transport-tar-sync/spec-sync.test.ts（:191 断言反转 .runtime/sillyspec.db 不在 tar）
- 注：sillyhub-daemon/tests/spec-sync.test.ts 的 ql-007 断言与并发 ql-008(mtime) 测试在同一 hunk 耦合，本提交不含该文件，待 ql-008 落地后补 ql-007 断言
需求：工作区配置页「同步到服务器」恒失败，前端报「同步失败。同步到服务器失败」。
根因：后端 docker logs 实证——daemon 把本地 spec 缓存整树打包回灌，后端 apply_sync 解包后把 tar 成员无差别写进 scan_documents.content（PG 文本列）；其中 .runtime/sillyspec.db（SQLite 二进制）含 NUL 字节 0x00，asyncpg 抛 CharacterNotInRepertoireError → 整批 INSERT 44 行回滚 → HTTP 500 → daemon 标 failed → 前端显示失败。首次同步必撞（增量走 apply_ops 不碰 scan_documents，全量 apply_sync 才写表；首同步无 manifests 缓存走全量）。
方案：两层修复，.runtime 整树双向对称排除（用户决策 sillyspec.db 不再回灌）。1) daemon spec-sync.ts packSpecDir：.runtime(有点)无条件纳入默认 excludeTop（与 runtime 无点/worktrees 并列），opts.excludeRuntime 降级为冗余兼容开关；push 路径 3 处调用自动生效，import 路径本就传 excludeRuntime:true 行为不变。2) 后端 service.py _write_spec_root per-file merge：rel_path 任一段为 .runtime 则 continue 不落盘不入表（对齐 build_bundle pull 方向任意深度排除）；两处 content.decode 后追加 .replace('\x00','') 兜底防其它二进制漏入炸整批。
结果：后端 spec_workspace 全套 73 passed 1 skipped（skip=Windows symlink 无关）含新增 NUL 回归 test_apply_sync_skips_runtime_db_with_nul_bytes passed；daemon spec-sync 两契约文件 37/37 passed。**端到端实测通过**：重建 backend 镜像（不传 COMMIT_SHA 避缓存坑）+ pnpm build 重编 daemon dist（全局 node_modules 是 symlink 指本地 dist，无需 bundle/reinstall）+ 重启 daemon，用真实 sillyspec.db（122880 字节/56238 个 NUL）喂 apply_sync 不再 500、.runtime 被跳过不入表、spec 文档正常入库。**提交 88899f9c**（5 文件 pathspec 限定，pre-commit ruff format/check Passed；spec-sync.test.ts 因与并发 ql-008 mtime 测试同 hunk 耦合未提交，留工作区待 ql-008 落地后补）。

## ql-20260813-008-9aec | 2026-08-13 21:16:06 | 修复变更列表「更新时间都一样」——mtime 全链路打通（daemon 打包保留真实 mtime + 后端 reparse 取较大值填 updated_at）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/parser.py（ParsedChange 加 last_modified_at + _parse_change rglob 所有文件 mtime max）
- backend/app/modules/change/service.py（_apply_parsed 取较大值含 SQLite naive→UTC 归一化 / _build_change 显式传 updated_at=last_modified_at or now）
- backend/app/modules/spec_workspace/schema.py（FileOp 加 mtime: float | None）
- backend/app/modules/spec_workspace/service.py（新增 _apply_file_mtime os.utime + apply_ops add/update/rename 三处调用）
- sillyhub-daemon/src/spec-sync.ts（buildTarHeader 保留真实 mtime / packSpecDir 传 mtimeMs / computeIncrementalOps op 带 mtime）
- sillyhub-daemon/src/hub-client.ts（FileOp 加 mtime?: number | null）
- backend/app/modules/change/tests/test_reparse_guard.py（修 mock + 5 新单测）
- backend/app/modules/spec_workspace/tests/test_sync_incremental.py（新增 2 端到端测试）
- sillyhub-daemon/tests/spec-sync.test.ts（含并发 ql-009 .runtime 排除配套 + 本 ql mtime 单测）
- backend/openapi.json + frontend/src/lib/api-types.ts + sillyhub-daemon/src/api-types.ts（regen FileOp mtime）

### 根因 + 改了什么
变更中心列表「更新时间」列全显示同一时刻的根因有两层：
- 表层：`changes.updated_at` 在 reparse 时被设成「写入数据库的时刻」（`default_factory=now`），43 行挤 50ms 内；update 分支 `_apply_parsed` 完全不碰 updated_at。
- 深层（端到端实证揪出）：daemon `buildTarHeader`（spec-sync.ts）**刻意把 tar member mtime 固定写 0**（注释「spec 同步不需要精确时间戳」）→ 镜像文件 mtime 全是 1970 → 即使后端用 mtime 填 updated_at 也全失效。增量 FileOp 也不带 mtime。

改动（6 文件实现 + 派生类型 + 测试）：
- `backend/.../change/parser.py`：`ParsedChange` 加 `last_modified_at`（变更目录 rglob 所有非隐藏文件 mtime max，含 tasks/*.md/decisions.md 等非标准文件）；`_parse_change` 末尾算填。
- `backend/.../change/service.py`：`_apply_parsed`（update 分支）取较大值 `updated_at = max(现值, last_modified_at)` 不倒退（**含 SQLite naive datetime → UTC 归一化**，真实 DB 抓的坑）；`_build_change`（create）显式 `last_modified_at or now`（空目录 fallback，避免 None 绕过 default_factory 违反 NOT NULL）。
- `sillyhub-daemon/src/spec-sync.ts`：`buildTarHeader` 加 mtime 参数写真实八进制秒（不再固定 0）；`packSpecDir` 传 `e.mtimeMs`；`computeIncrementalOps` 的 add/update/rename op 带 mtime。
- `sillyhub-daemon/src/hub-client.ts`：`FileOp` 加可选 `mtime?: number | null`。
- `backend/.../spec_workspace/schema.py`：`FileOp` 加 `mtime: float | None`。
- `backend/.../spec_workspace/service.py`：新增 `_apply_file_mtime`（os.utime 设 op.mtime）；`apply_ops` 的 add/update/rename 三处落盘点调用。旧 tar 路径 `_write_spec_root` 走 tarfile.extractall（自动用 member mtime，daemon 改后即真实）无需动。
- 派生：`backend/openapi.json` + `frontend/src/lib/api-types.ts` + `sillyhub-daemon/src/api-types.ts` regen（FileOp 含 mtime）。

### 跑了哪些测试
- 后端 `test_reparse_guard.py` 8 passed（5 新：取较大值/不倒退/空目录守卫/proxy 行/SQLite naive datetime 边界）。
- 后端 `test_sync_incremental.py` 新增 2 passed（apply_ops 带 mtime 落盘 + 全链路 add→reparse→change.updated_at）。
- 后端 change + spec_workspace 全量 313 passed（2 个 test_dispatch 失败经 stash 验证为 **pre-existing ql-007 测试债，与本改动无关**：`'str' object has no attribute 'hex'` 是他者会话改的脏文件）。
- daemon spec-sync.test.ts 12 passed（含新 mtime 单测）；typecheck 0 错。
- 前端 tsc --noEmit 0 错。

### 端到端实证
容器内验证全链路：add op 带 mtime=固定历史秒 → apply_ops 落盘镜像文件 mtime 真实（非 now）→ reparse → `change.updated_at` 取该 mtime（diff=0）。闭环验证修复有效。注：生产 76baff71 workspace 的 updated_at 需重新部署 daemon（build+重启）+ 重新同步 + reparse 才生效，本次未动运行中 daemon 进程。

### 风险/遗留
- `task-09-spec-pull-push.test.ts` 的 `_packSpecDir 含 .runtime` 失败 = pre-existing ql-007 测试债（packSpecDir 代码已排除 .runtime 但该测试仍断言「含」，clean 文件无工作区改动），不在本 quick 范围。
- 生产环境 daemon 需重新 build dist + 重启才让 mtime 修复生效（运行中是旧二进制）。
- spec-sync.test.ts 含并发 ql-009 的 .runtime 排除配套测试（88899f9c 留工作区待 ql-008 补），与本 mtime 改动同文件不冲突，一并提交。

## ql-20260813-011-61d0 | 2026-08-13 22:07:42 | 变更中心推进阶段加源阶段完成度前置校验（堵"没干活就推进"）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/service.py（ChangeService 加 `_check_source_stage_completion` staticmethod：draft/None 首次放行 / stages[source] 缺失 fail-closed 拒绝 / status==completed 且 steps.pending 空放行 / 否则拒绝带 details.reason；插 transition 686 行 draft 特判前——get 之后用原始 current_stage；复用 InvalidTransition errors.py:216 HTTP 422 带 message+details。complete_stage 不动）
- backend/app/modules/change/tests/test_dispatch.py（加 `_completed_stages` + `_mark_source_completed`（str→UUID）helper；`_create_test_change` 加 stages 形参默认给主线阶段补完成块；3 个 HTTP 测试 transition 前补源阶段完成块；`test_transition_invalid_stage_returns_error` 补完成块让语义回归 TRANSITIONS 拒绝；新增 TestSourceStageCompletionGate 4 用例）
- backend/app/modules/change/tests/test_stages_persistence.py（`_seed` 补完成块，保留 team_mode 测深拷贝回归）
需求：变更中心点"推进到下一阶段"按钮时，change 直接进入下一阶段哪怕实际没干活。给 transition 加源阶段完成度前置校验，强制源阶段用 CLI 客观步骤进度证明"干完"才能推进。
根因：transition（service.py:674）只校验 TRANSITIONS 白名单 + 角色权限，不校验源阶段是否真完成。平台后端其实已持有 CLI 细粒度步骤进度（single 模式 agent 跑完后经 _sync_stage_status_daemon_client 写入 change.stages JSON，dispatch.py:1767），但 transition 推进时根本没读它。
方案：ChangeService 加 `_check_source_stage_completion(change)`，判据=源阶段 stages[source].status==completed 且 steps.pending 空（决策 b）；stages 缺源阶段数据 fail-closed 拒绝；draft/None 首次启动放行。插在 transition 的 get 之后、draft 特判之前（必须用原始 current_stage 判首次）。team 路径 complete_stage 不经 transition（daemon/run_sync:1762 直调），不受影响——team mission 收敛本就是强证据。verify 不额外卡 gate（沿用形态A软调用语义）。
结果：service.py + 2 测试文件共 3 文件；change 全测 + mcp_gateway test_change_stage_tools + daemon test_advance_team_stage/test_team_change_lifecycle/test_run_sync_gate_decision_task 共 293 passed/0 fail/2 skip；team 路径零回归（证 complete_stage 不受影响）；新增 TestSourceStageCompletionGate 4 用例（首次放行 / 未完成拒绝断 details.reason=stage_not_completed+pending_count / 缺失拒绝 reason=missing_stage_block / 完成放行）；ruff format+check 全过。坑：①HTTP 测试 demo change 经 reparse 落库 stages 空，_create_test_change 默认给主线阶段补完成块覆盖 service 层测试，HTTP 层加 _mark_source_completed helper（change_id 从 HTTP JSON 来是 str 须转 UUID）；②test_transition_invalid_stage_returns_error 语义被新校验先拦（补完成块让其精确测 TRANSITIONS 拒绝）；③quick 会话 guard 失效产生 009/010 冗余骨架条目（sessionId 并发冲突，已手动清理）。

## ql-20260814-001-c8b7 | 2026-08-14 01:19:35 | 修复 P0(ql-007)遗留红测试 task-09-spec-pull-push.test.ts:528
状态：已完成
关联变更：quick-fix-task09-runtime-test
文件：sillyhub-daemon/src/spec-sync.ts, sillyhub-daemon/tests/task-09-spec-pull-push.test.ts
需求：修复 P0(ql-007)遗留红测试 task-09-spec-pull-push.test.ts:528，它断言 packSpecDir 含 .runtime，但 P0 已改 packSpecDir 默认排除 .runtime，致主仓该测试恒红卡住 P1 verify。
根因：P0 提交时漏改 task-09-spec-pull-push.test.ts（只改了 spec-sync.test.ts/spec-transport 两个同款契约测试）；且 packSpecDir 只排顶层 .runtime 不排任意深度嵌套 sub/.runtime，测试构造 sub/.runtime 暴露此缺口。
方案：测试断言反转（.runtime 整树不在 push tar 含 sub/.runtime）；packSpecDir 把 .runtime 加 pruneNames 任意深度 basename 排除（对齐 backend build_bundle any(part==.runtime)）。
结果：task-09 16 passed + spec-sync 全套 63 passed（P0 测试零回归）。文件：sillyhub-daemon/src/spec-sync.ts(packSpecDir pruneNames 加 .runtime 任意深度)+sillyhub-daemon/tests/task-09-spec-pull-push.test.ts(:528 断言反转)。

## ql-20260814-002-72c5 | 2026-08-14 09:48:41 | 修 reparse 500——ql-008 mtime 循环 stat 性能回归（rglob 双 stat → os.scandir 单遍）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/parser.py（新增 _compute_last_modified 静态方法：单次 os.scandir 显式 stack 迭代遍历取目录树非隐藏文件 mtime max；替换 _parse_change 末尾 ql-008 的 rglob+is_file+stat 块）
- backend/app/modules/change/tests/test_parser.py（+2 单测：last_modified_at 取跨目录非标准文件 mtime max / 隐藏文件跳过+空目录 None 守卫）
需求：变更中心点「重新解析」按钮返回 500（前端代理 socket hang up），后端实际跑 33s 超代理超时。
根因：ql-20260813-008 在 parser.py 用 `rglob("*")`+`is_file()`+`stat()` 对每文件产生 2 次 stat 系统调用；该 workspace spec_root 是 Windows-Docker bind mount（`/run/desktop/mnt/host/c/data/spec-workspaces`），单次 stat≈1.45ms，196 变更 ~3000 文件堆到 12s（cProfile 实测 posix.stat 11593 次/16.9s），解析阶段 25s、加 DB 写入总 33s，超 Next.js 14.2.5 代理 ~30s 默认超时 → 前端 ECONNRESET/500（backend 那条 200 是代理放弃后 FastAPI 跑完的"幽灵 200"）。
方案：parser.py 新增 `_compute_last_modified`——单次 `os.scandir` 迭代遍历（显式 stack 不递归，规避深目录 recursion limit），复用 DirEntry 缓存 stat（每文件仅 1 次系统调用）；`follow_symlinks=False` 比原 rglob 更严格（不跨 symlink，变更目录内无 symlink 行为等价）。mtime-max 语义 / 空目录 None / 含子目录及非标准文件（tasks/*.md、decisions.md）均不变。不删 ql-008 功能（mtime→updated_at 已上线且用户要），只优化实现。
结果：test_parser+test_reparse_guard 27 passed（含 2 新增 mtime 单测）ruff check/format 干净；容器实测 parse_workspace 25s→14.3s、端到端 reparse 33s→13.7s（经前端代理 3001 返回 200），500 消失，ql-008 功能未回归（196 变更 updated_at 正常）。已 docker cp 到运行中 backend 容器 + restart 使修复即时生效。

## ql-20260814-003-e649 | 2026-08-14 13:17:33 | 清理 docs/architecture-4a.md §8 注释类与迁移登记类漂移点
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/mcp_gateway/server.py（三处过时 tool 数量注释 8/5 改 12 以 tools.py 为准）
- backend/app/modules/agent/adapters/__init__.py（空文件补 docstring adapters 故意空执行走 daemon lease/subprocess）
- backend/migrations/env.py（补 8 类 model import 登记 admin agent.profile daemon.audit file mcp_gateway ppm.kanban skills workspace.member_runtimes）
需求：清理 docs/architecture-4a.md §8 注释类与迁移登记类漂移点。
根因：部分代码注释过时（MCP tool 数量 8/5 实际 12、adapters 目录无说明），migrations/env.py 漏登记 8 类较新模块 model 致 autogenerate 漏判。
方案：改 mcp_gateway/server.py 三处 tool 数量注释为 12，adapters/__init__.py 补 docstring，env.py 补 8 类 model import 并 ruff isort 排序。
结果：ruff check+format clean，8 import 加载 OK，容器内 alembic check 无 add_table（满屏 diff 为预存类型噪音与本次无关），pytest mcp_gateway+agent 605 passed 2 deselected；#9 execution.py 注释已自行修正跳过，#7 死代码删除留 quick 外 git 单独做。

## ql-20260814-004-fab6 | 2026-08-14 16:05:31 | 修复 test_router_transition 4 个预存债失败（TestTransitionResponseFormat 结构测试）
状态：已完成
关联变更：（无）
文件：
- backend/tests/modules/change/test_router_transition.py（4 个结构测试加门控 patch 放行（fixture 无 CLI 进度数据，门控由 test_dispatch.py 覆盖））
需求：修复 test_router_transition 4 个预存债失败（TestTransitionResponseFormat 结构测试）。
根因：fixture demo change reparse 后 stages JSON 空，_check_source_stage_completion 门控（service.py:1716）fail-closed 422 missing_stage_block，测试目标是 TransitionResponse 结构非门控，门控由 test_dispatch.py 单独覆盖，静态 fixture 无 CLI 进度数据。
方案：4 个测试加 patch.object(ChangeService, _check_source_stage_completion, MagicMock(return_value=None)) 放行门控专注结构验证，不碰生产逻辑。
结果：test_router_transition.py 5 passed（4 failed 全修）、change 模块 74 passed 无回归、ruff 过；全量 4 failed 债清零。

## ql-20260814-005-5e84 | 2026-08-14 22:52:22 | 修 bootstrap_admin_and_seed_rbac 查重缺陷（同 username 不同 email 的已有 admin 使 INSERT 撞 ux…
状态：已完成
关联变更：（无）
文件：backend/app/modules/auth/service.py, backend/tests/modules/auth/test_bootstrap_username_dedup.py
需求：修 bootstrap_admin_and_seed_rbac 查重缺陷（同 username 不同 email 的已有 admin 使 INSERT 撞 ux_users_username 唯一约束阻断启动）。
根因：service.py:442 仅按 email 查重，username 由 email 本地段派生，email 与历史 seed 不一致时漏判。
方案：查重条件改 email OR username 双键命中即复用，附 3 新单测（同 username 复用/同 email 复用/空库新建）。
结果：tests/modules/auth 全量 164 passed + 2 xfailed 零回归，ruff check+format 过。

## ql-20260814-006-84c0 | 2026-08-14 23:22:22 | 修 reparse 500——parser.py datetime.fromtimestamp 遇 Windows bind mount 瞬态脏 mtime（实…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/parser.py（_safe_mtime 防御转换+5 调用点替换）
- backend/tests/modules/change/test_parser_mtime.py（10 单测（脏值/边界/集成））
- .sillyspec/docs/backend/modules/change.md（注意事项补 ql-20260814-006）
需求：修 reparse 500——parser.py datetime.fromtimestamp 遇 Windows bind mount 瞬态脏 mtime（实测 year 30828）抛 ValueError 打断全量 reparse。
根因：Docker Desktop 文件共享层偶发返回垃圾 stat 时间戳，越界 datetime 转换单文件即放大为整个 reparse 500。
方案：新增 _safe_mtime 防御性转换（合法窗口外或转换异常一律回退 epoch 0），parser 内 5 处 st_mtime 转换点（含 _compute_last_modified）全部统一走它，附 10 个单测覆盖脏值/边界/集成。
结果：tests/modules/change 全量 84 passed（含 10 新增）零回归，ruff check+format 过。

## ql-20260814-007-df46 | 2026-08-14 23:40:17 | 会话页点他人会话全 404——列表跨成员可见（D-005@v1）但 logs/dialogs/stream 端点 owner-only
状态：已完成
关联变更：（无）
文件：
- frontend/src/components/workspace-session-section.tsx（useSession 当前用户过滤非本人会话）
- frontend/src/components/__tests__/workspace-session-section.test.tsx（新增 2 用例（他人剔除/缺 author 保留））
需求：会话页点他人会话全 404——列表跨成员可见（D-005@v1）但 logs/dialogs/stream 端点 owner-only，attach 他人会话必 404。
根因：权限设计错位，工作区会话列表展示所有人会话，而面板 attach 链路全部按属主校验，跨用户点击必然 404。
方案：前端 workspace-session-section.tsx 按 useSession 当前用户 id 过滤 author.user_id 非本人的列表项（author 缺失防御性保留），新增组件测试 2 用例。
结果：vitest 全量 1427 passed（含新增 2 例），tsc 0 错误，后端无改动不需 gen:types。

## ql-20260814-008-87d7 | 2026-08-14 23:51:37 | 创建/追加会话等 daemon ready 超时 30s
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/session/service.py（wait 默认+两处调用 timeout 30→8，注释同步）
- backend/app/modules/daemon/tests/test_provider_switch.py（minute+5 replace 越界改 timedelta（预存时间敏感债））
需求：创建/追加会话等 daemon ready 超时 30s，Next.js 代理 ~30s 先掐断，用户点新建会话必见 500（后端实际 201 成功）。
根因：SessionReadiness.wait 默认与 create_session/inject_session 两处调用都写死 timeout=30，正常 daemon /ready 上报 ~1s 内到，30s 纯属异常兜底但挡在代理超时之前。
方案：默认值与两处调用改 timeout=8，注释同步；超时语义不变（warn 后 fallback 发 SESSION_INJECT，兼容旧 daemon）。
结果：daemon 测试全量 707 passed，ruff format/check + mypy 干净；顺手修 test_provider_switch minute+5 越界预存债（改 timedelta）。

## ql-20260815-001-f305 | 2026-08-15 00:08:48 | 请求耗时超过 10s（slow.request 事件）时异步采样 pg_stat_activity（含 wait_event、锁等待链 query）写入日志
状态：已完成
关联变更：（无）
文件：
- backend/app/core/monitoring.py（第 4 件套：>=10s 慢请求异步采样 pg_stat_activity（NullPool 独立引擎 + 30s 节流 + 5s 超时 + 异常兜底，非 PG 跳过））
- backend/app/core/tests/test_monitoring.py（新建：9 用例覆盖触发阈值/节流/引擎/超时与失败兜底）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（变更索引追加 ql-20260815-001-f305）
需求：请求耗时超过 10s（slow.request 事件）时异步采样 pg_stat_activity（含 wait_event、锁等待链 query）写入日志，用于 DB 阻塞应急观测。
根因：容器重建会清掉现场日志，事后 docker exec psql 抓不到现行，需要在慢请求发生时点把 DB 快照落进持久化日志。
方案：monitoring.py 扩展第 4 件套——slow_request_middleware 在 duration>=10s 时 _fire_db_blocking_sample 后台采样（fire-and-forget 不阻塞响应）；采样用独立 NullPool 短连接引擎（不占共享池、不挂慢查询监听防递归），查非空闲会话快照 + pg_blocking_pids 锁等待链，打 db.stat_activity_sample 日志；带 30s 节流、5s 超时、全异常兜底不上抛；SQLite 测试环境自动跳过。
结果：新增 app/core/tests/test_monitoring.py 9 用例全过（触发阈值/节流/非 PG 跳过/超时兜底/连接失败兜底/引擎缓存/任务调度），core 相邻套件 80 passed 零回归，ruff check + format + mypy 全通过。

## ql-20260815-002-c14e | 2026-08-15 00:43:24 | 修复 sillyspec CLI 首推进度后变更中心看不到新建变更的缺陷
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/platform_sync/service.py（接受分支后 _ensure_change_row 建 ux_changes 占位行）
- backend/app/modules/change/service.py（reparse 删除环镜像滞后保护 + _progress_reported_active_keys）
- backend/app/modules/platform_sync/tests/test_router.py（首推建行/幂等/全局 token 不建 3 测试）
- backend/app/modules/change/tests/test_reparse_guard.py（占位保护/not-active 删/有文档删 3 测试）
需求：修复 sillyspec CLI 首推进度后变更中心看不到新建变更的缺陷。
根因：进度上行只写 platform_change_progress 表，而变更中心列表以 ux_changes 为主表 join 进度表；ux_changes 行只由镜像 reparse 创建，镜像 tar 同步滞后期间新变更在界面不可见（实测：sillyspec.db id=3281 推送成功但 platform_change_id=None、PG 无行、容器镜像无目录）。
方案：① platform_sync/service.py 接受分支后调 _ensure_change_row 建 ux_changes 占位行（workspace None 跳过/幂等/savepoint 撞键静默/best-effort）；② change/service.py reparse 全量删除环加镜像滞后保护——progress 最近上行仍报 active 且无文档的占位行不删，有文档行仍按磁盘权威删除。
结果：新增 5 测试全绿，回归 change+platform_sync 351 passed、spec_workspace 82 passed，ruff/mypy 通过，backend.md 模块文档已同步。

## ql-20260815-003-0488 | 2026-08-15 00:55:34 | 修复 run 终止后 session_dialog_requests 孤儿 pending 卡片无作废机制的缺陷
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/permission_service.py（cancel_pending_dialogs_for_run helper + 两级 pending 列表活跃 run 过滤 + respond 终态前置解析）
- backend/app/modules/agent/service.py（_cleanup_stale_runs_impl 作废 stale run 的 pending dialog）
- backend/app/modules/daemon/session/service.py（_converge_crashed_run 作废 crashed run 的 pending dialog）
- backend/app/modules/daemon/tests/test_session_permissions.py（helper/stale 清理/converge/读过滤/终态 respond 5 测试）
需求：修复 run 终止后 session_dialog_requests 孤儿 pending 卡片无作废机制的缺陷。
根因：cancelled 终态在 model.py L213-215 有生命周期声明但从未有写入方；后端重启（_cleanup_stale_runs_impl）/daemon 重启（_converge_crashed_run）收敛 run 时不动 dialog 行，卡片永久 pending，用户点卡经 respond_permission 的 current_run 前置检查报笼统 no active run（实测 run 17edafff failed + dialog bf1770d7 永久 pending）。
方案：① permission_service 模块级 cancel_pending_dialogs_for_run（pending→cancelled，不自带 commit）；② 两条恢复路径调用它；③ 读侧兜底——session/workspace 两级 pending 列表 join AgentRun 过滤非活跃 run；④ respond_permission 把终态 dialog 解析提前到 current_run 检查前，给明确 409/404。
结果：新增 5 测试全绿（26 passed），回归 daemon+agent 1328 passed，ruff/mypy 通过，backend.md 模块文档已同步。

## ql-20260815-004-5c7d | 2026-08-15 01:03:31 | 修复 CI Linux pytest 8 failed + 12 errors（reparse parsed=0 连锁）
状态：已完成
关联变更：（无）
文件：
- backend/tests/test_config.py（删 importlib.reload 改直取 Settings 类）
- backend/tests/modules/change/test_parser_mtime.py（脏 mtime 改 9.1e11 真实量级）
需求：修复 CI Linux pytest 8 failed + 12 errors（reparse parsed=0 连锁）。
根因：test_config.py 的 importlib.reload 分裂 Settings 世界致 spec_root 落错目录 + test_parser_mtime.py 脏值量级错误 Linux 断言落空。
方案：reload 改直取 Settings 类；脏值 9.8e10 改 9.1e11。
结果：WSL 全量 2 worker 零 dispatch/task 失败，Windows 861 passed，ruff 过。

## ql-20260815-005-ef98 | 2026-08-15 09:20:00 | 交互式会话报错文案人性化
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/daemon/session/service.py（5 处离线报错文案中文化+UUID 移 details）
需求：交互式会话报错文案人性化。
根因：session/service.py 5 处离线报错直接拼 UUID 英文串被前端透传。
方案：改中文短语+行动指引，UUID 移 details。
结果：daemon 843 passed，ruff 过。

## ql-20260815-006-d3ea | 2026-08-15 14:07:02 | 修复 3 个 CI 红用例的平台假设缺陷（test_dirty_mtime_falls_back 系列）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/change/tests/test_files_router.py（test_dirty_mtime_falls_back 前置断言改行为探测式 skip）
- backend/app/modules/scan_docs/tests/test_parser.py（两处 utime 后加钳制探测 skip）
需求：修复 3 个 CI 红用例的平台假设缺陷（test_dirty_mtime_falls_back 系列）。
根因：Linux ext4/macOS APFS 内核时间戳上限（公元2446/2554年）低于 datetime 越界点（year 9999），os.utime(9.1e11) 越界值被文件系统钳制为合法 mtime 落盘，前置断言 st_mtime==dirty 必挂且 _safe_mtime 护栏在该文件系统上物理不可触发；Windows/NTFS 能落所以本机绿。
方案：utime 后改为行为探测——stat 发现钳制则 pytest.skip（带钳制前后值+自解释原因），NTFS 照常真实跑；_safe_mtime 实现不动（tests/modules/change/test_parser_mtime.py 已有纯单元全平台覆盖）。
结果：本机 NTFS 3 用例真实跑 PASSED，两文件全量 28 passed；CI Linux 将转为 skip。

## ql-20260815-007-1a50 | 2026-08-15 14:42:24 | 消除 test_mcp_tools.py TestConvergeMission 因宿主环境变量泄漏打真实 LLM 的问题（单用例 18.7s + 烧 toke…
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/agent/tests/test_mcp_tools.py（TestConvergeMission 加类级 autouse GLM 隔离 fixture）
需求：消除 test_mcp_tools.py TestConvergeMission 因宿主环境变量泄漏打真实 LLM 的问题（单用例 18.7s + 烧 token）。
根因：converge endpoint 的 GLMConfig.from_env 读 ANTHROPIC_BASE_URL/AUTH_TOKEN，本机 shell（Claude Code 网关）设着这两项，_glm_merge 向真实网关发 HTTP；同仓邻居测试均有隔离唯此文件漏了。
方案：类级 autouse fixture _isolate_glm，monkeypatch 源 module delegation 的 GLMConfig 使 from_env 返 None（对齐 test_converge_mission_reentrant.py:107-112 既有做法），finalize 走确定性 concat 回退。
结果：宿主 ANTHROPIC_* 仍设着的情况下全文件 9 passed，call 最慢 <0.25s（修复前单用例 18.7s），零网络零 token。

## ql-20260815-008-3655 | 2026-08-15 15:34:27 | 收口 error-message-l10n verify Notes 的 4 项 f-string 漏网
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/tool_gateway/policy_router.py（3 处策略 404 中文化）
- backend/app/modules/agent/coordinator.py（8 处运行记录族文案中文化）
- backend/app/modules/worktree/git_runner.py（超时文案中文化）
- backend/app/core/ssrf.py（clone 链路 4 处 UnsafeRepoUrl 中文化）
需求：收口 error-message-l10n verify Notes 的 4 项 f-string 漏网。
根因：f-string 动态 message 守护测试静态不可判，4 文件残留英文直达前端。
方案：16 处中文化（policy_router 3+coordinator 8+git_runner 1+ssrf clone 4），变量进 details；assert_public_url 出网校验保留英文。
结果：700+57+101 passed 零回归，ruff+mypy 过。

## ql-20260815-009-45d1 | 2026-08-15 16:27:53 | 守护测试升级收窄 f-string 盲区
状态：已完成
关联变更：（无）
文件：
- backend/tests/core/test_error_message_l10n.py（_fstring_constant_text 常量段提取+CJK 判定+3 单测+ALLOWED_ENGLISH 增 unknown_agent_profile_fields）
- backend/app/modules/tool_gateway/policy_router.py（重名 409 f-string 中文化）
- backend/app/modules/daemon/router.py（lease/runtime 2 处 404 f-string 中文化）
需求：守护测试升级收窄 f-string 盲区。
根因：AST 扫描跳过 JoinedStr 致英文夹 f-string 常量段不设防。
方案：常量段拼接提取+CJK 断言+3 判定单测；新暴露 4 处=3 中文化+1 登记 ALLOWED_ENGLISH。
结果：守护 83 passed，daemon+tool_gateway 925 passed，ruff+mypy 过。

## ql-20260816-001-e6ca | 2026-08-16 06:43:07 | 修 step-visibility verify 两条 P2 遗留（详情页 404 空轮 + ChangeAgentRunLog steps 死代码）
状态：已完成
关联变更：（无）
文件：
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx（refetchInterval 加 404 停轮分支 + 删 currentStage 透传）
- frontend/src/components/changes/detail/change-agent-run-log.tsx（删死 prop 链与步骤条死分支（约 -180 行））
- frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx（makeProps 删 steps/currentStage）
- frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx（新增 404 停轮用例）
需求：修 step-visibility verify 两条 P2 遗留（详情页 404 空轮 + ChangeAgentRunLog steps 死代码）。
根因：isTerminalChange(null)=false 致 404 无限轮询；steps prop 恒 undefined 致整块渲染分支死代码。
方案：refetchInterval 加 error&&!data 停轮分支+新测试锚定（12s 窗口 queryFn 单次）；删 steps/currentStage/lastDispatchSummary 死 prop 链约 -180 行收敛简化视图。
结果：vitest 全量 1583 passed + tsc 0 + lint 本变更文件 0 警告。

## ql-20260816-002-402b | 2026-08-16 14:41:19 | daemon spec 同步链路修复——tar 上传 30s 假失败 + platform-managed 下手动同步推不出新 change
状态：已完成
关联变更：2026-08-16-change-owner-from-token
文件：
- sillyhub-daemon/src/hub-client.ts（SPEC_SYNC_TIMEOUT_MS=300s 独立超时，tar/增量共用）
- sillyhub-daemon/src/task-runner.ts（spec-sync 分支读 files[0].root_path 打包主仓 .sillyspec + 目录缺失降级 daemon 缓存）
- sillyhub-daemon/src/daemon.ts（claim 回执 files 映射保留 root_path 元信息）
- backend/app/modules/spec_workspace/router.py（sync_manual files[0] 透传 binding.root_path）
- backend/app/modules/spec_workspace/service.py（_BatchProgressWriter.flush 刷新 claimed_at 续期）
- backend/app/modules/daemon/change_write_router.py（progress 端点续期 + GC spec-sync 600s 长窗）
- backend/app/modules/daemon/tests/test_change_write_router.py（GC 长窗守护测试 test_gc_spec_sync_uses_longer_window）
- sillyhub-daemon/tests/task-13-spec-sync.test.ts（root_path 分流/降级/兼容三守护）
- 模块文档 4 份（daemon.md / spec_workspace.md / client.md / task-runner.md 变更记录）
需求：daemon spec 同步链路修复——tar 上传 30s 假失败 + platform-managed 下手动同步推不出新 change。
根因：postSpecSync/postSpecSyncIncremental 共用 DEFAULT_TIMEOUT_MS=30s 而全量 apply 实测 93s 必超时假失败；spec-sync 按钮打包 daemon 本地旧缓存（8/15 快照无新 change）；进一步暴露 claim GC 60s 中途回收长 apply。
方案：hub-client 两同步方法超时独立放宽 300s（SPEC_SYNC_TIMEOUT_MS + _request timeoutMs 参数）；backend sync_manual files[0] 透传 binding.root_path，daemon claim 映射保留 root_path，task-runner spec-sync 分支命中则打包主仓 .sillyspec（缺失降级缓存）；_BatchProgressWriter.flush 与 progress 端点刷新 claimed_at 续期 + GC spec-sync 600s 长窗。
结果：daemon rebuild 重启，两次真实 spec-sync 全链路验证——全量 200 OK 93s 落盘 217 change、增量 done，镜像与主仓逐文件一致，list_files 15 文件；backend 19+29 测试过、daemon 90 测试过（B1 预存债与本次无关）。

## ql-20260816-003-7e05 | 2026-08-16 15:40:18 | 修 daemon 全量测试预存失败 B1 + daemon/服务端中断场景健壮性
状态：已完成
关联变更：2026-08-16-change-owner-from-token
文件：
- sillyhub-daemon/src/spec-sync.ts（postSpecSync 包装器实装 pending_push 标记：失败写/成功清/conflict 不动，impl 改名 postSpecSyncImpl 模块私有）
- sillyhub-daemon/tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts（B1 固定 sleep→轮询等 pullSpecBundle + try/finally 兜底 resolve，防 stop 挂死）
- sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts（3 处固定 sleep(80)→waitFor 轮询，同款 flaky）
- sillyhub-daemon/tests/spec-sync.test.ts（pending_push 标记 2 守护测试）
- 其余 17 个测试文件（server_url http://test:8000→http://127.0.0.1:8000，DNS 2.3s/次致全量 hook 超时根治）
需求：修 daemon 全量测试预存失败 B1 + daemon/服务端中断场景健壮性。
根因：B1 固定 sleep(60) 满载误判 + pullPromise 永不 resolve 致 stop 挂死；pending_push 标记只读不写=死代码；19 测试文件 test:8000 DNS 2.3s×2 fetch 致全量 hook 超时。
方案：B1 改轮询+finally 兜底；postSpecSync 包装器实装 pending_push 失败写/成功清/conflict 不动；server_url 统一改 127.0.0.1；borrow-sandbox 3 处固定 sleep 改 waitFor。
结果：daemon 全量 141 文件 2377 passed 0 failed，时长 226s→73s，tsc 0 错，dist rebuild，pending_push 保证中断场景本地改动不被 pull 覆盖。

## ql-20260816-004-5427 | 2026-08-16 16:33:45 | daemon/服务端中断极端场景下 change-write 可恢复性
状态：已完成
关联变更：2026-08-16-change-owner-from-token
文件：
- backend/app/modules/daemon/change_write_router.py（_gc_expired_change_writes 超时回收改回灌 pending，清 claim 态，日志事件改 reclaimed_for_retry）
- backend/app/modules/daemon/tests/test_change_write_router.py（GC 回灌断言 + 新增回灌可重 claim + pending 端点返回回灌行）
- .sillyspec/docs/backend/modules/daemon.md（变更记录 ql-20260816-004）
需求：daemon/服务端中断极端场景下 change-write 可恢复性。
根因：GC 超时回收置 failed 使 daemon 被杀/服务端终止后的任务永久丢失需手动重触。
方案：回收改回灌 pending 自动重试（清 claim 态，下轮轮询重 claim 重做，幂等安全，永久错误仍 failed 不重试）。
结果：change_write_router 20 passed、daemon 模块 800 passed、真实 DB 验证回灌 pending 且进入 pending 查询，backend 已 rebuild 部署。

## ql-20260816-005-5b06 | 2026-08-16 17:14:25 | 变更文件树空态区分真没文件与镜像未同步
状态：已完成
关联变更：2026-08-16-change-owner-from-token
文件：frontend/src/components/__tests__/change-file-tree.test.tsx, frontend/src/components/change-file-tree.tsx
需求：变更文件树空态区分真没文件与镜像未同步。
根因：新建 change 进度走 CLI 直推立即可见而文件镜像走 daemon 同步滞后，空树只显示暂无文件让用户误以为丢失。
方案：空态补一行同步指引文案到工作区配置卡。
结果：change-file-tree 7 passed（含新空态指引断言）+ card 2 passed + tsc 0。

## ql-20260817-001-66e4 | 2026-08-17 00:10:52 | CLI 本地直跑时文档自动同步平台
状态：已完成
关联变更：2026-08-16-auto-sync-from-repo
文件：
- sillyspec:src/sync.js（sync 成功路径追加 syncDocuments（best-effort））
- sillyspec:test/platform-sync-auto-docs.test.mjs（新测试三断言）
需求：CLI 本地直跑时文档自动同步平台。
根因：sync() 只推进度不推文档（sync.js:32 注释明写 run 流程不自动推），syncDocuments 仅手动命令调用。
方案：sync() 成功路径追加 this.syncDocuments（try/catch best-effort 失败 debugLog 不阻断进度；四件套全缺失内部已跳过不调端点）。
结果：sillyspec 仓 f976466（sync.js +12 行 + 新测试 128 行 3 断言），既有 sync 套件零回归（push-header/schema/conflict/dirty 全 0）。

## ql-20260818-001-125d | 2026-08-18 00:55:13 | 修复 sillyhub-daemon status 命令展示缺陷——status 固定展示 DEFAULT server(localhost:8000) 的 p…
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/cli.ts（新增 resolveRunningDaemonConfig+statusAction running 反查改造）
- sillyhub-daemon/tests/cli.test.ts（新增 2 用例：lock 反查展示/config 缺失回退）
- .sillyspec/docs/sillyhub-daemon/modules/cli.md（status 契约+注意事项 ql-20260818-001）
- .sillyspec/docs/sillyhub-daemon/modules/_module-map.yaml（main_symbols 加 resolveRunningDaemonConfig）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（CLI 入口契约补 status 展示行为）
需求：修复 sillyhub-daemon status 命令展示缺陷——status 固定展示 DEFAULT server(localhost:8000) 的 per-server 配置，用 --server 8001 启动的运行中 daemon 被错显为 8000/错误 Runtime ID。
根因：statusAction(cli.ts) 固定 loadConfigFn(DEFAULT_CONFIG.server_url) 读 8000 那份 config-0121783a.json，与运行进程实际用的 per-server 配置无关。
方案：新增 resolveRunningDaemonConfig(pid)——扫 locks/runtime-*.lock 按 pid 匹配取 server_hash，读 config-<hash>.json 取真实 runtime_id/server_url；statusAction 改为 running 时优先反查、失败或非 running 回退原 DEFAULT 逻辑，输出五字段格式不变。
结果：cli.test.ts 新增 2 用例（lock 反查展示真实配置/config 缺失回退 DEFAULT），16 passed+8 skipped、tsc 0 错；实机 node dist/cli.js status 正确显示运行中 daemon 68c63051+http://127.0.0.1:8001；3 处模块文档已同步。

## ql-20260818-002-3915 | 2026-08-18 01:01:47 | local.yaml 服务器侧三处过滤——token 不落 landing 树不随 bundle 跨机分发（spec-file-incremental-sync P2 遗留）
状态：已完成
关联变更：（无）
文件：
- backend/app/modules/spec_workspace/service.py（SERVER_EXCLUDED_FILENAMES 常量 + apply_ops/tar 解包/build_bundle 三处过滤点）
- backend/app/modules/spec_workspace/tests/test_sync_incremental.py（TestLocalYamlExcluded 5 用例）
- .sillyspec/docs/multi-agent-platform/modules/backend.md（platform_sync 条目追加过滤说明）
- 跨仓 sillyspec：src/spec-sync.js（walk 排除 local.yaml）+ test/platform-spec-sync-incremental.test.mjs（+2 断言），其主干 commit 1927721
需求：local.yaml（含 shpsync_/shmcp_ token 的机器本地连接配置）随 spec 树同步落服务器 landing 树，且 build_bundle 会把 token 原样分发到其他成员机器（spec-file-incremental-sync 验证期发现的 P2）。
根因：daemon/CLI 上传排除清单只排 .runtime/runtime/projects（目录）+ worktrees（剪枝），local.yaml 是文件未被覆盖；服务器侧无任何消费方（dispatch 读 local.yaml 走 daemon RPC 在成员机本地读，不读 landing 树）。
方案：backend spec_workspace 服务器侧三处统一过滤（apply_ops 拒 add/update/rename-to 静默丢弃 + delete 放行清存量行 / tar 解包跳过该成员 / bundle 导出跳过）+ CLI spec-sync.js walk 排除（双侧对齐）；daemon 生产端不动（服务器过滤覆盖任意版本生产者）。
结果：backend 187 passed + 1 skip（Windows symlink 预存）、sillyspec 218 files 0 failures、ruff/mypy 全过；main 0791971b + sillyspec 1927721。遗留：daemon spec-sync.ts 生产端排除（省 token 字节上行，非必需）待 daemon 下次迭代顺手加。备注：--done 边界审计拦的 5 个 scan 文档（SillyHub/scan 4 改 + _env-detect 新增）是并行 scan-into-session 会话的工作区改动非本 quick 所为，--force-baseline 仅解锁关闭未触碰彼方文件。
