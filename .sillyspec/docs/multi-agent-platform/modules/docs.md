---
author: qinyi
created_at: 2026-06-03T00:00:00
---

# docs

## 定位

项目级设计文档和参考资料仓库，存放历史方案设计、执行计划、功能评审记录和外部参考文章整理。这些文档是开发决策的历史记录，非运行时代码。

**负责：**
- 设计方案和改造方案的持久化存档
- 执行计划和里程碑记录
- 功能体验测试报告
- 外部参考文章的本地整理和设计原则提炼

**不负责：**
- SillySpec 文档体系（位于 `.sillyspec/`）
- API 文档（由后端路由和 OpenAPI 自动生成）
- 用户文档或使用手册

## 契约摘要

1. **方案设计文档** (`change-center-redesign.md`): 变更中心从被动扫描改为 Agent 主动执行的设计方案
2. **Agent 分析** (`agent-sillyspec-stage-execution-analysis.md`): Agent 与 SillySpec 阶段执行的深度分析
3. **执行计划** (`execution-plan-v2-v5.md`): V1 P0 完成后的 V2-V5 迭代目标规划
4. **Spec 对齐** (`spec-alignment.md`): SillySpec CLI 与 SillyHub 平台统一方案，一套状态体系双向同步
5. **P0 收尾** (`claude-loop-v1-p0.md`): V1 P0 阶段收尾指令记录（auth + RBAC 已就绪）
6. **QA 测试报告** (`qa/sillyhub-functional-review-2026-05-31.md`): 2026-05-31 功能体验测试报告
7. **参考文章** (`sillyhub_refs/`): 6 篇外部参考文章整理，涵盖 Harness Runtime、知识沉淀、Agent 架构、云端 Runner 等，综合提炼为 SillyHub 设计原则

## 关键逻辑

```
# 文档分类
docs/
├── *.md               → 设计方案、执行计划（按主题命名）
├── qa/                → 功能测试报告（按日期命名）
└── sillyhub_refs/     → 外部参考整理（ref-01~05 + 综合结论 ref-99）
```

## 注意事项

- 这些文档是历史决策记录，不应随意修改已有内容
- 新的设计方案建议通过 SillySpec 变更流程（`.sillyspec/changes/`）管理，而非直接放在 `docs/`
- `sillyhub_refs/` 中的设计原则对整体架构有指导意义，修改核心架构前建议先回顾 `ref-99-sillyhub-design-synthesis.md`
- SillyHub 核心定位总结：受控 AI 工程交付 Harness + 团队知识沉淀系统 + 本地/云端混合 Runner
- `qa/` 目录的测试报告可用于回归验证参考

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
