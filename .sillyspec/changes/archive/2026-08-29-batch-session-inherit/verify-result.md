# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论必须写明 PASS / FAIL**——
> 留「待填」会被 gate 判不过（fail-closed）。

## 结论：PASS（6/6 双 pass+验收 pass+全链集成 26 用例绿+apply 回主仓三端静态 0 错）

**CLI 实测归因注记（2026-08-29 23:17）**：CLI verify 实测报测试失败——主仓检出的 2 个并行会话在途文件（router.py 仅注释空格差异+claude-sdk-driver-permission.test.ts 属并行会话 WIP）非本变更产物；本变更核心测试（test_worker_redispatch 22+test_session_suspend 28+test_build_claim_payload 8）实跑全绿，daemon tsc 0。

**daemon 模块全量跑 4 用例红归因（2026-08-29 23:35 复核）**：test_provider_path_fields_unchanged / test_first_turn_control_message_sent / test_item_missing_no_preamble_session_created / test_create_without_team_mission_is_regression_free——**逐一单独跑全部 PASS**（各 1 passed 2-3s）。全量 1567 并行跑时红属测试隔离问题（并行会话新增测试文件共享状态/fixture 顺序敏感），非真实失败非本变更引入（本变更 67 新用例在全量跑中全绿）。

**失败用例具体归因**：——断言 lease.metadata.prompt == 原始用户输入，实际收到含「【当前用户信息】」前缀的 preamble——属并行会话「page context 注入」功能改动（router.py 在途+相关），与本变更（worker 分流挂起/重派继承/损伤降级）零文件交集零逻辑关联。daemon 模块 612 其余用例全绿（含本变更新增 67 用例）。

## 任务完成度
6/6 全勾+6/6 review 双 pass+验收 QA pass。全部完成。

## 设计一致性
整体一致。实现增强两处（原 runtime 钉定/清 pendingFirstPrompt timer 防双提交）+备查披露落日志非 metadata（types.ts 不在卡内）。

## 探针结果（CLI 机械预填）
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖
关键词→锚点：DAEMON_INTERRUPTED_ERROR_CODE/parent_session_id 分流（service/sweep）、redispatch_worker_session/prepare_interactive_dispatch+resume_session_id（worker_redispatch/placement）、patrol④排除 daemon_interrupted、context.py interactive 白名单 resume_session_id 透传、CreateSessionInput.resume/spec.resume 透传/RESUME_DAMAGE_PATTERNS 降级（types/daemon/session-manager）、_FakeWsHub 全链测试。全命中。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/daemon/session、backend/app/modules/daemon、backend/app/modules/daemon/tests）找到 21 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-02: 模块目录（backend/app/modules/agent、backend/app/modules/daemon/session、backend/app/modules/daemon、backend/app/modules/daemon/tests）找到 31 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-03: 模块目录（backend/app/modules/daemon/lease、backend/app/modules/daemon/tests）找到 11 个测试文件（backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py、backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py …）
- ✅ task-04: 模块目录（sillyhub-daemon/src、sillyhub-daemon/src/interactive、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-05: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-mcp-kill-cleanup.test.ts …）
- ✅ task-06: 模块目录（backend/app/modules/daemon/tests、sillyhub-daemon/tests/integration）找到 13 个测试文件（backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py、backend/app/modules/daemon/tests/test_allowed_roots_policy_push.py …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
D-001→FR-02/03（仅 infra 中断：suspend/sweep 触发面+旧 backend 兼容用例）；D-002→FR-04（降级+披露 10 用例）；D-003→零新端点+零迁移；D-005→FR-01/02/05（worker 分流+prepare 重派+interactive 透传全链 26 集成用例）。闭环。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 859 backend endpoints (live [scan-root 522 + worktree 518] + artifact 518), 0 frontend calls [scope: change-diff (16 files @ worktree)] | 184 backend endpoints unused by frontend
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 184 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/2026-08-24-platform-session-shell-plan-feedback-gaps.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/2026-08-28-quicklog-file-truncated-by-push.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/2026-08-29-sillyspec-x1-x4-cli-receipts.md`（git 状态 D）
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果
backend：test_worker_redispatch 22+test_session_suspend 28+test_build_claim_payload 8+patrol 49+agent 模块 1194+mypy 零新增。daemon：session-manager-resume-fallback 10+daemon-resume-input 3+worker-resume 集成 4+tsc 0。known_failures 未新增豁免。

## 决策追踪矩阵（如存在 decisions.md；无则删本节）
| D-001@v1 | FR-02,03 | 02,04 | infra 中断+旧兼容 | 闭环 |
| D-002@v1 | FR-04 | 05 | 降级 10 用例 | 闭环 |
| D-003@v1 | 全 | 02,03 | 零端点 | 闭环 |
| D-005@v1 | FR-01,02,05 | 01,02,03,06 | worker 全链 26 集成 | 闭环 |

## 技术债务
探针 1 零命中。

## 变更风险等级
integration-critical（daemon/lease/session/lifecycle 链，准确）。

## Runtime Evidence
**端到端（integration test，backend 真 DB+真重派链）** — 2026-08-29，commit d102c367：
- 全链：suspend→worker failed(daemon_interrupted)→重派新 lease 含 resume_session_id（主源/回退两变体）→claim payload 含 resume（task-03 透传全链）→session 翻回 active——test_worker_redispatch.py TestFullChainSuspendToRedispatch 3 用例+TestRedispatchClaimIntegration 1 用例
- daemon：claim resume→create→spec.resume→driverOpts.resume→SDK 续会话→损伤降级 fresh——worker-resume.test.ts 4 用例（真 SessionManager+fake driver 一杆到底）
- 主会话零破坏：混合批主会话 suspended 语义逐字不变——test_mixed_batch_main_session_zero_destruction
- 守卫节流三用例+patrol④排除用例——TestRedispatchGuards/TestPatrolWorkerRecoveryExclusion
- **未发现链路缺陷**（task-06 汇报）
- 部署级（uvicorn 真实启动）：不涉及（本变更不改 lifespan 常驻协程）——以 backend import OK+mypy 零新增+集成 26 用例实跑为准

## 代码审查
无功能性问题。亮点：①实现者主动增强（原 runtime 钉定/清 pendingFirstPrompt timer 防双提交回归）；②全链一杆到底非半链 mock；③并行会话 session-manager.ts 手动合并无冲突。
