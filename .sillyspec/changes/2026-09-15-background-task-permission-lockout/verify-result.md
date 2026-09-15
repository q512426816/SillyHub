# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：`PASS WITH NOTES`（四项 FR 全落地、11/11 任务完成、daemon 1066 + backend 2156 用例绿；NOTE=生产真机验证待部署后观察——本变更验证到 mocked-WS 集成层，端到端「后台子代理主轮收尾后写工具放行」需新 daemon+backend 同时上线后由线上会话复验）

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
- task-01: satisfied | verifiedFiles: sillyhub-daemon/src/interactive/session-manager/events.ts, sillyhub-daemon/src/interactive/session-manager/background-tasks.ts
- task-02: satisfied | verifiedFiles: sillyhub-daemon/src/interactive/session-manager.ts
- task-03: satisfied | verifiedFiles: sillyhub-daemon/src/interactive/session-manager/permission.ts
- task-04: satisfied | verifiedFiles: sillyhub-daemon/src/interactive/session-manager/permission.ts, sillyhub-daemon/src/interactive/permission-resolver.ts
- task-05: satisfied | verifiedFiles: sillyhub-daemon/src/interactive/permission-resolver.ts
- task-06: satisfied | verifiedFiles: sillyhub-daemon/src/daemon.ts
- task-07: satisfied | verifiedFiles: backend/app/modules/daemon/protocol.py
- task-08: satisfied | verifiedFiles: backend/app/modules/daemon/permission_service.py, backend/app/modules/daemon/tests/test_session_permissions.py
- task-09: satisfied | verifiedFiles: backend/app/modules/agent/service.py, backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py
- task-10: satisfied | verifiedFiles: sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts, sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts, sillyhub-daemon/tests/interactive/permission-resolver.test.ts, sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts
- task-11: satisfied | verifiedFiles: backend/app/modules/daemon/tests/test_session_permissions.py, backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py, backend/app/modules/daemon/tests/test_ws_hub_permission.py

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
- claim: daemon 交互会话全链 mocked-WS 集成套件（含新锚点/注入点/兜底/USAGE_NOTE 全用例）全绿 | command: cd sillyhub-daemon && pnpm exec vitest run tests/interactive/ | exit: 0 | log: .sillyspec/changes/2026-09-15-background-task-permission-lockout/verify-int-daemon.log
- claim: backend daemon 模块全量 + agent 清理错误码用例全绿 | command: cd backend && uv run pytest app/modules/daemon/tests/ app/modules/agent/tests/test_cleanup_stale_runs_error_code.py -q --no-cov | exit: 0 | log: .sillyspec/changes/2026-09-15-background-task-permission-lockout/verify-int-backend.log

## 任务完成度 [层：人工判断]
11/11 完成（task-01~09 实现任务全部 ✅，验收标准逐条有对应实现与测试；task-10/11 测试收口 ✅——daemon 新增 bg-anchor 13 用例 + usage-note 2 用例 + resolver 4 用例 + :494 断言修订，backend 新增 error_code 2 用例 + 受理放宽 3 用例 + ws_hub deny 断言修订）。task-05 checkbox 由 verify 手动补勾（实现/测试均存在，execute 自动勾选漏计——与 task-04 同文件归属被吞）。

## 设计一致性 [层：人工判断]
一致（execute QA 独立审查首轮 3 项偏差当场修正后复验一致）：①AskUserQuestion 拦截 register 补注入 background_task（QA P0-1）；②buildOnUserDialogCallback 不可达路径死代码移除（QA P1-3，与 design「2 处不可达不注入」对齐）；③三类测试补齐（QA P1-2）。另两处实现内防御性收窄不违设计：daemon.ts hasLiveBackgroundTasks 用 ?.（旧测试替身安全降级）；_deny_respond 在 session 不可解析分支省略 runtime_id（无值可带，design 注释已载明）。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中

