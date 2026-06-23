---
schema_version: 1
doc_type: module-card
module_id: sillyspec
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# sillyspec

## 定位

multi-agent-platform 采用的文档驱动变更管理规范体系，落地在仓库根 `.sillyspec/`。它定义变更生命周期（scan → brainstorm → propose → plan → execute → verify → archive，外加 quick 快速通道）、目录结构、状态机与工作流模板，是整个 monorepo "文档先于代码"硬性规则的载体。不执行代码、不调度 Agent，只提供流程契约与状态源，被 backend/frontend/sillyhub-daemon 的开发流程共同遵守。

技术栈：YAML/Markdown 规范文件 + SQLite（`sillyspec.db` 状态库）+ sillyspec CLI/技能集。

## 契约摘要

- **顶层结构**：`local.yaml`（项目级配置：project/commands/test_strategy/module_paths）、`changes/`（36+ 个变更目录）、`docs/`（按项目分的扫描文档：SillyHub/backend/frontend/sillyhub-daemon/multi-agent-platform）、`knowledge/`（知识库 INDEX + uncategorized）、`projects/`（项目配置 yaml）、`quicklog/`（快速操作日志）、`workflows/`（工作流模板 yaml）、`sillyspec.db`（状态库）。
- **工作流模板**：`workflows/scan-docs.yaml`（并行生成 7 份扫描文档，4 角色 arch/conventions/structure/quality，parallel 模式 max_concurrent=4）、`workflows/archive-impact.yaml`（归档影响分析，2 角色 impact-analyzer/doc-syncer）。
- **变更目录契约**：每个 `changes/<date>-<name>/` 含 proposal.md / design.md / plan.md / tasks.md / decisions.md 等结构化文档，由对应 sillyspec 技能生成与推进。
- **模块文档契约**：`docs/<project>/modules/_module-map.yaml`（模块索引）+ `modules/<id>.md`（模块卡片，含 MANUAL_NOTES 保护区域）。

## 关键逻辑

- **状态源**：变更进度存在 `sillyspec.db`（历史曾用 progress.json，已迁移），current_stage + stages + 步骤级进度驱动流程推进；`local.yaml` 的 test_strategy/module_paths 约束 scan 与 verify 行为。
- **技能编排**：一组 sillyspec-* 技能（init/brainstorm/propose/plan/execute/verify/archive/quick/scan/auto/continue/resume/commit/status/state/doctor/workspace/export/explore）对应流程各阶段，用户经 `sillyspec run <skill>` 或直接调用技能进入。
- **归档蒸馏**：verify 通过后 archive 阶段做模块影响分析（archive-impact.yaml）、生成 module-impact、蒸馏知识到 `knowledge/`、同步 `_module-map.yaml`，再把变更目录移入 archive。
- **模块卡片保护**：模块卡片的 `<!-- MANUAL_NOTES_START/END -->` 区域在 doc-syncer 同步时被跳过，用户手写内容不被覆盖。

## 注意事项

- 硬性规则：禁止无文档改代码、禁止先写代码再补文档；大改动走完整流程，小修复走 quick。
- verify→verify 曾有 `--skip-approval` 绕过误报的坑，状态机相关操作要核对 `.runtime/sillyspec.db` 表结构。
- quick 的 `--done` output 若含换行/特殊字符会致 step 静默不记录，建议用单行 ASCII；default change_id 非固定需查 changes 表。
- worktree 从最新 commit checkout，不含主工作区未提交内容，execute 前确认相关改动已 commit。
- 提交被 pre-commit hook 拦截禁止跳过，需解决问题再提交。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
