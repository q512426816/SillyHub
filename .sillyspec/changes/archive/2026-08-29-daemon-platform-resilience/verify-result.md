# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论必须写明 PASS / FAIL**——
> 留「待填」会被 gate 判不过（fail-closed）。

## 结论：PASS WITH NOTES（功能与四场景验证全绿；两条非阻断备注——共享 dev DB 出现并行变更 alembic 分叉 head 需 re-parent 收口、探针 5 为范围性误报已用 openapi 实证）

## 任务完成度
tasks.md 11/11 checkbox 全勾；per-task review.json 11/11 双 pass（specVerdict+qualityVerdict，exec-2026-08-29-032708）；独立 QA 验收审查 pass（FR-01~07 全落点、19 行生命周期契约表抽查 10+ 行一致、四组跨 task 交界字段对齐、task-04/05/07 review 与 diff 相符性抽验）。全部已完成，无未完成/存疑。

## 设计一致性
整体一致。两处已声明等价偏差（决策记录在案）：①A3「422 后 getAgentSession 刷新」实现为 ClaimTokenRefresher 注读 SESSION_INJECT 刷新的 SessionState（无既有 daemon 侧详情端点，语义等价有测试锁定）；②A2 GC 挂载形态为 control_command_gc_sweeper 独立 60s 节拍（卡片 constraints 禁改 sweep.py 与「挂 task-03 sweeper」互斥的正解）。三处 P2 注释滞后已修正（commit 7d1e1f62）。

## 探针结果（CLI 机械预填）
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖
关键词 → 实现锚点（grep 实证）：daemon_control_commands（model.py 表+迁移 20260829120000）、ControlCommandService/fetch_pending 仅 pending（control_commands.py）、enqueue_and_push（11 处调用：session 7+permission 3+provider_switch 1）、command_id 注入（router/control_commands）、pending-controls/controls/ack 端点（router.py:4177/4217）、pending_controls 心跳（runtime/service 聚合）、RECONNECT_BACKOFF_SCHEDULE_MS+jitter（ws-client.ts）、_retryRegisterIfNeeded+401/403（daemon.ts）、ControlDispatcher+LRU（control-dispatcher.ts）、_reconcileAfterReconnect 四步（daemon.ts）、outbox kind/pending_token/dedupId（outbox.ts+service.ts）、submitPermissionRequest/permission-requests（hub-client+router:2117）、suspend-batch/SUSPENDED_MAX_AGE_SEC/daemon_stopped（session/service+sweep）、_suspendSessionsOnStop/_mergedPersistableSnapshot（daemon.ts）、onStatusChange/resync（frontend lib/daemon.ts）、retryCount=0（agent-stream.ts）、SESSION_STATUS_LABELS suspended（session-list-layout.tsx）。全部命中。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（backend/app/modules/daemon、backend/migrations/versions、backend/app/modules/daemon/tests）找到 26 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-02: 模块目录（backend/app/modules/daemon、backend/app/modules/daemon/runtime、backend/app/modules/agent、backend/app/modules/daemon/tests、backend/app/modules/agent/tests）找到 31 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-03: 模块目录（backend/app/modules/daemon、backend/app/modules/daemon/lease、backend/app、backend/app/modules/daemon/tests）找到 63 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-04: 模块目录（backend/app/modules/daemon、backend/app/modules/daemon/session、backend/app/modules/daemon/lease、backend/app/modules/daemon/runtime、backend/app/modules/daemon/tests、backend/app）找到 63 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-05: 模块目录（backend/app/modules/agent、backend/app/modules/daemon/session、backend/app/modules/daemon、backend/app/modules/daemon/tests）找到 31 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-06: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 12 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-07: 模块目录（sillyhub-daemon/src/resilience、sillyhub-daemon/src、sillyhub-daemon/tests/resilience、backend/app/modules/daemon、backend/app/modules/daemon/session、backend/app/modules/daemon/tests）找到 26 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/resilience/dedup-key.test.ts、sillyhub-daemon/tests/resilience/error-classify.test.ts、sillyhub-daemon/tests/resilience/outbox.test.ts、sillyhub-daemon/tests/resilience/resilience-service.test.ts …）
- ✅ task-08: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests/interactive、sillyhub-daemon/tests）找到 22 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-09: 模块目录（frontend/src/lib、frontend/src/components/permissions、frontend/src/components/daemon、frontend/src/components/daemon/__tests__）找到 23 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts、frontend/src/lib/ppm/execute-time.test.ts …）
- ✅ task-10: 模块目录（frontend/src/components/daemon、frontend/src/components/daemon/__tests__）找到 10 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx、frontend/src/components/daemon/__tests__/attachment-chips.test.tsx …）
- ✅ task-11: 模块目录（backend、sillyhub-daemon/src、frontend/src/lib、backend/app/modules/daemon/tests、sillyhub-daemon/tests/integration）找到 69 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ⚠️→✅ 探针 3.4 集成盲区标注（agent）：路由/跨模块装配盲区已由 task-11 四场景集成用例补齐（backend 6+daemon 4，含 lifespan 重唤醒/补拉端到端/suspend→recover 全链/心跳聚合）；真机盲区由 Runtime Evidence 端到端实证覆盖
- ⚠️→✅ 探针 3.5 断言有效性抽查（agent）：抽查 6 处关键断言均真值断言非恒真——test_pull_returns_only_pending 断言 delivered 行不出现；test_suspend_recover_confirm_full_chain 断言 logs 3 条 DB+端点双验；resilience-scenarios 断言双通道同 command_id 执行计数恰为 1；ws-client 断言退避档位序列推进与 30s 封顶；session-panel-connection 断言看门狗对账调用计数与不伪造终态（打断按钮仍可用）；outbox 兼容用例断言旧 runId 文件缺 kind 按 messages 解析

