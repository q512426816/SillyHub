---
schema_version: 1
doc_type: module-card
module_id: docs
author: qinyi
created_at: 2026-06-04T10:30:00+08:00
---

# docs

## 定位

**docs 模块是 SillyHub 平台的设计决策、技术分析和参考资料集合。**

负责：
- 存放项目设计文档（变更方案、执行计划、规范对齐）
- 沉淀技术参考文章（Harness Runtime、知识库、Agent 模型等外部素材整理）
- 记录功能体验测试报告（QA 问题追踪）

不负责：
- 不存放运行时代码或配置（这些属于 backend/frontend 模块）
- 不替代 .sillyspec/changes/ 中的变更流程文档（docs 是持久化参考，changes 是临时工作文件）
- 不提供 API 接口（纯静态文档，供开发者查阅）

## 契约摘要

**核心能力：**
- 存档项目关键设计决策（如变更中心改造、Agent 与 SillySpec 对接方案）
- 整理外部技术参考（Harness Engineering、知识库设计、云端 Runner 等）
- 记录 QA 测试结论与问题清单（作为验收和追溯依据）

**主要文档分类：**
- 设计类：`change-center-redesign.md`、`spec-alignment.md`、`agent-sillyspec-stage-execution-analysis.md`
- 规划类：`execution-plan-v2-v5.md`、`claude-loop-v1-p0.md`
- 参考类：`sillyhub_refs/ref-*.md`（9 篇参考文章整理）
- 测试类：`qa/sillyhub-functional-review-*.md`

## 关键逻辑

```
docs/ 模块本质是知识库，无运行时逻辑。

输入：
- 设计讨论、外部文章、QA 测试报告
-> 整理、归档、索引
输出：
- .md 文件树，供跨阶段查阅

与 .sillyspec/changes/ 的关系：
- docs/：永久参考，跨变更共享，风格偏"决策记录"
- changes/：临时工作区，单变更专用，风格偏"执行日志"

与 sillyspec scan 的关系：
- scan 会自动扫描 docs/，提取模块边界和约定
- 但 docs/ 本身不是被扫描的"代码模块"，而是"设计输入"
```

## 注意事项

**维护提醒：**
- 设计文档过期后应归档到 `docs/archive/`，避免混淆
- 参考文章（`sillyhub_refs/`）应保持与原文的映射关系，便于追溯源头
- QA 报告建议按日期命名，便于按时间线回顾问题演变

**已知限制：**
- 文档之间可能存在内容重叠（如执行计划与变更方案），需手动维护一致性
- 参考文章是人工整理的摘要，不等同于原文完整内容
- 文档没有版本化管理，依赖 git 历史追溯变更

**修改时需同步检查的模块：**
- 修改设计文档时，需检查 `.sillyspec/changes/` 中是否有正在进行的变更受影响
- 参考文章更新时，需确认 backend/frontend 实现是否仍与文档一致

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
