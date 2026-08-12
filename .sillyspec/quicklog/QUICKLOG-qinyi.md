
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

## ql-20260812-009-976d | 2026-08-12 21:42:49 | (quick 任务)
状态：进行中
关联变更：（无）
文件：backend/conftest.py, backend/app/modules/mcp_gateway/tests/test_webhook.py, frontend/src/components/__tests__/team-progress.test.tsx, frontend/vitest.config.ts
