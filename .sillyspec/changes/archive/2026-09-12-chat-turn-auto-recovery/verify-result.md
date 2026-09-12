# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。

## 结论 [层：人工判断]

结论枚举：`PASS`
7/7 任务完成、13 项设计一致性全过（QA acceptance 独立子代理两轮：初审 1 P1→修复 046c51da5→复验撤销）、六场景真实 DB 集成测试全绿；lint 门为沙箱 node_modules 缺失假败、真实仓全链 lint exit 0（advisory 留痕，75e579d88/39d13bd4c 先例）；执行期偏差 4 项均 P2 记录在案。

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无（7 任务全部可验证，无 cannot_verify）

## 集成验证回执 [层：自述声明——CLI 一致性校验]

- claim: 三类中断自动恢复全链端到端（瞬时干净轮排队重放打标/工具活动 nudge/quota 定时排期→sweep 派发打标/G10 超越取消/开关关闭全手动/静默中断 nudge），真实 DB 事务非 mock | command: cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_auto_recover_integration.py --log-file=../.sillyspec/changes/2026-09-12-chat-turn-auto-recovery/integration-run.log --log-file-level=INFO | exit: 0 | log: .sillyspec/changes/2026-09-12-chat-turn-auto-recovery/integration-run.log

## 任务完成度 [层：人工判断]

- task-01 ✅ 完成：classifier 规则体 provider 无关化+断流关键词+resetAt（「将[在于]」双介词 +08:00——实测 GLM 文案为「将在」）+wire 键映射（camel 剔除）；model-error 32 用例含 claude 八类零回归
- task-02 ✅ 完成：pi 静默中断检测（message_end 边粒度 hasText 收口+仅 tool_result 翻转+settle !lastWasFinalText 合成 error）；五组正反例（[text,thinking] success 反例/零活动/usage-only/thinking 尾/tool_result 尾）；pi 三套件 117 绿
- task-03 ✅ 完成：ModelErrorDTO.reset_at+scheduled_messages.origin 列（migration 20260912110000 down_revision=1d763051eb15 单头 up/down 实跑干净）+ScheduledMessageRead/SessionQueueEntry DTO origin+gen:types（openapi schema 逐个核验）；43 测试+tsc 0
- task-04 ✅ 完成：maybe_auto_recover_failed_turn 三分支判定序（G0 全守卫/quota 连续链 3/紧链 2/G5 截断 G6 附件/同文 pending 防叠加/满员）+auth-transient 并入统一判定序（旧钩子删除）+close 调用点双层防御；矩阵 16+auth 6+恢复链回归 33 绿，mypy 0
- task-05 ✅ 完成：scheduled_send G10 超越守卫（cancelled/superseded）+inject_session_as_service 加 auto_resume_of 转发（SessionService 壳同步——首跑 8 失败暴露壳漏改已补）+_handle_busy_turn 忙轮 INSERT 落 origin（R-08）；sweeper 18+queue/inject 38 绿
- task-06 ✅ 完成：双信号提示（autoRecoverHintForTurn 三分支×同源 pending 条目存在性，无条目→undefined）+run-error-item 链序+「自动续跑」徽标+定时数据经 onEntriesChange 回调上提（保 R4；引用抖动渲染循环实测发现并双层修复）；bar 11+推导 7+error-item 46+dialog 58+pre-session/offline 40 绿
- task-07 ✅ 完成：六场景集成测试（真实 DB）6/6+六处模块文档同步；QA acceptance 初审 P1（buildErrorLogItem 漏透 reset_at——构造点绕过假绿）修复 046c51da5+三条链路回归（normalize 94 绿）复验撤销

## 设计一致性 [层：人工判断]

一致（QA acceptance 13/13：FR-1~5/NFR-1~4/生命周期契约表 8 事件/两契约链三端贯通/风险对策抽查）。执行期偏差 4 项（均 P2 非阻断，QA review.json 记录）：
1. 分支 A（quota）无空轮守卫——design G0 声明全分支；quota nudge 为固定文案不依赖原文，实际影响极小；
2. 链计数含当前节点口径（quota 实际自动续跑 2 次/transient nudge 1 次）——比 FR 字面更保守且测试锁定；
3. 定时数据上提用 onEntriesChange 回调替代 design 建议的父层 hook——保 R4「panel 零 react-query」不变式，目标达成；
4. task-02 合成 error 文案附加诊断括注（api_calls/final_text）——含关键词不影响归类。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]

#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ 清单文件不存在（跳过）：NEW:backend/migrations/versions/20260912110000_add_scheduled_message_origin.py、NEW:backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py
  （agent 核注：两 NEW: 文件均已随提交 2842fd594 落主仓，前缀不匹配致探针跳过，非缺失）

