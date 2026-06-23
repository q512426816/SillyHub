---
schema_version: 1
doc_type: module-card
module_id: docs
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# docs

## 定位

multi-agent-platform 的持久化设计文档与参考资料集合，位于仓库根 `docs/`。承载跨变更共享的设计决策、执行规划、规范对齐分析、外部技术参考整理与功能验收 QA 报告。是纯静态知识库，无运行时代码、无 API，供开发者在各阶段查阅与追溯。与 `.sillyspec/changes/`（单变更临时工作文件）互补：docs 是永久参考，changes 是执行日志。

技术栈：纯 Markdown，无构建。

## 契约摘要

入口：`docs/README.md`（索引）。内容按类型分目录：

- **设计/规划类**（根）：execution-plan-v2-v5.md、claude-loop-v1-p0.md、change-center-redesign.md、spec-alignment.md、agent-sillyspec-stage-execution-analysis.md、sillyspec-tool-side-requirements.md。
- **参考资料**：`docs/sillyhub_refs/`（README + ref-01~05 等外部素材整理，如 Harness Runtime、知识护城河、反虚拟公司 Agent、Take Root Harness、云端 Claude Code Runner、综合设计）。
- **QA 验收**：`docs/qa/`（如 sillyhub-functional-review-*.md，按日期记录功能体验测试结论与问题清单）。

## 关键逻辑

- **定位边界**：docs 是"决策记录与外部参考沉淀"，不是被 scan 当作代码模块扫描的对象，而是设计输入。
- **与 sillyspec scan 的关系**：scan 可能扫到 docs/，但 docs 本身不参与模块依赖图，仅作为背景知识。
- **与 changes 的关系**：changes 中验证通过的设计若具备长期价值，应蒸馏进 docs；docs 不随单变更归档删除。
- **命名约定**：QA 报告按日期命名便于按时间线回顾；参考文章保持与原文的映射便于追溯源头。

## 注意事项

- 文档之间可能存在内容重叠（执行计划 vs 变更方案），需手动维护一致性。
- 参考文章是人工整理摘要，不等同原文完整内容，引用前应核对源头。
- 过期设计文档建议归档到 `docs/archive/`，避免与现行方案混淆。
- 改 docs 不需要跑测试，但应保证 markdown 格式正确、链接可达。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
