---
author: qinyi
created_at: 2026-08-22 14:05:00
---

# 模块影响分析（Module Impact）— 删除会话面板适配层 + 统一 antd 基元

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend | 修改 | 纯前端变更，三处子域：① components-daemon——删 interactive-session-panel.tsx 适配层、session-panel.tsx dialog 分支 5 处基元 antd 化、turn-timeline.tsx TurnStatusBadge antd 化、session-input-bar.tsx 发送/📎 按钮 antd 化、runtime-session-dialog/runtime-session-helpers 直迁 SessionPanel、session-log-sanitize 注释锚点校正、3 套 ISP 测试迁移改名 + turn-timeline-session-input-bar 测试适配（task-01~06）；② components-sessions——session-config-bar.test.tsx 断言适配（task-03）、workspace-session-section.tsx 直迁 + 其测试 mock 路径（task-01/05）、ask-user-dialog-card.tsx 注释锚点（task-06）；③ app-sessions-pages——sessions page.test.tsx 断言适配（task-03）。回归 task-07 覆盖全前端。 |
| backend | 依赖变更 | 无（D-001@v1 后端零改动；inject 守卫等行为契约不变）。 |
| sillyhub-daemon | 依赖变更 | 无（SSE 事件流/会话状态机对前端渲染层变更无感知）。 |
| sillyspec（.sillyspec/changes） | 修改 | 本变更产物目录 + 合入后更新 2026-08-22-team-session-unify/tasks/task-11.md 代码锚点（task-08，P1 顺序门收尾，仅文档）。 |

## 与并行变更 2026-08-22-team-session-unify 的边界

- 该分支已提交代码（backend + daemon + 前端 6 文件）与本变更 19 文件清单零交集（Grill 实测）；
- 其剩余 task-11 allowed_paths 与本变更正面重叠（session-panel.tsx / 适配层 / 测试）→ P1 硬前置门：本变更先于 task-11 执行合入（D-006@v1）；
- 本变更落地后其前端任务（task-11~13）在新结构上执行，task-11.md 锚点由本变更 task-08 更新。

## 未匹配文件

无（design §5 全部 19 个文件路径均落入上述模块）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `docs/frontend/modules/components-daemon.md` | 已更新（verify 收尾）：定位段去适配层；SessionPanel 契约补「唯一直连入口 + antd chrome + D-304 备案」；InteractiveSessionPanel 条目划线标注已删除；TurnTimeline 补 TurnStatusBadge antd 映射；SessionInputBar 补按钮基元；测试清单改 session-panel-dialog×3 | done |
| `docs/frontend/modules/components-sessions.md` | 核对完成：该模块卡只覆盖 sessions 页组件（SessionListPanel/NewSessionForm/SessionConfigBar），不含 workspace-session-section（其归属 components-daemon 契约与根 components 域），无引用需改 | skipped |
| `docs/frontend/modules/app-sessions-pages.md` | 无变化（页面装配未动） | skipped |
| `docs/frontend/modules/_module-map.yaml` | 无变化（未增删模块，仅组件内部重构） | skipped |
