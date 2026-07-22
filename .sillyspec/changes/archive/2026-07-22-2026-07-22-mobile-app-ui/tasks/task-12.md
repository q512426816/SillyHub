---
id: task-12
title: FRONTEND_PAGE_STYLE 移动端章节
title_zh: FRONTEND_PAGE_STYLE.md 新增「移动端 App UI」章节，更新原「移动端非目标」条款
author: qinyi
created_at: 2026-07-22 23:47:21
priority: P2
depends_on: []
blocks: []
requirement_ids: [FR-09]
decision_ids: []
allowed_paths:
  - .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md
goal: >
  在前端页面样式规范文档中新增「移动端 App UI」章节，把本次改造的分流策略/路由段/外壳/列表/表单/筛选/登录/断点等约定固化为样式规范；同时更新原 style-system design §3「响应式移动端适配为非目标」的方向，说明已反转为「独立 App UI 已纳入」，避免后续改移动页时无规范可依。
implementation:
  - 在 FRONTEND_PAGE_STYLE.md 末尾新增「移动端 App UI」章节（接第 12 节迁移检查清单后），开篇一句话原则：移动端走独立 /m/ 路由段，不复用桌面骨架（PageContainer/SectionCard/DataTable 仅桌面用）
  - 分流：middleware 读 UA rewrite 到 /m/，地址栏 URL 不变、首屏无 FOUC，UA 异常/平板(>768)默认走桌面（引 design §5.1、D-002@v2、D-005）
  - 目录与外壳：app/m/ 路由段 + components/mobile/ 组件库；MobileAppShell = 移动顶栏 + 内容区 + 底部 5 Tab（工作台/计划任务/问题清单/我的/平台切换）（引 D-001、D-004）
  - 列表/表单/筛选：MobileCardList 替代 antd Table（承载 actions 动作集 / selectable 批量 / pagination 对接 page·page_size / headerActions）；MobileDetailSheet 全屏表单替代 Modal；MobileFilterDrawer 替代桌面 grid-cols-4（引 D-007、D-008）
  - 登录与断点：app/m/login 移动登录页（复用桌面 auth）；断点 ≤768px（tokens.ts breakpoint，平板走桌面）
  - 数据层与零回归：移动页 100% 复用 lib/* 函数/stores/类型，禁止自写请求（D-003）；桌面 (dashboard)/**、app-shell、(auth)/login 不动
  - 更新「移动端非目标」：章节开头说明原 style-system design §3「响应式移动端适配非目标」方向已反转，独立 App UI 现已纳入规范（D-002@v1→v2 演进）
  - 迁移检查清单补移动端对照项（新增移动页：放 app/m/、用 MobileCardList 不用 DataTable、表单用 DetailSheet 不用 Modal、筛选用 FilterDrawer）
acceptance:
  - FRONTEND_PAGE_STYLE.md 含「移动端 App UI」章节，覆盖分流/路由段/外壳 5 Tab/MobileCardList/DetailSheet/FilterDrawer/移动登录/断点/数据复用/桌面零回归
  - 原「移动端非目标」条款已更新为「已纳入」，方向反转说明清楚
  - 迁移检查清单含移动端对照项
verify:
  - grep -n "移动端 App UI\|已纳入" .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md
  - 文档纯改：git diff --stat -- frontend/src 应为空（本任务不动代码）
constraints:
  - 只改 FRONTEND_PAGE_STYLE.md，不动任何前端代码（本任务是文档固化）
  - 文档中文（CLAUDE.md 规则 12），术语保留（middleware/rewrite/Token/Tab）
  - 章节结论必须与 design.md §5、decisions.md（D-001~D-008）一致，不引入新决策
---