#### 探针 2：设计关键词覆盖
- ✅ `hasBackgroundTaskGrace` → sillyhub-daemon/src/interactive/session-manager/permission.ts
- ✅ `backgroundTaskFlag` → sillyhub-daemon/src/interactive/session-manager/permission.ts
- ✅ `hasLiveBackgroundTasks` → sillyhub-daemon/src/interactive/session-manager.ts
- ✅ `background_task` → backend/app/modules/daemon/protocol.py
- ✅ `_deny_respond` → backend/app/modules/daemon/permission_service.py
- ✅ `PLATFORM_PERMISSION_DROPPED` → backend/app/modules/daemon/permission_service.py
- ✅ `PLATFORM_NO_RUNNING_TURN` → sillyhub-daemon/src/interactive/session-manager/permission.ts
- ✅ `SERVICE_RESTART_INTERRUPTED` → backend/app/modules/agent/service.py
- ✅ `USAGE_NOTE` → sillyhub-daemon/src/daemon.ts
（9 个设计能力关键词全部命中实现文件）

#### 探针 3：验收标准测试覆盖
- ⚠️ task-01: 模块目录（sillyhub-daemon/src/interactive/session-manager）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-02: 模块目录（sillyhub-daemon/src/interactive）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-03: 模块目录（sillyhub-daemon/src/interactive/session-manager）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-04: 模块目录（sillyhub-daemon/src/interactive/session-manager、sillyhub-daemon/src/interactive）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-05: 模块目录（sillyhub-daemon/src/interactive）递归未找到测试文件（含 co-located tests/）
- ✅ task-06: 模块目录（sillyhub-daemon/src）找到 2 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts）
- ✅ task-07: 模块目录（backend/app/modules/daemon）找到 12 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-08: 模块目录（backend/app/modules/daemon）找到 12 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-09: 模块目录（backend/app/modules/agent）找到 10 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-10: 模块目录（NEW:sillyhub-daemon/tests/interactive、sillyhub-daemon/tests/interactive、sillyhub-daemon/src/interactive/session-manager、sillyhub-daemon/src/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-11: 模块目录（backend/app/modules/daemon/tests、backend/app/modules/agent/tests、backend/app/modules/daemon、backend/app/modules/agent）找到 32 个测试文件（backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py …）
- ℹ️ 探针 3 task-01~05 的 ⚠️ 是目录面误报：本仓测试统一放 sillyhub-daemon/tests/interactive/（非 src 同目录 co-located），实际承接见探针 7 矩阵（全部 covered）。集成盲区抽查：WS 装配链由 bridge/bg-anchor 套件经真实 SessionManager→resolver→mock wsClient 全链覆盖，无盲区。

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles 结构归属承接面（每条 acceptance 由哪些测试承接）；两者并排冲突以 7 为准。判定枚举（四选一）：covered / partial / uncovered / non-testable（文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。证据列给首命中 file:line 锚点或人工核验提示。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 注册表非空时 onResult 保留 currentRunId 且 status 翻 active | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 「后台锚点生命周期」it1（注册表非空：onResult 保留 currentRunId） |
| 注册表为空/不存在时 onResult 清 currentRunId 行为与现状一致 | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 同 describe it2 |
| 注销后注册表空+active 清锚点；running 不误清 | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 同 describe it3（双 session 双态） |
| clearBackgroundTasks 调用后锚点同步清除 | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 同 describe it4（终态兜底） |
| 新增单测覆盖上述分支全部通过 | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 全文件 13 用例 passed（vitest 实跑） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 空/不存在返回 false | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 「hasLiveBackgroundTasks 不建 map」用例 |
| 非空返回 true | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 锚点 it1 + 守卫三态 it |
| 不存在 sessionId 不建 map 无副作用 | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 同上用例断言 get()===undefined |
| 不泄漏私有 map 引用 | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 返回值仅 boolean 断言 + tsc 访问器签名约束 |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 守卫三态（空 deny/非空放行/currentRunId 无 deny） | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 「hasBackgroundTaskGrace 守卫三态」用例 |
| deny message 以 PLATFORM_NO_RUNNING_TURN: 开头 | sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts + sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts:497 toContain 断言（本变更修订）+ bg-anchor deny 断言 |
| 主轮普通人审 deny 文案不变 | sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 同文件 deny 收敛既有用例（远程 deny 透传/默认模板）全绿未改 |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 锚点态 4 处可达调用点 payload 均含 background_task: true | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 「background_task 注入点」describe 4 用例（Bash/AskUserQuestion/ExitPlanMode/requestPermission） |
| 主轮进行中恒 false 不带键 | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts + sillyhub-daemon/tests/interactive/permission-resolver.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 注入点 describe 反向用例 + resolver「不传无 background_task 键」用例 |
| 未标记时 payload 无键（旧 backend 兼容） | sillyhub-daemon/tests/interactive/permission-resolver.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 「不传 backgroundTask → payload 无键」用例 |
| 2 处不可达路径锚点态维持 cancelled | sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts | 命中 | covered | `session-manager-bg-anchor.test.ts` 「不可达路径①/②」用例（requestUserDialog/onUserDialog 均 cancelled + sendCount=0） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 后台 dialog 5min 兜底 deny | sillyhub-daemon/tests/interactive/permission-resolver.test.ts | 命中 | covered | `permission-resolver.test.ts` 「backgroundTask=true 的 dialog 请求也启 5min 兜底」用例（fake timers 推进 PERMISSION_FALLBACK_TIMEOUT_MS） |
| 主轮 dialog 仍不设超时 | sillyhub-daemon/tests/interactive/permission-resolver.test.ts | 命中 | covered | `permission-resolver.test.ts` 「主轮 dialog 维持现状不设超时」用例（超时后仍 pending） |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 注册表非空触发 USAGE_NOTE 行 | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | 命中 | covered | `daemon-usage-note.test.ts` it1（submitMessages 挂 run-1 + channel=stdout + 文案断言） |
| 注册表为空不触发 | sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts | 命中 | covered | `daemon-usage-note.test.ts` it2（hasNote=false） |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 字段缺省 None 兼容 | backend/app/modules/daemon/tests/test_session_permissions.py | 命中 | covered | `backend/app/modules/daemon/tests/test_session_permissions.py:1769` TestBackgroundTaskRequestAcceptance::test_non_background_completed_run_still_dropped（缺省走原校验=旧行为） |
| pydantic 校验通过不破坏既有字段 | backend/app/modules/daemon/tests/test_session_permissions.py | 命中 | covered | `backend/app/modules/daemon/tests/test_session_permissions.py:1704` 同上 3 用例 payload 构造含 background_task 走通 + 既有 46 用例全绿 |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 带标记 run completed 仍受理 | backend/app/modules/daemon/tests/test_session_permissions.py | 命中 | covered | `backend/app/modules/daemon/tests/test_session_permissions.py:1704` test_background_task_with_completed_run_accepted（SSE+timer 断言） |
| 归属不匹配拒收且推 deny | backend/app/modules/daemon/tests/test_session_permissions.py | 命中 | covered | `backend/app/modules/daemon/tests/test_session_permissions.py:1736` test_background_task_run_ownership_mismatch_dropped_with_deny（故障码+runtime_id 断言） |
| 各失败分支 mock hub 断言 payload | backend/app/modules/daemon/tests/test_ws_hub_permission.py + backend/app/modules/daemon/tests/test_session_permissions.py | 命中 | covered | `backend/app/modules/daemon/tests/test_ws_hub_permission.py:355` ws_hub test_bound_runtime_rejects_wrong_daemon_id（修订后断言 deny payload 6 字段）+ ownership 用例 |
| session-not-found 分支 runtime_id 条件省略 | backend/app/modules/daemon/tests/test_session_permissions.py | 命中 | covered | `backend/app/modules/daemon/tests/test_session_permissions.py:594` 实现分支审查（_deny_respond 条件键）+ session_not_found 用例（既有 fail-soft 套件全绿） |

