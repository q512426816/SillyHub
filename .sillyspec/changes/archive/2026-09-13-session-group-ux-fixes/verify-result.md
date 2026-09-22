# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

## 结论 [层：人工判断]

结论枚举：`PASS`——五任务全部完成且 review 双 pass，三 FR 代码层逐条核对满足，前端 459+115 passed / 后端 22+3 passed 全绿，lint/tsc 零新增，integration-critical 集成回执真实执行（双 exit 0），无 FAIL blocker。

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]

无——五 task review 均为双 pass，无 cannot_verify 任务。

## 集成验证回执 [层：自述声明——CLI 一致性校验]

- claim: FR-3 后端群列表可见工作区集合在真实 DB + 真实 app router 下集成验证通过（双工作区关联群可见集恰为 {D,F}、无项目群仅直接归属、非成员不可见） | command: `cd <worktree>/backend && uv run pytest tests/modules/daemon/test_group_visible_workspaces.py -q --no-cov` | exit: 0 | log: .sillyspec/changes/2026-09-13-session-group-ux-fixes/integration-backend.log
- claim: FR-1/FR-2/FR-3 前端关键面（草稿隔离时序 + pointer 拖拽 + 集合过滤渲染）jsdom 集成验证通过 | command: `cd <worktree>/frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-draft-scope.test.tsx src/components/daemon/__tests__/session-input-bar-height.test.tsx src/components/sessions/__tests__/session-list-panel.test.tsx` | exit: 0 | log: .sillyspec/changes/2026-09-13-session-group-ux-fixes/integration-frontend.log

## 任务完成度 [层：人工判断]

- task-01 预会话草稿按入口隔离：**完成**——turn-state 三函数 preScope 三分支落地，page/dialog 双消费方传 scope，10/10 新测试 + 相关面 213/214（唯一失败为既有 flaky platform-shared，主仓基线同样失败、双方复跑均过，与草稿路径无关）。
- task-02 拖拽 Pointer Events：**完成**——两副本迁移（不用 setPointerCapture，window 级监听），测试 pointer 化 + group 侧新增两用例，68/68 全绿。
- task-03 后端可见集合：**完成**——crud 批量 IN 辅助 + router 端点层组装（去重保序），新测试 3 passed + 群系回归 19+36 passed。
- task-04 gen:types 与前端过滤：**完成**——api-types+openapi 重生成，两消费点集合判定（?? 兜底），三处建群归一占位（类型级联，allowed_paths 已补录对账），相关面 322+31 passed。
- task-05 验证收口：**完成**——QA 子代理全量验证（前端 459 / 后端 22 / ruff+mypy+lint+tsc 全绿），FR 逐条代码层核对满足，问题清单无。

五任务 review.json 双 pass，tasks.md checkbox 5/5（CLI 按 review 勾选）。

## 设计一致性 [层：人工判断]

**一致（含两处已对账偏差）**：
- FR-1 键三分支与 design 接口定义逐字吻合；effect 依赖数组有意排除 preScope（design 未明示，任务卡预评估结论 + 代码注释留依据：入依赖会把旧入口输入迁移写进新入口键，恰是 D-001 要消除的串台）。
- FR-2 与 D-002@v2 一致（不用 setPointerCapture）。
- FR-3 落点与 Grill 修正版一致（router 层字段+组装、crud 只加辅助、GroupChatRead 本体不动）。
- 偏差一（已对账）：三处建群归一构造（m 页面/floating/portal）补占位 visible_workspace_ids——gen:types 后字段必填的类型级联，design 文件清单小遗漏，行为正确（新建群无项目=直接归属，与后端口径一致），task-04 allowed_paths 已补录。
- 偏差二（已对账）：task-03 import 走子模块直取（service/__init__ 聚合面外），仓内有先例（backend/app/modules/daemon/permission_service.py:1183），import 处注释留痕。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx——手动核验：worktree 内该文件存在且实跑 11 passed，非 TODO。
- ℹ️ 1 个清单文件主仓不存在、已从 worktree 读取（NEW: 后端测试文件，apply 前正常形态）

