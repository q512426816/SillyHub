# 模块影响分析（execute 期按真实 diff 重写，2026-10-21）

> 骨架由 `sillyspec module-impact --change <变更名>` 生成，但其文件面来自 worktree 基线 overlay（含并行会话在途文件）。execute 收口时按**真实 diff**（`git diff <main HEAD at apply>..HEAD`，84 文件；apply 到主仓后 40 文件生效 + 后续补提交 24 文件）逐行回填。
> 影响类型取值：逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增。

## 模块影响矩阵

| 模块 | 变更文件（代表） | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/daemon/{model.py,schema.py,service.py}`、`lease/service.py`、`router/{lease.py,session_insights.py,__init__.py}`、`run_sync/service/{__init__.py,close_run_steps.py}` | 数据结构变更（新侧表 `daemon_run_snapshots`）+ 接口变更（`SessionRunRead` 加 3 字段 / `InteractiveRunResultRequest` 加 3 可选字段）+ 调用关系变更（终态 no-op 分支补写侧表，D-030） | 是（已由 task-08 契约测试 + execute 期独立审查覆盖） |
| backend | `backend/openapi.json`、`backend/migrations/versions/20261021120000_add_daemon_run_snapshots.py` | 接口变更（生成物重生成）+ 新增（迁移，单头 `20261021120000`） | 是（生成物禁止手改，已由 `dump_openapi.py` 重生成） |
| backend | `backend/tests/test_align_platform_change_events_migration.py` | 配置变更（迁移链尾锚随新迁移前移，D-033） | 否（守护测试，7 passed） |
| components-daemon | `frontend/src/components/daemon/turn-timeline.tsx` | 接口变更（`SessionTurnView` 加 `fileChanges?`/`fileChangesCapability?`；`TurnTimelineProps` 加 `fileChangesSummary?`）+ 逻辑变更（轮级卡挂载 + 会话级汇总） | 是（task-11 53 例 + 独立审查） |
| components-daemon | `frontend/src/components/daemon/file-changes/*`（`file-changes-card.tsx` 改；`turn-file-changes.ts`、`file-changes-summary.tsx` 新增；3 个测试文件） | 新增 + 逻辑变更（映射三分法、降级卡、汇总去重） | 是 |
| components-daemon | `frontend/src/components/daemon/trajectory/*`（`build-trajectory.ts`、`trajectory-timeline.tsx` 改；`zoom.ts`、`trajectory-view.tsx` 新增；3 个测试） | 逻辑变更（`modelBasis` observed/approx 分支）+ 新增（泳道/缩放/视图） | 是（task-12 61 例） |
| components-daemon | `frontend/src/components/daemon/{turn-segment-views.tsx,attachment-chips.tsx,turn-fold.ts,process-labels.ts}` | 逻辑变更（线 A 字阶/去框/语义标签；折叠能力落盘未接线） | 否（既有断言锁死数值） |
| components-daemon | `frontend/src/components/daemon/__tests__/*`（6 个测试文件） | 逻辑变更（断言随线 A/D-025 词表同步） | 否 |
| components-sessions | `frontend/src/components/sessions/session-list-panel.tsx` | 逻辑变更（线 A 左栏扫描性：内边距/时间 9.5px/chip 9px/轮数右贴） | 否（119 例绿） |
| components-shared | `frontend/src/components/{app-shell.tsx,top-bar.tsx}` | 接口变更（`AppShellPreview` / `workspacePreview` 可选入参，缺省等价旧行为） | 否 |
| components-workspace-config | `frontend/src/components/workspace-switcher.tsx` | 接口变更（`WorkspaceSwitcherPreview` 可选） | 否 |
| components-chat | `frontend/src/components/chat/round-divider.tsx` | 接口变更（`detail?: string`，缺省零视觉变化） | 否 |
| frontend（原型/dev 路由） | `frontend/src/app/proto/{session-redesign,session-trajectory,session-file-changes}/*`（10 新文件） | 新增（dev-only 路由，生产零引用） | 否（D-010/D-017：只作留档与评审） |
| frontend（原型管线） | `frontend/scripts/{export-hydrated.mjs,prototype-build.mjs}`、`frontend/prototype-dist/*.html`（9 改 1 新）、`frontend/src/components/prototype/session-fold-view.tsx`、`frontend/e2e/proto-file-card.spec.ts` | 新增 + 产物重生成（禁止手改，由脚本重跑） | 否（导出脚本机械校验：138 正文块 / turn-block 无边框 + pb-7） |
| lib-api | `frontend/src/lib/api-types.ts` | 接口变更（`pnpm gen:types` 生成：+108 行，含 `file_changes`/`file_changes_capability`/`timing`） | 是（生成物，禁手改） |
| sillyhub-daemon | `sillyhub-daemon/src/interactive/{turn-file-changes.ts,turn-file-changes-types.ts,turn-timing.ts}`（新增）、`session-manager.ts`（接线） | 新增 + 逻辑变更（每轮快照采集 / TTFT 派生 / 轮尾异步上报） | 是（task-09/10 共 59 例 + 独立审查） |
| sillyhub-daemon | `sillyhub-daemon/src/{daemon.ts,hub-client.ts,api-types.ts}` | 接口变更（上报 payload 加可选 `file_changes`/`timing`/`daemon_version`，存在才写） | 是（wire 级测试 5 例） |
| sillyhub-daemon | `sillyhub-daemon/package.json`、`tests/version.test.ts`、`tests/interactive/*`（4 新） | 配置变更（发版 0.1.1→0.2.0）+ 新增测试 | 否 |
| styles | `frontend/src/app/globals.css` | 逻辑变更（`.seg-text-body` 15px/1.8/0.65em + 标题/行内 code 上浮；块序在 mobile 覆盖块之前） | 否（93 例断言锁死） |

## 未匹配文件（判定结论：均属「合法未登记面」，无需 modules rebuild）

- `.claude/skills/sillyspec-flow/SKILL.md`、`.openclaw/**`、`.opencode/**` —— **非本变更改动**：来自 worktree 基线 checkpoint 捕获的并行会话在途文件，已在本分支提交 `chore(worktree): 回退基线 checkpoint…` 全部恢复为主仓版本，真实 diff 中不再出现（`module-impact` 骨架生成于回退之前，故残留）。
- `frontend/.sillyspec/quicklog/QUICKLOG-WhaleFall.md` —— 同上，非本变更改动，已恢复。
- `locals`：无。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 聚合卡无需改：实现面增量已落在子模块卡 `backend/modules/daemon.md`（+33 行「run 快照读模型」段） | skipped（聚合卡无契约变化） |
| `modules/components-daemon.md` | 扩写「会话轨迹视图」段（+31 行：泳道 observed/approx、轮级卡三分法、汇总卡、挂载/透传锚点） | done |
| `modules/components-sessions.md` | 未改：线 A 左栏视觉微调不改变卡内契约（119 例回归即证据） | skipped（无契约变化） |
| `modules/components-shared.md` | 未改：`AppShellPreview`/`workspacePreview` 为可选入参、缺省等价旧行为，卡内接口段无需变更 | skipped（可选入参向后兼容） |
| `modules/components-workspace-config.md` | 未改：`WorkspaceSwitcherPreview` 同上 | skipped（可选入参向后兼容） |
| `modules/frontend.md` | 未改：原型 dev 路由属 dev-only，不影响产品模块契约 | skipped（dev-only 面） |
| `modules/lib-api.md` | 未改：`api-types.ts` 是 `pnpm gen:types` 生成物，契约描述归 backend `daemon.md` 新段 | skipped（生成物，源头卡已更新） |
| `modules/sillyhub-daemon.md` | 未改聚合卡：增量已落在子模块卡 `sillyhub-daemon/modules/interactive.md`（+52 行「每轮工作区快照与 TTFT/attempt 采集」段） | skipped（聚合卡无契约变化） |
| `modules/styles.md` | 未改：`globals.css` 字阶数值属既有 D-021 结论，卡内样式契约未变 | skipped（数值已由断言锁定） |
| `modules/test-utils.md` | 未改：测试文件只随词表/断言同步，无测试工具契约变化 | skipped（无工具契约变化） |
| `_module-map.yaml` | 无需 rebuild：未匹配项全部为「非本变更文件」或 dev-only/测试面，模块索引本身无缺口 | done（判定完成） |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