**task-09**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| failed 分支断言两字段 | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | 命中 | covered | `backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py:62` test_stale_run_failed_branch_writes_error_code |
| completed 恢复分支不写 error_code | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | 命中 | covered | `backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py:80` test_stale_run_restored_completed_branch_no_error_code |

**task-10**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 新建锚点测试覆盖上述全部用例且通过。 | `sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts`<br>`sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts`<br>`sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts`<br>`sillyhub-daemon/tests/interactive/permission-resolver.test.ts`<br>`sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts` | — | partial | （无机械命中——人工核验 `sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts`） |
| 既有相关测试文件全部跑绿（含 :494 修订后断言）。 | `sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts`<br>`sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts`<br>`sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts`<br>`sillyhub-daemon/tests/interactive/permission-resolver.test.ts`<br>`sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts` | — | partial | （无机械命中——人工核验 `sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts`） |
| pnpm typecheck 通过。 | `sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts`<br>`sillyhub-daemon/tests/interactive/daemon-usage-note.test.ts`<br>`sillyhub-daemon/tests/interactive/claude-sdk-driver-permission.test.ts`<br>`sillyhub-daemon/tests/interactive/permission-resolver.test.ts`<br>`sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts` | — | partial | （无机械命中——人工核验 `sillyhub-daemon/tests/interactive/session-manager-bg-anchor.test.ts`） |