#### 探针 2：设计关键词覆盖
逐能力关键词 grep 主仓实现确认：resetAt/reset_at（classifier.ts extractResetAt+ModelErrorDTO+buildErrorLogItem 全链）、断流关键词（provider_error 规则体）、lastWasFinalText（pi-rpc-driver 两入口）、maybe_auto_recover_failed_turn（auto_resume.py+close_run_steps 调用点）、QUOTA/RESUME_NUDGE_PROMPT、origin（agent model 两处+scheduled_send G10+_handle_busy_turn）、autoRecoverHint（turn-timeline+run-error-item）、silent stream truncation（daemon 合成+前端推导+归类关键词三方一致）。覆盖无缺口。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src/model-error、sillyhub-daemon/src、sillyhub-daemon/tests/model-error）找到 3 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/model-error/classifier.test.ts）
- ✅ task-02: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-03: 模块目录（backend/app/modules/daemon、backend/app/modules/agent、backend/migrations/versions、backend/app/modules/daemon/router、backend、frontend/src/lib）找到 87 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-04: 模块目录（backend/app/modules/daemon/session/service、backend/app/modules/daemon/run_sync/service、backend/app/modules/daemon/tests）找到 10 个测试文件（backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py …）
- ✅ task-05: 模块目录（backend/app/modules/daemon、backend/app/modules/daemon/session/service、backend/app/modules/daemon/tests）找到 22 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/conftest.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py …）
- ✅ task-06: 模块目录（frontend/src/components/daemon/session-panel、frontend/src/components/daemon、frontend/src/components/agent-log、frontend/src/components/agent-log/__tests__）找到 14 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx、frontend/src/components/daemon/__tests__/attachment-chips.test.tsx …）
- ✅ task-07: 模块目录（backend/app/modules/daemon/tests、.sillyspec/docs/sillyhub-daemon/modules、.sillyspec/docs/backend/modules、.sillyspec/docs/frontend/modules）找到 17 个测试文件（backend/app/modules/daemon/tests/conftest.py、backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️
  （agent 核注：跨模块装配由 task-07 六场景集成测试覆盖（真实 DB 全链），非盲区）

