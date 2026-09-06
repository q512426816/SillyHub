---
author: qinyi
created_at: 2026-09-05 00:02:21
---

# 提案书（Proposal）

## 动机

会话面板缺少一眼可见的任务执行进度视图：用户在 agent 工作期间必须点开「后台 ▾」小下拉或翻读密集的「进度」流水才能知道任务跑到哪了；且 agent 任务状态只存在前端内存，刷新页面/切换会话即全部丢失。本提案为会话主面板新增常驻「任务执行」折叠面板并持久化任务记录，让用户随时看到当前会话的进度。

## 关键问题

1. **进度不可见**：子 agent 任务/Bash/团队任务状态藏在 ActivityCatalog 下拉里，不点开看不到；「进度」视图是全量过程流水，信息密度高不适合速览。
2. **任务记录易失**：`agent_task_status` 事件只进前端内存态，刷新/切会话即丢，无法回看「这个会话跑过哪些任务、结果如何」。
3. **轮次无总览**：每轮运行数据（状态/耗时/tokens）服务端已有（listSessionRuns），但会话面板没有聚合展示入口。

## 变更范围

- 前端：新组件 `task-execution-panel.tsx`（折叠摘要行 + 任务清单/运行中/轮次历史三页签），挂载 session-panel page/dialog/mobile 三处；归约函数抽出共享；新 hook `useSessionTasks`（快照+SSE 合并）；`listSessionTasks` API 函数；`pnpm gen:types` 同步。
- 后端：新表 `agent_session_task`（agent 任务状态持久化，upsert + 终态定格）+ Alembic migration + `AgentSessionTaskRead` DTO + `GET /sessions/{id}/tasks` 快照端点 + 上报端点同步落库。
- 测试：后端 upsert/端点/级联用例；前端面板/hook 用例 + session-panel 既有测试回归。
- daemon：零改动（上报链路已通）。

## 不在范围内（显式清单）

- 不改会话列表（左栏）条目，不做列表侧进度摘要（D-002）
- 不删除/不改「后台 ▾」ActivityCatalog 旧入口
- 不持久化 Bash stdout 流
- 不新增 daemon→backend 事件类型；run_id 入库但本期不做按 run 分组消费
- 不做任务执行面板的移动端专署新布局（折叠面板形态天然复用）

## 成功标准（可验证）

- 折叠态摘要行常驻显示（运行中任务数/任务成败计数/轮次数）；展开后三页签可切换（对照原型 prototype-task-execution-panel.html）。
- 同一会话刷新页面或切走再回来，任务清单仍显示已跑过的任务及终态（快照恢复）。
- agent 上报任务事件后 ≤1s 内面板出现/更新对应任务行（SSE 实时）。
- 不上报任务事件的引擎会话中，面板显示空态不报错（D-003）。
- 既有 session-panel 全部测试通过（/runtimes 弹窗零回归）。
- 未升级/无任务数据的会话行为与现状一致（新表/新端点纯增量）。
