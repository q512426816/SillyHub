---
id: task-01
title: workspace-hero-header-component
title_zh: 工作区详情页头部横幅组件 hero-header（渐变+名称+状态+slug+操作组）
author: qinyi
created_at: 2026-08-20 15:50:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-201, D-202]
allowed_paths:
  - frontend/src/components/workspace/hero-header.tsx
provides:
  - contract: WorkspaceHeroHeader
    fields: [workspace, onEditInfo, editing]
goal: >
  新增纯展示头部横幅组件 WorkspaceHeroHeader（frontend/src/components/workspace/hero-header.tsx），
  承载工作区详情页四段式段①——深底渐变横幅内放工作区名/状态徽标/slug 与右侧操作组
  （编辑信息入口+返回列表链接），供 task-04 编排层替换现状 PageHeader 区（page.tsx 244-259 行）。
implementation:
  - 新建 hero-header.tsx 导出 WorkspaceHeroHeader，"use client" 纯展示组件（无数据 hook、无 API 调用、无路由副作用）
  - props 按设计 §6 基线两项——workspace（Workspace 类型，type import 自 lib/workspaces）与 onEditInfo（回调，触发 page.tsx 既有 editingInfo 编辑态）；另接可选 editing 布尔（默认 false，承载 plan Wave1 定案的编辑态禁用，由 task-04 接线透传）
  - 横幅容器深底渐变 bg-gradient-to-br from-brand-700 via-brand-800 to-slate-950（同登录页 hero 视觉基线；brand 阶，blue 主题自动回旧蓝渐变）
  - 左区渲染工作区名（大字白色）+ 状态徽标（沿用现状 active 映射 success、其余 outline 的 variant 语义，配色适配深底保双主题可读）+ slug（等宽小字白/半透明）
  - 右区操作组两项——编辑信息入口（点击调 onEditInfo；editing 为 true 时该入口禁用防重复进入，取消/保存仍留基本信息面板 extra）+ 返回列表链接（href 为 /workspaces，文案沿用现状箭头+工作区）
  - 不放重新扫描按钮——该操作现状仅在列表页卡片 footer，详情页引入即新增 API 调用，违反设计 §2 零改动承诺
acceptance:
  - tsc --noEmit 0 error 且 eslint 该文件 0 error
  - 组件基线 props 契约为 workspace 与 onEditInfo 两项（editing 可选），内部无数据态 hook 无 API 调用
  - 渐变三段类名 from-brand-700 via-brand-800 to-slate-950 齐全，全部走 brand 语义阶
  - editing 为 true 时编辑入口呈禁用态不可重复触发；返回列表链接 href 为 /workspaces
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec eslint src/components/workspace/hero-header.tsx
constraints:
  - 纯展示边界——无数据 hook、无 API 调用、无路由跳转副作用（编辑入口仅回调 onEditInfo）
  - 不放重新扫描入口（设计 §2/§3 定案，重扫按钮只存在于列表页卡片）
  - 样式全走 brand 语义阶与主题化 shadow token，不硬编码 blue-* 色值（blue 阶仅限真信息蓝）
  - 本卡只新建组件文件，不改 page.tsx 与任何测试（接线与断言属 task-04/05）；UI 文案中文
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
