---
author: qinyi
created_at: 2026-07-28 23:13:54
---

# verify-result — 2026-07-28-ppm-project-link-workspace

## 变更概述

PPM 项目 ↔ 平台工作区多对多关联骨架(A 阶段)。新增关联表 `ppm_project_workspace`(复合主键 + 双向 CASCADE + workspace_id 索引,零 PPM 数据模型改动),link_service 表级逻辑(bind/unbind/list,404 存在性 + 409 重复 + 软删过滤),双边对称 router(工作区侧 WORKSPACE_READ/MEMBER_MANAGE + 项目侧登录可见/_require_project_manager),前端双边 UI(ppm/projects 行内「关联工作区」弹窗 + workspaces/[id]「关联 PPM 项目」区块)。

## 单元测试结论(verify 必做)

按 module 命中范围实测(非全量,test_strategy:module):

| 套件 | 命令 | 结果 |
|---|---|---|
| 后端 workspace+ppm 子集 | `cd backend && uv run pytest app/modules/workspace app/modules/ppm -q --no-cov` | **618 passed, 2 failed**(247s) |
| 前端全量 | `cd frontend && pnpm test` | **118 文件 1146 测试全过**(含新增 6 组件测试) |
| 后端 lint/类型 | `ruff check .` / `ruff format --check .` / `mypy app` | 727 files formatted / 515 source files no issues |
| 前端 lint/类型/构建 | `pnpm lint` / `pnpm exec tsc --noEmit` / `pnpm build` | exit 0 / exit 0 / Next.js 生产构建成功 |

### 2 个失败项分析(pre-existing,非本变更引入)

- `app/modules/ppm/plan/tests/test_service.py::TestPsProjectPlan::test_list_plan_node_details_for_export_filters_by_plan`
- `app/modules/ppm/plan/tests/test_service.py::TestPsProjectPlan::test_create_plan_fills_project_name_from_project`

**证据**:① 本变更 `git diff 5321de76 HEAD -- app/modules/ppm/plan/` 为空(未触碰 ppm/plan);② 在 main HEAD(7b900e22)单独复跑这 2 个用例**同样失败**;③ 属 PsProjectPlan 项目计划模块(他人变更范围,见 memory ppm-data-scope-vs-project-plan-split)。结论:pre-existing 技术债务,与本变更无关,建议 ppm/plan 属主变更跟进。

## 设计一致性(Step 4)

API 契约对 design §7 逐项符合:工作区侧 GET list[PpmProjectBrief](WORKSPACE_READ)/POST 201(MEMBER_MANAGE)/DELETE 204(MEMBER_MANAGE);项目侧 GET/POST 201+_require_project_manager/DELETE 204+manager。功能/数据模型(复合主键+双向 CASCADE+索引+零 PPM 改动)/权限双边全部一致(execute Step 11 QA 子代理 8 checklist 全 pass,本步独立复核端点+权限逐行确认)。Reverse Sync:已将 6 项实现产物补入 design §6 清单(具体 migration 文件名/openapi.json/api-types.ts/2 组件测试/workspace-daemon-switcher fixture 修复)。

## 集成/部署证据门控判定

- **启动入口**(cli.ts/main.ts/server/bootstrap/entrypoint):design/plan 零命中 → 不触发部署级。
- **跨进程/状态机**(session/lease/daemon/lifecycle/heartbeat):design.md:111 明确「不涉及生命周期契约」+ §7.5 豁免(否定语境,A 阶段静态关联表不引入生命周期事件,B 阶段才触及)→ 不触发集成级。

本变更为纯后端 FastAPI router + 前端 UI 的静态 M:N 关联 CRUD,无危险链路,非规避门控。

## 任务完成度(Step 3)/ 验收标准(Step 5)

- L1 自动化:16/16 产出文件存在,关键锚点齐(PpmProjectWorkspace 类/双端点)。
- L2 抽查:execute Step 11 QA 逐文件核对 design vs 实现 8 checklist 全 pass。
- L3 模式性 bug:无(全程测试绿)。完成率 15/15 = 100%。
- 验收标准:TaskCard 的 acceptance 为 YAML 陈述列表(非 checkbox),无「未勾选=不通过」项;实质验收经 QA 全 pass + 各 task verify 命令实跑 + 15 个 review.json 全 pass。

## ⚠️ 已知阻碍:CLI 对账回退全量(工具级矛盾,待用户决策)

verify 最终 --done 时 CLI 在主仓 cwd 亲自执行 local.yaml 测试命令对账:
- `test_strategy:module` 时按**主仓** `git diff --name-only HEAD` 命中 modules.path 判定子集;
- 本变更代码全在 worktree(已 commit),主仓 diff 仅含 `.sillyspec/` 文档(不命中任何代码模块)→ **hitCount=0 → 回退全量 commands.test**;
- 全量 = backend `pytest -q`(~12min 超 TEST_TIMEOUT_MS,且含 ppm/plan 2 预存失败 + 预存 errors)→ exit≠0 → **阻断 verify 完成**。

这是 sillyspec worktree 模式与主仓对账的流程矛盾(见 memory sillyspec-324-verify-archive-pitfalls「main backend 全量预存 errors 用子模块粒度规避」——但子模块规避需主仓 diff 命中,worktree 模式下不成立)。同时 worktree apply 因**主工作区 baseline 漂移**(cec07a75→c6b9b85e)不能直接 patch apply,CLI 建议 `--merge` 降级(引入合并提交)。

**待决策方向**(均涉及流程顺序/门控权衡,不自行规避):
1. 先 `sillyspec worktree apply --merge` 合进主仓 + commit,再处理 verify 对账(但主仓 commit 后 diff 仍空,对账仍回退全量——不解决根本);
2. 调整 local.yaml 使全量 commands.test 在预存失败下仍判通过(需工具支持 exclude/预期失败标记,或收窄 commands.test 到稳定子集);
3. 接受工具缺陷,记录到 docs/sillyspec/(活跃坑),verify 结论按实测证据判 PASS,对账阻断项人工说明。

## 结论

PASS WITH NOTES

功能/设计一致性/单元测试全部通过,2 个后端失败为 pre-existing(与本变更无关,已实证)。

CLI 对账回退全量阻断(sillyspec worktree 模式工具级矛盾,非本变更代码问题)已按**用户决策(2026-07-28):记为工具坑,人工判 PASS 继续**,记录到 `docs/sillyspec/verify-worktree-mode-test-reconciliation-fallback-full.md`(活跃坑,待 sillyspec 修复对账 cwd 用 worktree / 全量支持排除预存失败 / 0 命中不静默回退)。本变更不绕过门控——实测证据(子模块 618 passed 含 workspace link 全测 + 前端 1146 passed + lint/typecheck 全绿)支撑 PASS,对账阻断项如实记录在此,继续 archive 流程。
