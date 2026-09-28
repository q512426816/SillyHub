---
author: flow-machine-draft
created_at: 2026-09-28T14:40:31.962Z
---
# 任务注册表（Tasks）— 2026-09-28-change-detail-header-overflow

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: `frontend/src/components/layout/page-header.tsx` 左侧内容列 `<div>` 补 `min-w-0`（flex 项 min-width:auto 陷阱，组件级收口 41 个使用方）
- [x] task-02: 详情页 `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` 标题 truncate span 补 `min-w-0`
- [x] task-03: 回归测试：新增 `layout/__tests__/page-header.test.tsx` 3 用例（min-w-0 类名锚 + 收缩链结构断言）3/3 绿；详情页既有测试 3 文件 28 用例绿；tsc 0 错
- [x] task-04: 真浏览器复测：生产现场注入修复（部署前预验证）——1600/1280 两档 scrollWidth==视口宽、描述行省略号截断、左列 1861→1186/866；对照截图与结论落 visual-evidence.md（A/B 两节）
