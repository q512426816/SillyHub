# 模块影响分析（骨架由 `sillyspec module-impact --change <变更名>` 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> 影响类型与 review 标记为语义判断，以 git diff 为准（真实 > 声明）。
> 本版=plan 阶段首版（当前工作树状态）；execute 落码后矩阵按 design.md 文件清单扩展（backend 4 改 1 增 / daemon 4 改 1 增 / frontend 7 改 3 增）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| frontend | `frontend/prototype-dist/change-center.html` | 构建产物重编译（VIEWS 变更触发全量重编，与源码同源） | 否（产物禁手改，重编译对账） |
| frontend | `frontend/prototype-dist/change-detail-v2.html` | 同上 | 否 |
| frontend | `frontend/prototype-dist/change-detail.html` | 同上 | 否 |
| frontend | `frontend/prototype-dist/conflict-sync-states.html` | 同上 | 否 |
| frontend | `frontend/prototype-dist/index.html` | 同上（索引页含新条目） | 否 |
| frontend | `frontend/prototype-dist/session-fold.html` | 同上 | 否 |
| frontend | `frontend/prototype-dist/session-portal.html` | 同上 | 否 |
| frontend | `frontend/prototype-dist/sillyspec-flow.html` | 同上 | 否 |
| frontend | `frontend/prototype-dist/trajectory-redesign.html` | 同上 | 否 |
| frontend | `frontend/prototype-dist/workspace-list.html` | 同上 | 否 |
| frontend | `frontend/prototype-dist/workspace-overview.html` | 同上 | 否 |
| frontend | `frontend/scripts/prototype-build.mjs` | 配置变更（VIEWS 数组登记 session-stage-progress-view） | 否 |
| frontend | `frontend/src/components/prototype/session-stage-progress-view.tsx` | 新增（真码原型视图，brainstorm 产物） | 否 |
| frontend | `frontend/prototype-dist/session-stage-progress.html` | 新增（原型编译产物） | 否 |

## 非本变更文件（并行会话遗留，不纳入本变更提交）

- `.claude/skills/sillyspec-config/SKILL.md`（会话开始前已在工作树，属其它变更）
- `.claude/skills/sillyspec-push/`（同上，untracked）

## execute 阶段将扩展的矩阵（design.md 文件清单，预告）

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/daemon/schema.py` | 接口变更（TurnPhaseReportRequest DTO） | 是（协议契约） |
| backend | `backend/app/modules/daemon/router/notify.py` | 接口变更（新端点） | 是 |
| backend | `backend/app/modules/daemon/run_sync/service/publish.py` | 逻辑变更（新 helper） | 否 |
| backend | `backend/app/modules/daemon/control_commands.py` | 调用关系变更（翻转点挂发布） | 是（挂点=D-011） |
| backend | `backend/app/modules/daemon/tests/test_turn_phase_events.py` | 新增（测试） | 否 |
| backend | `backend/openapi.json` | 数据结构变更（gen:types 源） | 否 |
| sillyhub-daemon | `sillyhub-daemon/src/hub-client.ts` | 接口变更（notifyTurnPhase） | 否 |
| sillyhub-daemon | `sillyhub-daemon/src/daemon.ts` | 逻辑变更（五阶段上报，god 文件防回归 R-07） | 是 |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/session-manager/turn-control.ts` | 逻辑变更（inject_received） | 否 |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/session-manager/events.ts` | 逻辑变更（first_event 防重） | 否 |
| sillyhub-daemon | `sillyhub-daemon/src/api-types.ts` | 数据结构变更（gen:types 产物） | 否 |
| sillyhub-daemon | `sillyhub-daemon/tests/turn-phase-report.test.ts` | 新增（测试） | 否 |
| frontend | `frontend/src/lib/daemon/session-sse.ts` | 数据结构变更（信封三键） | 是（键名=D-012） |
| frontend | `frontend/src/lib/daemon/session-stream.ts` | 逻辑变更（case+白名单） | 是 |
| frontend | `frontend/src/components/daemon/session-panel/turn-state.ts` | 数据结构变更（currentPhase+终态清理） | 是（D-013） |
| frontend | `frontend/src/components/daemon/session-panel/session-panel-page.tsx` | 调用关系变更（handler 接线） | 否 |
| frontend | `frontend/src/components/daemon/session-panel/session-panel-dialog.tsx` | 调用关系变更（同上双消费方） | 否 |
| frontend | `frontend/src/components/daemon/turn-timeline.tsx` | 调用关系变更（prop 透传） | 否 |
| frontend | `frontend/src/components/daemon/turn-status-bar.tsx` | 逻辑变更（词表+超时+退位） | 是（对照原型） |
| frontend | `frontend/src/lib/api-types.ts` | 数据结构变更（gen:types 产物） | 否 |
| frontend | `frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx` | 新增（测试） | 否 |
| frontend | `frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts` | 新增（测试） | 否 |

## execute 已落地追加（2026-10-26 task-06，异常可见增补 FR-07/D-014）

| 模块 | 变更文件 | 影响类型 | 需 review | 实际状态 |
|---|---|---|---|---|
| backend | `backend/app/modules/agent/service.py` | 逻辑变更（`_recheck_deferred_runs` 判死路径前插 `_run_awaiting_user_input` 豁免 + 两处 docstring 同步；函数签名零变化） | 是（判活语义，D-014） | 已落地（worktree 7ef1acb1，pytest 19/19 + ruff/mypy 绿） |
| backend | `backend/tests/modules/agent/test_stale_run_recheck.py` | 测试增补（`_add_log` 扩 channel/tool_kind 可选参数 + askwait 三用例：豁免/24h 超龄/已回答判死） | 否 | 已落地（同 commit） |

## archive 三重核对裁决（2026-10-26 step2，diff 32 × impact 24 × map）

- **diff 有而 impact 未列（13）**：全部为 `.sillyspec/knowledge/`（decisions/frontend|backend|sillyhub-daemon|unmapped.md + fr/daemon.md 等）——**archive step1 决策提炼/FR 索引的 CLI 自动产物**（本步同批生成），非 agent 交付面，不补矩阵（登记性质：归档期机器写入）。
- **impact 列而 diff 无（5）**：
  - `frontend/scripts/prototype-build.mjs`——brainstorm 阶段已提交（VIEWS 注册随原型三件套落库），execute/verify 期零改动，diff 空为预期（矩阵「预告」行语义已兑现）；
  - `modules/backend.md`、`modules/sillyhub-daemon.md`、`modules/frontend.md`、`_module-map.yaml`——主仓文档面产物，已在主仓 commit `e458074bc` 落库；三重核对 diff 取 worktree 分支口径故不可见（与 target_files 主仓文档错配同根，工具缺陷已记录 docs/sillyspec/target-files-worktree-docs-mismatch.md）。_module-map.yaml 实际未改（无新模块，rebuild skipped）——从预告矩阵移除预期。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/frontend.md` | 更新 frontend 模块卡（PHASE_LABEL/TurnStatusBar 阶段文案/原型视图登记） | pending（task-05 执行） |
| `modules/backend.md` | 更新 backend 模块卡（TurnPhaseReportRequest/turn-phase 端点/publish helper） | pending（task-05 执行） |
| `modules/sillyhub-daemon.md` | 更新 daemon 模块卡（notifyTurnPhase/五阶段上报） | pending（task-05 执行） |
| `_module-map.yaml` | 无未匹配文件（本变更全部命中既有模块），无需 rebuild | skipped |
