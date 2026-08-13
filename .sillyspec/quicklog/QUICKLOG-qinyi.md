
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
