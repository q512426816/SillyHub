---
id: task-03
title: "`PpmResourceTable` toast 语义化 + project_name 加粗 + 搜索按钮分组"
title_zh: PpmResourceTable toast 语义化/名称加粗/按钮分组
author: WhaleFall
created_at: 2026-07-14 11:00:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04, FR-05, FR-06]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/components/ppm-resource-table.tsx
goal: >
  toast/error 换语义色消除 emerald-300 硬编码；project_name 列文字加粗；搜索按钮分两组（数据组导出/新增在左、基础组查询/重置/展开在最右、中间分隔），布局保持现状。
implementation:
  - toast 成功态 `border-emerald-300 bg-emerald-50 text-emerald-700`（~L519）改为语义色（成功用 token 绿语义类，失败沿用 destructive），与下方 error 块统一语义化
  - project_name 列单元格文字加粗：在 columns render 分支（~L423-451）对 name === "project_name" 的文本包 `<span className="font-medium">`，不强制双行合并（G3 YAGNI）
  - 搜索按钮行（~L543-578）重排顺序：左侧数据组（导出 + 新增）→ 中间竖分隔 → 右侧基础组（搜索 + 重置 + 展开），容器仍 `justify-end`、字段网格与 visibleSearchFields 逻辑不动
  - 语义色具体取值对齐 frontend style system token（参考 archived 2026-06-21-frontend-style-system），不引入新依赖
acceptance:
  - ppm-resource-table.tsx grep 不到 `emerald-300` 硬编码色
  - toast 成功/失败两态与 error 块均走语义色变量
  - project_name 列文本渲染为 font-medium 加粗，其余列不变
  - 搜索区按钮分两组：导出/新增在左、查询/重置/展开在最右、中间有竖分隔
  - 搜索区整体布局保持现状（按钮行在字段上方右对齐 + 4 列网格 + 展开/收起 visibleSearchFields 逻辑不变）
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 搜索区布局完全保持现状（按钮行在字段上方右对齐 + 4列网格 + 展开收起逻辑 visibleSearchFields 不变），只调按钮顺序与样式
  - 纯样式，不改业务逻辑
---
