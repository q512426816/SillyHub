---
author: flow-machine-draft
created_at: 2026-09-27T01:09:37.052Z
---
# 任务注册表（Tasks）— 2026-09-27-prototype-pipeline

> 按 FR-01~07 实际实现路径覆写（agent 任务面）；验收锚在 requirements。
> ✅ 边干边勾：完成一条 = 实现到位 + 相关验证跑绿 → 立即勾 `[x]`。

- [x] task-01: 试点文件迁移收编：视图源码 prototype-demo → `src/components/prototype/`（含 README），编译器 → `scripts/prototype-build.mjs`，package.json 增 `prototype:build`，.gitignore 增 `.build` (FR-01 FR-02)
- [x] task-02: FlowDiagram 原语实现（节点与边 JSON → BFS 分层 SVG，token 着色，零依赖）+ vitest 单测 (FR-03)
- [x] task-03: 流程示例视图：SillySpec 变更流程状态机（轻量道/完整道双泳道）+ 五视图冒烟测试（渲染不崩、关键结构在位） (FR-02 FR-04)
- [x] task-04: 编译器扩展流程视图 + 产物落 `prototype-dist/`（index 含六入口），tsc/eslint 全过 (FR-01)
- [x] task-05: 原型分型规约 `.sillyspec/docs/SillyHub/scan/PROTOTYPE.md`（页面类/流程类/规则类：源方言、产物、批准与晋升） (FR-05)
- [x] task-06: 产物入仓对账：显式 pathspec 提交后重编译 `git diff` 为空；既有业务文件 diff 为零核对 (FR-06 FR-07)