#### 探针 2：设计关键词覆盖
- `__pre__:<preScope>` 键组装 → turn-state.ts sessionDraftLsKey ✅（grep 命中实现+注释）
- `preScope` 传参 → session-panel-page.tsx / session-panel-dialog.tsx ✅
- `PointerEvent`/`pointermove`/`pointerup` → session-input-bar.tsx / group-chat-panel.tsx ✅（且全文件无残留 mousemove/mouseup 监听）
- `visible_workspace_ids` → router.py（字段+组装）/ api-types.ts / session-list-panel.tsx / mobile-session-list.tsx ✅（生产→消费全链贯通）
- `get_project_workspace_map` → crud.py 定义 + router.py 调用 ✅
- `?? [g.workspace_id]` 兜底 → 两消费点过滤 ✅

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（frontend/src/components/daemon/session-panel、frontend/src/components/daemon）找到 10 个测试文件（activity-catalog / agent-log-card / agent-task-card-lifecycle / agent-task-card / attachment-chips 等）——核心新增 session-panel-draft-scope.test.tsx 10 用例（键三分支/切换时序/入口隔离/同入口恢复/dialog 三态）实跑全绿
- ✅ task-02: 模块目录（frontend/src/components/daemon、frontend/src/components/group-chat、frontend/src/components/daemon/__tests__）找到 13 个测试文件——session-input-bar-height 4 用例 pointer 化 + group-chat-panel 新增拖拽 describe 2 用例实跑全绿
- ✅ task-03: 模块目录（backend/app/modules/daemon/group/service、backend/app/modules/daemon/group、backend/tests/modules）找到 22 个测试文件——核心新增 test_group_visible_workspaces.py 3 断言实跑全绿
- ✅ task-04: 模块目录（frontend/src/lib、backend、frontend/src/components/sessions、frontend/src/components/mobile 等）找到 77 个测试文件——session-list-panel 新增 D-003 过滤断言 + 四 mock 文件补字段后实跑全绿
- ✅ task-05: 模块目录（frontend/src/components/daemon、backend/app/modules/daemon/group）找到 10 个测试文件（验证收口任务本体为全量执行）
- ⚠️ 集成盲区标注：Next.js 路由级装配（m/[id]/sessions 页面）已有 page.m-sessions.test.tsx 11 用例覆盖（含建群向导归一断言）；后端 FastAPI 路由装配经真实 app client 集成测试覆盖（非 mock router）；未覆盖盲区=真实浏览器触摸事件（jsdom PointerEvent 为合成事件，真机触摸留待用户实测，风险 R-02 已评估 Pointer Events 基线全绿）。

#### 探针 4：决策追踪覆盖
见下方决策追踪矩阵——D-001/002@v2/003/004 全闭环；D-002@v1 被 v2 supersede（矩阵未映射行已注明）。

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 594 backend endpoints (live [scan-root 598 + worktree 598] + artifact 0), 0 frontend calls [scope: change-diff (22 files @ worktree)] | 203 backend endpoints unused by frontend
- ℹ️ 203 个未调用端点为平台存量（admin/roles 等本变更未触碰域），与本变更无关；本变更唯一契约变更 = GroupChatListItemRead 增字段（纯增量，探针通过）。

