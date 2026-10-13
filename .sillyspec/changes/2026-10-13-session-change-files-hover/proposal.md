---
author: qinyi
created_at: 2026-10-13T12:30:00+08:00
---
# 提案书（Proposal）

## 动机

会话在跑轻量变更（thin flow）或全量变更时，agent 持续产出变更文件，但会话页面对变更的感知仅限预会话上下文行与 @ 联想绑定，用户想看「agent 现在改了哪些文件、内容是什么」必须跳去变更详情页手动找变更——无法实时掌控变更数据。

## 关键问题

1. **反向查询缺失**：会话 ↔ 变更关联的唯一真相是 `change_session_links` M:N 表，但平台只有「变更 → 会话列表」正向端点（`GET /changes/{cid}/sessions`），没有「会话 → 变更列表」反向端点；前端仅有的 `AgentSession.change_id`/`current_change_id` 两个字段最多覆盖 2 个变更，会话历史执行过的其它变更全部不可见。
2. **展示割裂**：变更文件浏览组件 `ChangeFileTree`（含结构化预览/全屏预览）只挂在变更详情页，会话页面无法复用查看，用户要在会话页和变更页之间反复横跳。
3. **实时性缺口**：`ChangeFileTree` 的文件树是挂载单次拉取 + 手动刷新（其内部唯一轮询仅服务保存后 pending 态），跑动中的变更文件变化不会自动出现——「实时掌控」需要自动刷新机制。

## 变更范围

- 后端新增只读端点 `GET /api/workspaces/{wid}/changes/-/by-session/{session_id}`：`change_session_links` JOIN `changes`，排除已删除，复用 `enrich_summaries` 投影返回 `list[ChangeSummary]`，排序「未归档优先 → created_at desc」。
- 前端 `ChangeFileTree` 加可选 `autoRefreshMs` prop（默认不轮询，既有消费方行为不变）。
- 前端会话面板新增悬浮组件：胶囊入口（右下角，进行中变更数徽标 + 在跑呼吸）→ hover 弹下拉分组列表（进行中置顶/已归档默认折叠可展开）→ 点项开大弹窗（`h-[85vh] max-w-6xl`）内嵌 `ChangeFileTree`（头部 Select 切换变更，15s 自动刷新）。
- `pnpm gen:types` 再生成并提交 api-types.ts + openapi.json。

## 不在范围内（显式清单）

- 不重构 ChangeFileTree（仅加一个可选 prop，默认行为逐字节不变）
- 不新增数据库表/列（零 migration）
- 不改会话 DTO（AgentSessionRead / AgentSessionListItem）
- 不做 SSE 推送式刷新（轮询已满足，事件驱动列未来增强）
- 不做移动端独立路由适配（m/ 不动，仅保证悬浮入口触屏可点开）
- 不改变更文件写通道（pending/保存逻辑沿用现状）

## 成功标准（可验证）

- 会话页面悬浮胶囊入口：有关联变更即显示，无关联不占位；进行中变更数徽标 + 在跑呼吸动画正确。
- hover（或触屏点击）弹出下拉列表：进行中（轻量/全量徽标 + 阶段）置顶，已归档默认折叠、可展开。
- 点下拉项打开大弹窗，文件树与变更文件页同一 `ChangeFileTree` 组件（同款结构化预览/全屏预览），弹窗内 15s 自动刷新，关闭弹窗即停止轮询。
- 后端端点排序（未归档优先/最新优先）、软删排除、404、工作空间隔离有 pytest 覆盖；前端显隐/分组/折叠/切换有 vitest 覆盖。
- 既有消费方（ChangeFilesCard、移动端变更详情）行为不变：autoRefreshMs 不传时无新增定时器（回归测试守护）。
