---
author: WhaleFall
created_at: 2026-07-16T12:42:00
---

# 模块影响分析（Module Impact）— 计划节点模板子表样式优化

## 变更范围
`/ppm/plan-nodes` 计划节点模板页子表横向滚动隔离 + 明细列宽压缩。纯样式优化，无后端/数据/接口变更。最终方案（ql-008）：明细/模块子表 `scroll.x` 用固定 790 替代 `max-content`（避免 antd 嵌套 max-content 测量膨胀撑长母表）；DETAIL_COLUMNS 7 列列宽压缩 920→790。经 ql-003/005/007 多轮试错（限宽 overflow 容器→min-w-0→回退）后定型。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| app-ppm-pages | 配置变更（样式）| `frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx` | 明细 PpmSubTable `tableProps.scroll.x=790`；模块 Table `scroll.x=790`；DETAIL_COLUMNS 列宽压缩（120/120/180/160/100/120/120 → 90/100/140/120/80/90/90）| no |
| components-ppm | 无改动（仅引用）| — | `PpmSubTable` 通用组件未改；plan-nodes 仅在调用处传 `tableProps.scroll` | no |

## 三重交叉验证
- 声明范围（design.md §6）：仅 plan-nodes/page.tsx 单文件 → 与真实一致。
- 任务范围（plan.md task-01..04）：plan-nodes/page.tsx → 一致。
- 真实变更（git diff，commits ql-003/005/007/008 = ba92e650/cad3276b/d95cc1a1/1b6edf32）：`frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx` + 模块文档 `app-ppm-pages.md` + QUICKLOG + 变更目录文档 → 真实代码改动集中在 plan-nodes/page.tsx，与声明一致。

## unmapped 文件
- `.sillyspec/changes/2026-07-16-plan-node-subtable-style/*`（变更规范文档，非源码）
- `.sillyspec/quicklog/QUICKLOG-WhaleFall.md`（quicklog）
- `.sillyspec/docs/frontend/modules/app-ppm-pages.md`（模块文档，已同步变更索引 + 注意事项）

## 结论
影响面极小：仅 app-ppm-pages 模块的 plan-nodes 页样式，无后端/数据/接口/组件改动。零回归（PpmSubTable 组件、其他 ppm 页面均未触碰）。模块文档 app-ppm-pages.md 已在 quick 执行期间同步（注意事项 + 变更索引 ql-003/005/007/008）。
