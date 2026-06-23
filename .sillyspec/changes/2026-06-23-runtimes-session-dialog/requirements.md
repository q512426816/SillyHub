---
author: qinyi
created_at: 2026-06-23T15:40:00+08:00
---

# Requirements: /runtimes 会话弹窗化 + active 续聊

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 /runtimes 管理 runtime 并与 agent 会话交互 |
| 开发者 | 维护前端组件，依赖 lib/daemon API |

## 功能需求

### FR-01: 会话弹窗化（runtime 专属工作台）

覆盖决策：D-001@v1（弹窗单例）, D-002@v1（默认态）

Given 用户在 /runtimes 页面，存在在线 runtime（claude/codex）
When 用户点击某 runtime 卡片的「会话」按钮
Then 弹出该 runtime 专属会话工作台（左历史会话列表 + 右会话区），不滚动页面

Given 弹窗已打开（runtime A）
When 用户点击另一 runtime B 的「会话」按钮
Then 弹窗切换为 B（单例，A 关闭 B 打开，状态重置）

Given 弹窗打开且该 runtime 有活跃会话（active/pending/reconnecting）
When 弹窗渲染
Then 右侧默认 attach 最近活跃会话

Given 弹窗打开且该 runtime 无活跃会话
When 弹窗渲染
Then 右侧默认进入 idle 新建空白面板

### FR-02: active 会话续聊

覆盖决策：D-004@v1（复用 attach）

Given 弹窗左侧列表有一 active 会话
When 用户点击该 active 会话项
Then 右侧进入 attach 模式：拉历史 logs → `logsToTurns` 预填 → 建 SSE → 轮询到 active → 输入框可用可发送续聊（非只读）

Given active 会话 attach 后有进行中 run
When SSE 推送进行中 run 的 log
Then 预填历史 turn 与进行中 turn 按 `run_id` 去重合并（不重复、不覆盖已终态 turn）

### FR-03: 页面精简

Given 用户进入 /runtimes
When 页面渲染
Then 无底部常驻会话区，主体为摘要卡 + runtime 卡片列表，卡片更舒展

### FR-04: ended/failed 会话回看与续聊

Given 弹窗左侧有 ended/failed claude 会话（有 agent_session_id）
When 用户点击
Then 右侧只读回看 + 「继续对话」按钮可用（reopen → attach）

Given ended/failed codex 会话
When 用户点击
Then 右侧只读回看，「继续对话」置灰（codex 不支持续聊）

### FR-05: 关闭清理

覆盖决策：D-001@v1, D-003@v1（onClose 时序）

Given 弹窗打开且会话 attach 中（SSE/轮询活跃）
When 用户关闭弹窗
Then SSE 关闭 + 轮询清理无泄漏；`?session=` 被清除

### FR-06: URL `?session=` 恢复

覆盖决策：D-003@v1

Given URL 含 `?session=<活跃会话>`
When 页面 mount/刷新
Then 自动打开对应 runtime 弹窗并 attach 该会话

Given URL 含 `?session=<ended/failed/不存在>`
When 页面 mount
Then 清 param，不开弹窗，降级 idle

## 非功能需求

- **NFR-1**：纯前端，不改后端 API / 数据模型 / 状态机。
- **NFR-2**：复用现有 `ui/dialog.tsx`（shadcn/Radix）与 `lib/daemon.ts` API，不新增依赖。
- **NFR-3**：遵循项目执行顺序（文档 → 读代码 → 写测试 → 写实现 → 跑测试 → 验收）。
- **NFR-4**：`pnpm lint` + `tsc --noEmit` 通过；vitest 全绿。
- **NFR-5**：helper 提取避免 `page ↔ dialog` 循环依赖（独立 `runtime-session-helpers.tsx`）。

## 决策覆盖关系

| 决策 | 覆盖 FR |
|---|---|
| D-001@v1 弹窗单例 | FR-01, FR-05 |
| D-002@v1 默认态 | FR-01 |
| D-003@v1 URL恢复（+onClose） | FR-05, FR-06 |
| D-004@v1 active复用attach | FR-02 |
