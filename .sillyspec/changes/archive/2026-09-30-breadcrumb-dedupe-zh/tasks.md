---
author: flow-machine-draft
created_at: 2026-09-30T08:05:20.453Z
---
# 任务注册表（Tasks）— 2026-09-30-breadcrumb-dedupe-zh

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge + 2026-09-29 心跳指针）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。📌 任务面在 ①spec 阶段定稿：覆写为真实实现步骤（全 `- [x] task-01: top-bar.tsx 导出 buildBreadcrumbs 并补全 SEGMENT_LABEL 中文段名（权威=menu-permissions.ts menuLabel + workspace-tabs.tsx label，MCP/Git/API 专业术语保留）
- [x] task-02: top-bar.test.tsx 新增 buildBreadcrumbs 段名中文化断言（工作区子路由/设置子页/PPM/动态段原样）
- [x] task-03: 变更中心列表页（workspaces/[id]/changes/page.tsx）移除 PageHead breadcrumb 传参
- [x] task-04: 任务详情页（changes/[cid]/tasks/[tid]/page.tsx）移除页内手写面包屑 nav 块
- [x] task-05: 跑相关测试（top-bar + changes 列表页 + primer PageHead）全绿并落 visual-evidence.md