#### 探针 6：代码删除对账
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/conflict-compare-wrong-status-root.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/docs-gate-shared-worktree-parallel-block.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/platform-spec-junction-migration-split.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/platform-sync-progress-rollback-and-db-corruption.md`（git 状态 D）
- ⚠️ 未声明删除（design 清单未列出） `docs/sillyspec/pre-commit-autofix-swallows-commit.md`（git 状态 D）
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定——**归因：5 条均非本变更加载**（其他会话将 docs/sillyspec/ 活跃坑记录移动至 docs/sillyspec/finished/ 的归档操作，git status 快照在 execute 启动前已存在，module-impact.md 已判定「非本变更文件」；docs/sillyspec/finished/ 的 ?? 对应文件即其去向）。本变更 worktree 两 commit（c70030875 + 6aa738c5b）零删除文件。不构成 FAIL blocker。

## 测试结果 [层：确定性检查——CLI 实测对账]

| 命令 | 结果 |
|---|---|
| worktree frontend: vitest 草稿+拖拽+群聊/列表/m 页相关面（task-05 全量+verify 复跑） | 459 passed + 复跑 115 passed，0 failed |
| worktree backend: pytest group/visible 系 | 19+3 passed，0 failed（warnings 9 条为既有 HTTP_422 弃用噪音） |
| worktree frontend: tsc --noEmit | exit 0 |
| backend: ruff check + format --check（group 模块） | All checks passed / already formatted |
| backend: mypy（router.py + crud.py） | no issues |
| frontend: next lint --file（四改动文件） | exit 0，12 warning 全为既有（行号位移，与主仓基线逐条对照） |

known_failures：无豁免项。唯一波折=主仓 node_modules 半坏（CSSProperties 假报错）已在 execute 期 pnpm install --force 修复，与代码无关。

**noAI 沙箱实测假败说明（2026-09-13 05:00 真实仓复验）**：
1. 前端模块子集 `TypeError: reading 'length'` = session-panel-platform-shared.test.tsx 既有 flaky——主仓基线（无本变更）execute 期同样偶发一次、双方复跑均过；verify 期主仓单独复跑 exit 0 通过（2026-09-13 05:00:24，Duration 16.65s）。与本变更草稿路径无关（渲染崩溃在平台共享徽标）。
2. lint 链退出码 2 = 隔离快照环境假败：真实仓全链复验 exit 0（backend `ruff check .`=All checks passed / `ruff format --check`=1257 files already formatted / `mypy app`=no issues in 942 files；frontend `pnpm lint`=exit 0 仅既有 Warning；daemon `pnpm typecheck`=exit 0）。快照输出末尾的 taskId/req/partial unused 系主仓既有 Warning（真实仓同样存在且不阻断）。先例：dbce26d57 / 75e579d88 lint 沙箱假败 advisory 留痕。按先例以 SILLYSPEC_VERIFY_LINT_GATE=advisory 跳过实测（审计留痕）。

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]

| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-1 | task-01、task-05 | turn-state.ts 键三分支实现+注释引用；draft-scope.test 10 用例（含入口隔离断言）；task-01 review 双 pass | 闭环 |
| D-002@v1 | FR-2（被 v2 取代） | task-02 | 已被 D-002@v2 supersede，不单独回指 | superseded |
| D-003@v1 | FR-3 | task-03、task-04、task-05 | router.py 字段+组装+docstring 引用；test_group_visible_workspaces 3 断言；前端两消费点 includes+D-003 注释；双 task review pass | 闭环 |
| D-004@v1 | FR-1/2/3（方案 A 组织） | task-01~05 全部 | plan.md 三 Wave 按方案 A 组织；五 task review 双 pass；acceptance 审查 pass | 闭环 |
| D-002@v2 | FR-2 | task-02（v1 同卡，版本演进同卡承载） | 两文件 pointer 迁移注释直接引用 D-002@v2；无 setPointerCapture（acceptance 审查 grep 核验）；group-chat-panel 拖拽测试 2 用例 | 闭环 |

## 技术债务 [层：人工判断]

探针 1 零命中，无新增 TODO/FIXME/HACK。既有债务（非本变更引入）：session-panel-platform-shared.test.tsx「平台共享徽标」flaky（主仓基线同样偶发）；203 个后端端点前端未调用（平台存量）。旧 `__pre__` localStorage 键遗留不清理（design 非目标，用户下次输入自然写新键）。

## 变更风险等级 [层：人工判断]

integration-critical（CLI 判级命中 session/backend/daemon 关键词，未显式覆盖）。判定合理：backend 群列表端点真实改动（daemon/group 路由）+ 前端会话组件族。Runtime Evidence 已按此等级提供真实集成回执（双 exit 0）。lease/agent_run/lifecycle 关键词命中为同句否定语境抑制（design 生命周期契约表豁免段），实际零生命周期改动，抑制正当。

## Runtime Evidence [层：人工判断]

- 2026-09-13 04:35 `uv run pytest tests/modules/daemon/test_group_visible_workspaces.py -q --no-cov`（worktree backend，真实 SQLite + 真实 FastAPI app client）→ 「3 passed, 9 warnings in 14.43s」exit 0。断言覆盖：群挂项目（关联 D/F、锚 D）→ 列表项 visible_workspace_ids 恰含 {D,F}；无项目群 → [workspace_id]；非成员列表为空。
- 2026-09-13 04:35 `pnpm exec vitest run`（worktree frontend，draft-scope + input-bar-height + session-list-panel 三文件）→ 「Tests 115 passed (115)」exit 0。断言覆盖：真会话切换草稿不串台（R-01 时序锁定）、预会话两入口隔离、pointer 拖拽高度+钳制+持久化、跨工作区群列表渲染+旧缓存退化。
- commit 链：worktree 分支 sillyspec/2026-09-13-session-group-ux-fixes，baseline 79ceacd7 → Wave1 c70030875（11 文件 +983/-42）→ Wave2 6aa738c5b（11 文件 +126/-8）。
- 不涉及：daemon 进程启动、WebSocket 生命周期、部署管线（本变更纯 HTTP 读路径扩展 + 前端交互，无 daemon 协议/启动项改动）。

## 代码审查 [层：人工判断]

- execute 阶段已过双重审查：五 task 级 review（实现者汇报+主代理 diff 抽查）+ stage 级 acceptance 独立 QA 子代理审查（6 项全 pass：三 FR 对照/跨 task 契约/22 文件组装对账/冒烟）。
- 问题清单：无 blocker。两条留痕观察已处理：design 决策表 D-002 版本号已同步 @v2；pytest 弃用 warnings 为既有噪音。
- 总体评价：改动面聚焦（22 文件对 design 清单全落位）、契约纯增量（老客户端零破坏）、注释携带决策编号可追溯，符合生产级标准。
