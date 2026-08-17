---
author: qinyi
created_at: 2026-08-16 23:24:00
change: 2026-08-16-change-center-quick-tab
status: draft
---

# 任务拆解（Tasks 概览）— 变更中心「快速修复」tab

> 详细 Wave/Task 拆解由 plan 阶段产出（`sillyspec run plan --change 2026-08-16-change-center-quick-tab`），本文件为 brainstorm 粒度概览，plan 会覆写/细化。

## W1 后端·数据层
- quicklog_entries 表 model + alembic migration
- platform_sync：POST /api/quicklog-entries（shpsync_ 鉴权 + 幂等 upsert）+ 测试

## W2 后端·解析与查询
- change 模块 quicklog_parser.py（条目解析 + mtime 指纹缓存 + 宽松规则全套）
- quicklog_service.py（双源合并 + enrich + module-map 推导 + 筛选分页）
- change router 两个 GET 端点 + 测试（真实样本 fixture）

## W3 跨仓·CLI 推送
- sillyspec src/quicklog.js 两触发点 best-effort POST + helper + mock fetch 测试

## W4 前端·tab 与详情
- lib/quicklog.ts API client
- 变更中心第三 tab + quicklog-table.tsx（列/筛选/轮询/空态）
- quicklog-drawer.tsx（四段正文/文件括注/原始 md 切换）
- vitest 组件测试

## W5 收口
- 变更详情页反向「关联的快速任务」区块
- gen:types（api-types.ts + openapi.json）
- 全量测试回归 + 文档同步（模块文档变更索引）

## 依赖关系

W1 → W2 →（W3 独立于 W1/W2 可并行，但验收依赖 W1 端点存在）→ W4 依赖 W2 契约 → W5 依赖全部。