#### 探针 4：决策追踪覆盖
D-001~D-011（含 D-002/004/008/009 @v2 superseded 链）全部有 FR→Task→测试证据闭环，见下方决策追踪矩阵；无悬空决策。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 2783 backend endpoints (live [scan-root 598 + worktree 0] + artifact 2392), 0 frontend calls [scope: change-diff (97 files @ worktree)] | 828 backend endpoints unused by frontend
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 828 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/conflict-compare-wrong-status-root.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/docs-gate-shared-worktree-parallel-block.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/platform-spec-junction-migration-split.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/platform-sync-progress-rollback-and-db-corruption.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/pre-commit-autofix-swallows-commit.md`（git 状态 D）
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定
  （agent 判定：五个 D 文件为并行会话把工具缺陷文档移入 docs/sillyspec/finished/（工作树有同名未跟踪新增成对出现），非本变更触碰的文件（本变更提交 2842fd594 不含 docs/sillyspec/ 路径），不判 FAIL blocker）

## 测试结果 [层：确定性检查——CLI 实测对账]

- 相关面套件（主仓实测）：backend 五套件 49 绿（auto_recover_failed_turn 16+auto_recover_integration 6+auth_transient 6+scheduled_send_sweeper 18+auto_resume_integration 3）；daemon 三套件 71 绿（classifier 32+pi-turn-result 39 含新增；全量 4130 过——multi-runtime 全量并发负载超时、单独 8/8 绿非回归）；frontend 322 绿（normalize 94+auto-recover 7+run-error-item 46+scheduled-bar 11+dialog 58+queue 18+pre-session/offline 40 等）+tsc 0。
- lint：真实仓全链 exit 0（backend ruff「All checks passed」+mypy 937 文件零问题 / daemon typecheck 0 / frontend eslint 0 仅 1 条预存 warning）；沙箱 lint 假败（临时目录无 node_modules 致 pnpm lint 不可跑）按 75e579d88/39d13bd4c 先例 advisory 留痕（SILLYSPEC_VERIFY_LINT_GATE=advisory）。
- 全量 commands.test 由 CLI 在本步骤 --done 统一执行对账。

## 决策追踪矩阵 [层：人工判断]

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001 | FR-1.1 | task-01 | classifier.ts 门控移除+classifyClaude→classifyBlob；codex 429 归 quota_exceeded 用例（原 unknown 断言随语义更新） | 已落地 |
| D-002@v2 | FR-1.2/1.3 | task-01/03 | extractResetAt 中文「将[在于]…重置」+08:00；英文变体/残缺格式→null 用例；wire reset_at 键映射 camel 剔除 | 已落地 |
| D-011 | FR-1.4 | task-01 | provider_error 断流关键词；Stream ended without finish_reason 主实证归 provider_error 用例；pi rpc timeout 命中既有 timeout 规则核验 | 已落地 |
| D-003 | FR-2.1~2.3 | task-02 | message_end 边粒度两入口+判定仅 !lastWasFinalText；五组正反例（[text,thinking] success 反例） | 已落地 |
| D-004@v2 | FR-3.1 | task-04 | auth 类并入统一判定序（旧 _maybe_autoretry_auth_transient_turn 删除迁入）；auth 套件 6 例语义更新全绿 | 已落地 |
| D-005 | FR-3.3/3.4 | task-04 | RESUME_NUDGE_PROMPT 不含原任务（集成场景2「把登录模块重构完」不在 nudge 文案断言） | 已落地 |
| D-006 | FR-3.5 | task-04/07 | dispatch_at=reset_at+120s 断言（容差 2s）；quota 场景 sweep 派发 dispatched+打标 | 已落地 |
| D-007 | FR-3.4/3.5 | task-04 | 紧链 2（含当前节点口径）/quota 连续链 3 断链用例——口径偏差 P2 记录 | 已落地 |
| D-008@v2 | FR-3.7/4.1 | task-03/05 | origin 列 migration；scheduled_send G10（superseded cancelled 用例）+inject 加参转发+_handle_busy_turn 忙轮 origin（R-08 用例） | 已落地 |
| D-009@v2 | FR-5.0~5.2 | task-06 | 双信号推导（无条目/origin 不匹配→undefined 用例）；onEntriesChange 回调（保 R4，P2 记录） | 已落地 |
| D-010 | FR-3.2 | task-04 | 空轮（无 user_input）不恢复用例 | 已落地 |

## 技术债务 [层：人工判断]

- P2：分支 A（quota）空轮守卫与 design G0 字面偏差（quota nudge 固定文案不受影响）——后续若 nudge 改用原文需补守卫。
- ESLint 1 条预存 warning（frontend 'partial' is defined but never used，非本变更引入，行 66）。
- daemon 改动生产生效需 pnpm bundle+重新部署镜像（部署提醒，非代码债）。

## 变更风险等级 [层：人工判断]

integration-critical（design 判级属实：真改 daemon/session/run 收敛链；集成回执与 Runtime Evidence 已按门控提供；未做风险等级覆盖）

## Runtime Evidence [层：人工判断]

- 长驻进程启动命令：不涉及（集成验证走真实 DB pytest 全链，无长驻服务新启；daemon 运行时行为由其单测+主仓冒烟覆盖）
- 触碰的服务端点：POST /leases/{lease_id}/runs/{run_id}/result（close_interactive_run——三类故障 payload 直灌入口，daemon 真实上报路径的 backend 侧终点）
- 触发核心路径的请求：集成测试六场景各一次 close+sweep（断言新 run metadata_.auto_resume_of / scheduled dispatched / cancelled superseded / 开关关闭零副作用）
- 进程日志关键片段：integration-run.log（INFO 级——interactive_run_closed ×6 / auto_recover_quota_scheduled / auto_recover_enqueued(kind=replay|nudge) / auto_resume_scheduled_dispatch_skipped_superseded）
- 生命周期终态断言：running→failed（close）→queued/scheduled pending→dispatched（新 run 带 metadata_.auto_resume_of）或 cancelled(superseded)；开关关闭（auto_resume_interrupted=False）全分支零状态变化
- 失败模式排除：恢复路径异常双层 try/except 不影响已 commit 终态（容错用例直证）；用户手动重发→G10 取消防任务两遍（场景4）；链上限达限→交回用户；混布四象限→协议 soft-add 双向忽略（分支 C=现状，旧 daemon unknown 不动作）

## 代码审查 [层：人工判断]

QA acceptance 独立子代理两轮（execute-review-2026-09-12-173746）：初审 1 P1（buildErrorLogItem 漏透 reset_at——quota 提示生产路径失效，测试构造点绕过假绿）→ 修复 046c51da5（主分支+usage-limit 分支透传+三条链路回归）→ 复验 PASS（147 测试+tsc 0，reset_at 契约链全线贯通）；三条必查（跨 task 契约链/design 整体/组装测试）全过；P2 三项记录（同设计一致性节）。总体评价：实现与 design v3 高度一致，守卫复用面与先例锚点全部核实，无遗留阻断项。