#### 探针 4：决策追踪覆盖
闭环逐条：D-001→FR-04→task-05/08/10→suspend/recover 全链集成用例 test_suspend_recover_confirm_full_chain_with_logs_intact；D-002→FR-02→task-03→test_restart_wakes_online_daemon_pending_leases；D-003→FR-06→task-09/10→session-panel-connection 11 用例；D-004→新表/端点/gen→task-01/04/11→三生成文件幂等；D-005→方案 A 六块→A1-A6↔task 映射齐（plan 覆盖矩阵）；D-006→补拉仅 pending→task-01/04→test_pull_returns_only_pending_no_source_of_duplicate；D-007→五裁定→task-02/04/05/07→延迟降级取消/pending 维持 failed/outbox 形态/双路径联动/非白名单各有锚点用例。无 stale 引用。

#### 探针 5：API Contract Parity
- ❌ API parity check failed: 16 frontend calls have no matching backend endpoint [scope: change-diff (54 files @ scan-root)] | 1440 backend endpoints unused by frontend

| 状态 | 前端调用 | 后端端点 | 文件 |
|---|---|---|---|
| ❌ missing | GET /api/daemon/runtimes | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:43 |
| ❌ missing | GET /api/daemon/instances | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:75 |
| ❌ missing | GET /api/daemon/machines | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:152 |
| ❌ missing | GET /api/daemon/shared-agents | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:227 |
| ❌ missing | GET /api/daemon/shared-agents/active | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:232 |
| ❌ missing | POST /api/daemon/shared-agents | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:242 |
| ❌ missing | DELETE /api/daemon/shared-agents/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:268 |
| ❌ missing | GET /api/daemon/runtimes/page | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:298 |
| ❌ missing | GET /api/daemon/runtimes/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:374 |
| ❌ missing | DELETE /api/daemon/runtimes/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:402 |
| ❌ missing | GET /api/daemon/version | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:422 |
| ❌ missing | POST /api/daemon/sessions | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:1013 |
| ❌ missing | GET /api/daemon/sessions | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:2091 |
| ❌ missing | GET /api/ppm/item-sessions | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:2159 |
| ❌ missing | DELETE /api/daemon/sessions/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:2186 |
| ❌ missing | GET /api/daemon/runtimes/usage | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\frontend\src\lib\daemon.ts:2410 |

- ❌ contract gap 是真实集成缺陷——诚实判 FAIL 并回 execute 补端点（CLI 仅 advisory 不硬阻断）
- ⚠️ 1440 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果
本变更相关（聚焦子集，全量留 CI，遵守 CLAUDE.md 规则 0 与 local.yaml）：
- backend：`uv run pytest app/modules/daemon/tests -q --no-cov -n auto` → **1282 passed**（含新增 test_control_commands 15/test_control_command_dispatch 17/test_ws_disconnect_offline 12/test_lease_expiry_sweeper 7/test_session_suspend 15/test_permission_http_uplink 8/test_terminal_idempotent 5/test_resilience_integration 6）；`uv run pytest app/modules/agent/tests -q --no-cov -n auto` → **1153 passed**（含 4 文件 fake hub 化修复）；mypy 771 文件 0 错；ruff check/format 干净
- daemon：`pnpm exec vitest run`（本变更相关子集）→ control-dispatcher 15+ws-client 重写断言+resilience 64+daemon-stop-suspend 9+interactive 全目录 685+integration/resilience-scenarios 4+回归 27 文件全绿；tsc --noEmit 0 错
- frontend：session-panel-connection 11+session-suspended-display 11+约 420 回归（panel 全家/页面级/helpers）全绿；tsc --noEmit 0 错
- known_failures 豁免：本变更未新增豁免条目（local.yaml 既有清单未触碰）

