# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| change | backend/app/modules/change/model.py | 逻辑变更（StageEnum 加 THIN 辅助成员 + spec_auxiliary_stages 返回扩员；无表结构/迁移） | 否 |
| change | backend/app/modules/change/dispatch.py | 逻辑变更（STAGE_AGENT_CONFIG thin 条目 + 白名单 + 守卫 A） | 否 |
| change | backend/app/modules/change/prompts/thin.md | 新增（thin 派发 prompt 模板） | 否 |
| change | backend/app/modules/change/binding.py | 逻辑变更（extract_spec_bindings 识别 flow 命令族） | 否 |
| change | backend/app/modules/change/parser.py | 逻辑变更（_infer_current_stage 增 flow-state.yaml→thin） | 否 |
| change | backend/app/modules/change/service.py | 逻辑变更（_stage_group_order 辅助阶段已知序） | 否 |
| change | backend/app/modules/change/tests/*（test_thin_stage/test_dispatch/test_parser/test_spec_binding/test_step_progress） | 新增/测试断言更新（D-003@v1） | 否 |
| change | backend/tests/modules/change/test_dispatch_stage_config.py | 测试断言更新（计数 6→7） | 否 |
| change_writer | backend/app/modules/change_writer/service.py、proxy.py | 逻辑变更（initial_stage quick→thin 分流；标签不动） | 否 |
| change_writer | backend/app/modules/change_writer/tests/test_classifier.py | 测试断言更新（分流映射 quick→thin） | 否 |
| platform_sync | backend/app/modules/platform_sync/service.py | 逻辑变更（守卫 B：thin 阶段回洗拦截；hunk 隔离 +18/-1） | 是（双变更混排，用户提交时按 hunk 挑选） |
| platform_sync | backend/app/modules/platform_sync/tests/test_thin_stage_guard.py | 新增（守卫 B 三态 + 事件归属对账） | 否 |
| frontend_components | frontend/src/components/changes/change-step-badge.tsx | 逻辑变更（STAGE_KIND 本地 brand kind + STAGE_LABELS） | 否 |
| frontend_components | frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx | 逻辑变更（STAGE_OPTIONS/tab 徽标/副标题存量口径） | 否 |
| frontend_components | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | 逻辑变更（STATUS_BADGE.thin） | 否 |
| frontend_components | frontend/src/components/changes/detail/change-stage-actions.tsx | 逻辑变更（thin 说明卡 + quick 退役文案） | 否 |
| frontend_components | frontend/src/components/changes/detail/change-stage-header.tsx | 逻辑变更（WORKFLOW_STAGE_LABELS 补 thin/quick） | 否 |
| frontend_components | frontend/src/components/workspace/changes-overview-card.tsx | 逻辑变更（BYPASS_BADGES.thin + 两处旁路判断） | 否 |
| frontend_components | frontend/src/components/changes/quicklog-table.tsx | 逻辑变更（空态退役指引 + 表头存量标注） | 否 |
| frontend_components | frontend/src/app/m/workspaces/[id]/changes/page.tsx | 逻辑变更（移动端 STAGE_OPTIONS/tab 徽标/空态） | 否 |
| frontend_components | frontend/src/components/mobile/mobile-change-detail.tsx | 逻辑变更（thin/quick 说明卡双分支） | 否 |
| frontend_components | frontend/src/components/workspace/stats-row.tsx | 逻辑变更（第四卡「快速修复（存量）」） | 否 |
| 配置文档 | .claude/CLAUDE.md、.zcode/skills/sillyspec-quick/SKILL.md | 配置变更（流程指引指轻量变更/存量标注/退役横幅） | 否 |
| docs | docs/sillyspec/finished/thin-flow-quick-retirement.md | 新增（上游工具坑留档） | 否 |
| backend/frontend 模块卡 | .sillyspec/docs/multi-agent-platform/modules/{backend,frontend}{,.changelog}.md | 文档同步（thin 语义/双守卫/视觉条目） | 否 |

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `backend/app/modules/change/*` → 模块索引过期（细粒度 change 卡在 `.sillyspec/docs/backend/modules/` 子目录，根层 _module-map 未含该前缀）——非游离文件，属 scan 分层演进，无需本变更修
- `backend/app/modules/change_writer/*` → 同上（change_writer 细卡在 `.sillyspec/docs/backend/modules/`）
- `backend/app/modules/platform_sync/*` → 同上（platform_sync 细卡同目录）
- `frontend/src/components/*、frontend/src/app/*` → 同上（frontend_components 细卡在 `.sillyspec/docs/SillyHub/modules/`）
- `.claude/CLAUDE.md`、`.zcode/skills/sillyspec-quick/SKILL.md`、`docs/sillyspec/finished/*` → 真游离文件（根层配置/文档，无模块归属语义，正常）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 不增改：未匹配项全部为 scan 分层演进（细粒度卡已存在于 `.sillyspec/docs/backend|SillyHub/modules/`，根层 map 不含子项目细卡属既有形态而非索引缺漏）；游离文件为根层配置/文档无模块语义。如需统一可另立 `sillyspec modules rebuild` 变更，不在本变更范围 | skipped |
| `backend.md` / `backend.changelog.md` | 契约摘要补 thin 阶段语义/双守卫/binding/分流条目 + changelog 索引 | done |
| `frontend.md` / `frontend.changelog.md` | 契约摘要补 changes 组件族 thin 视觉/说明卡/存量标注条目 + changelog 索引 | done |