**task-11**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 新用例全部通过，覆盖受理放宽 / 即时 deny / error_code 三类断言。 | `backend/app/modules/daemon/tests/test_session_permissions.py`<br>`backend/app/modules/daemon/tests/test_ws_hub_permission.py`<br>`backend/app/modules/daemon/tests/test_permission_http_uplink.py`<br>`backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py` | 即时、deny、error_code（`backend/app/modules/daemon/tests/test_session_permissions.py`、`backend/app/modules/daemon/tests/test_ws_hub_permission.py`、`backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py`） | covered | `backend/app/modules/daemon/tests/test_session_permissions.py:1494`（即时）、`backend/app/modules/daemon/tests/test_session_permissions.py:8`（deny）、`backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py:4`（error_code） |
| 既有 fail-soft 断言（accepted=False / return False）保持不变且通过。 | `backend/app/modules/daemon/tests/test_session_permissions.py`<br>`backend/app/modules/daemon/tests/test_ws_hub_permission.py`<br>`backend/app/modules/daemon/tests/test_permission_http_uplink.py`<br>`backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py` | 既有、fail、soft、断言、accepted（`backend/app/modules/daemon/tests/test_session_permissions.py`、`backend/app/modules/daemon/tests/test_permission_http_uplink.py`、`backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py`、`backend/app/modules/daemon/tests/test_ws_hub_permission.py`） | covered | `backend/app/modules/daemon/tests/test_session_permissions.py:1225`（既有）、`backend/app/modules/daemon/tests/test_session_permissions.py:595`（fail）、`backend/app/modules/daemon/tests/test_session_permissions.py:1510`（soft） |