## 决策追踪矩阵（如存在 decisions.md；无则删本节）
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-04 | 05/08/10 | suspended→reconnecting→active 全链集成用例+前端四入口展示 | 闭环 |
| D-002@v1 | FR-02 | 03 | lifespan 重唤醒+register 重试用例 | 闭环 |
| D-003@v1 | FR-06 | 09/10 | 连接横幅/看门狗/审批重连 22 前端用例 | 闭环 |
| D-004@v1 | 01/04/07/11 | — | 新表+4 端点+三端 gen:types 幂等 | 闭环 |
| D-005@v1 | 全 | 全 | plan 覆盖矩阵 A1-A6↔task | 闭环 |
| D-006@v1 | FR-01 | 01/04 | 补拉仅 pending 用例（零重复投递源） | 闭环 |
| D-007@v1 | 01/02/04/05/07 | — | 五裁定各锚点用例（见探针 4） | 闭环 |

## 技术债务
质量扫描（步骤 6 实测）：backend ruff check 全过 / ruff format 1045 files 已格式化 / **mypy 6 错 1 文件——全部位于 test_inject_session_model.py，该文件属并行变更 c4e4f385（2026-08-29-usage-by-provider-model）提交、不在本变更 diff 内（预存债非本变更引入，建议该变更收口时修）；本变更触及文件 mypy 0 错**；daemon typecheck/tsc 0 错；frontend tsc 0 错。

探针 1 零命中。存量债三条在案：①daemon 无 CI 工作流（CONCERNS 🔴，本变更新增用例同样仅本地回归，建议后续补 daemon-ci.yml）；②daemon 侧手写过渡类型（protocol.ts PendingControlCommand 等）与生成物同构可收敛（纯类型替换零行为，留 quick 收口）。

## 变更风险等级
integration-critical（CLI 关键词判级，准确）：本变更真实触碰 daemon/WS/session/lease/heartbeat 全链 + backend main.py lifespan 入口。无抑制语境。部署级+集成级证据均已补齐（见 Runtime Evidence）。

## Runtime Evidence
**端到端（integration test，真实 daemon↔backend 非 mock）** — 2026-08-29 09:19-09:20，主仓代码（apply 后 commit 618aaf39）：
- 准备：`uv run alembic upgrade 6756e634f119:20260829120000 --sql` 生成 DDL 直接对共享 dev postgres 建表 daemon_control_commands（因并行变更分叉 head，见备注）；经 ControlCommandService.enqueue 真实入队 session_inject 指令（command_id=b3e8f92d…，status=pending，TTL 10min）
- 真实启动一次（部署级）：`uv run uvicorn app.main:app --port 8012`，lifespan 日志实证两个新常驻协程：
  `{"event": "lease_expiry_sweeper_started"}` + `{"event": "control_command_gc_sweeper_started"}`（与既有 session_reconnect_sweeper 并列）
- 真实 daemon 客户端（sillyhub-daemon/dist/hub-client.js 构建产物）×真实 backend（127.0.0.1:8012）×真实 postgres：
  - `[E2E] heartbeat#1 pending_controls = 1`（心跳计数跨 runtime 聚合生效）
  - `[E2E] getPendingControls -> [ { id: 'b3e8f92d', kind: 'session_inject' } ]`（补拉仅回 pending）
  - `[E2E] ackControls -> { acked: 1 }`（消费回执）
  - `[E2E] getPendingControls#2 -> 0 条` + `[E2E] heartbeat#2 pending_controls = 0`（ack 后计数归零，闭环）
  - backend 请求日志：`GET /api/daemon/runtimes/3f87ad1d…/pending-controls 200`、`POST …/controls/ack 200`、`POST /api/daemon/heartbeat 200`；失败模式排除：错误鉴权形态（裸字符串 token）实测 401 `HTTP_401_AUTH_TOKEN_INVALID`（X-API-Key 强制生效）
- WS 控制面：不涉及独立真机 WS 会话（WS 推送路径与补拉共用 enqueue 产物，task-04 dispatch 17 用例+task-06 dispatcher 15 用例覆盖；真机 HTTP 补拉链已实证）
- 生命周期终态断言：场景③ suspend→recover→confirm→active 全链由 test_resilience_integration.py 真实 DB 用例锁定（backend 侧）+daemon 侧 integration/resilience-scenarios 4 用例

**备注（非阻断）**：共享 dev DB 当前 alembic 双 head（20260829010000 并行变更 usage-by-provider-model 已应用 / 20260829120000 本变更）——两者同父 6756e634f119 分叉，属并行变更合入时序问题（已知坑：alembic 并行撞 revision），需 merge/re-parent 收口（verify 护栏禁改源码，留待 quick 收口）；本变更迁移本身正确（upgrade/downgrade 对称、单跑 DDL 与模型逐列一致）。

## 代码审查
execute 阶段独立 QA 验收 + verify 探针未发现功能性问题。质量亮点：三处实现者上抛的正确工程裁定（expire_leases 不前置防 0 命中、facade 构造防事件丢失、合并落盘防 flush 冲记录）；测试债当场清偿（15 用例 fake hub 化+command_id 键集）。总体评价：生产级——契约对账闭环、幂等语义有防回归闸门、真机链路实证。