#### 探针 4：决策追踪覆盖
D-001@v1（锚点+协议标记，方案 A）闭环验证：FR-01（锚点/访问器/守卫）→ task-01/02/03 实现锚定 sillyhub-daemon/src/interactive/session-manager/events.ts:55-67 + permission.ts hasBackgroundTaskGrace（探针 2 ✅）+ bg-anchor 套件 13 用例；FR-02（标记/受理/兜底）→ task-04/05/07/08 实现锚定 4 处注入 + protocol.py background_task + is_background_task 分支 + resolver 5min（探针 2 ✅ + 注入点/受理用例）；FR-03（故障码）→ task-03/08 双侧前缀（grep 命中 + 断言）；FR-04 → task-06/09（USAGE_NOTE 两态 + error_code 两用例）。全部决策-需求-任务-证据四层闭环，无未闭环行。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2807 backend endpoints (live [scan-root 603] + artifact 2412), 0 frontend calls [scope: change-diff (22 files @ scan-root)] | 832 backend endpoints unused by frontend
- ⚠️ 832 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/verify-evidence-account-diff-misses-committed-changes.md`（git 状态 D）
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

## 测试结果 [层：确定性检查——CLI 实测对账]
- daemon：`pnpm exec vitest run tests/interactive/` → 64 files / **1066 passed / 0 failed**（exit 0；含本变更新增 bg-anchor 13 + usage-note 2 + resolver 新增 4 用例与 :494 修订）；根目录相关面 bridge/recovery-boot/notify-ready/cli-injection/cache-passthrough/mission-worker 共 108 passed。
- backend：`uv run pytest app/modules/daemon/tests/ app/modules/agent/tests/test_cleanup_stale_runs_error_code.py -q --no-cov` → **2156 passed / 0 failed**（exit 0）；ruff check/format 绿、mypy 0 error。
- daemon tsc --noEmit 0 error。无 known_failures 豁免项。
- 注：CLAUDE.md 规则 0 禁跑全量套件——以上均为「修改相关面」（interactive 全目录为本变更所属子系统族，daemon 模块全量为受理放宽的直改模块）。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03、FR-04 | task-01~task-11 | 探针 4 四层闭环（FR→task→实现锚点→测试用例逐一见探针 7 矩阵与探针 2 关键词命中） | 已闭环 |

## 技术债务 [层：人工判断]
探针 1 零命中（无 TODO/FIXME/HACK 新增）。遗留技术债（非本变更新增，已在 design 非目标/风险登记）：R-06 daemon 自更新在后台任务存活期重启策略、R-08 后台 dialog 5min 后作答的 409 文案强化、上游 CLI task_progress total_tokens=0、per-task 用量拆分（SDK 无数据源）。

## 变更风险等级 [层：人工判断]
integration-critical（brainstorm gate 判级沿用；变更横跨 daemon↔backend WS 协议与权限生命周期，非 doc-only/unit-sufficient）。无显式 risk_level 覆盖；关键词命中（daemon/session/AgentRun）无否定语境抑制。

## Runtime Evidence [层：人工判断]
- 证据链：主仓 HEAD 2bd40f606（apply 后未提交，变更 16 文件暂存 index）；集成回执两条（verify-int-daemon.log 64f/1066t、verify-int-backend.log 2156t，均 exit 0，2026-09-15 19:0x 本地时间实跑）。
- 运行时组件面：WS PERMISSION_REQUEST/PERMISSION_RESPONSE 协议（protocol.py + resolver mock wsClient 全链测试）；会话生命周期（onResult 锚点→注销清锚点→clearBackgroundTasks 兜底三段测试断言）；REST 端点：不涉及（无新端点，endpoints baseline 603 无增删）；启动命令/部署：不涉及（verify 阶段不部署，生产复验见结论 NOTE）。
- 失败模式排除：旧 daemon+新 backend（background_task 缺省走原校验用例）、新 daemon+旧 backend（dialog 5min 兜底用例）、拒收即时 deny（3 用例）、注册表泄漏兜底（clearBackgroundTasks 用例）均有断言。

## 代码审查 [层：人工判断]
问题列表：无阻断问题。
**noAI 质量扫描归因（verify step 6）**：全量扫描被 2 个非本变更测试卡住——①`tests/daemon-provider-config-changed-handler.test.ts` codex 热切换用例：**干净 HEAD（2bd40f606，临时 detached worktree 不含本变更任何改动）上同样失败**（expected false to be true @ :539 hot_switch_rewrite 断言）——系并行会话当日提交（073c15420 spawn-env 链改动）引入的存量回归，非本变更问题；②`tests/daemon-status-root-persistence.test.ts`：主仓单独复跑 9/9 passed（扫描并发环境下的瞬态失败）。本变更全部相关面（daemon interactive 1066 + 根目录 108 + backend 2156）实测绿，归档前重跑 noAI 扫描待存量回归由其归属会话修复后自然解除（CLI 归因提示同一出口）。备注 3 条：①生产端到端复验待部署（结论 NOTE）；②探针 3 task-01~05 目录面误报已在探针 7 纠正（covered）；③探针 6 检出的 docs/sillyspec/verify-evidence-*.md 删除为并行会话所为（git status 快照即有、非本变更文件），不判 FAIL。总体评价：实现-设计-测试三层一致，四项 FR 证据闭环，可交付。
