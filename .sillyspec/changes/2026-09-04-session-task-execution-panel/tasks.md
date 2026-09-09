---
author: qinyi
created_at: 2026-09-05 00:02:21
---

# 任务清单（Tasks）

> 骨架清单——plan 阶段展开细节（Wave 分组/依赖/验收口径）并写回本文件；execute 勾选与 verify 对照都在本文件。

- [x] task-01: 后端数据模型——agent_session_task 表 + Alembic migration（含 run_id 索引、(session_id,task_id) 唯一约束、会话级联删除）
- [x] task-02: 后端 DTO 与快照端点——AgentSessionTaskRead + GET /sessions/{id}/tasks（鉴权同 runs 端点，限 200 条）
- [x] task-03: 后端持久化写入——上报端点接入 upsert（终态定格 + started_at/finished_at 维护，持久化旁路失败不影响 SSE 转发）
- [x] task-04: 后端测试——upsert 语义/快照端点/会话删除级联用例
- [x] task-05: 前端归约抽出——applyAgentTaskStatusEvent 从 session-panel.tsx 抽出共享模块（等值重构，ActivityCatalog 行为不变）
- [x] task-06: 前端数据层——useSessionTasks hook（mount/重连拉快照 + applyEvent 合并）+ listSessionTasks API 函数
- [x] task-07: 前端面板组件——TaskExecutionPanel（折叠摘要行 + 任务清单/运行中/轮次历史三页签，复用三类卡，brand-* 双主题）
- [x] task-08: 前端挂载接线——session-panel page/dialog/mobile 三挂载点 + SSE 分发处 applyEvent 接线
- [x] task-09: 类型同步——pnpm gen:types（api-types.ts + openapi.json，先验 node_modules 健康）
- [ ] task-10: 前端测试——面板三页签/折叠摘要/空态用例 + useSessionTasks 用例 + session-panel 既有测试全绿回归
- [x] ql-20260907-001-e373 修复任务执行面板轮次历史懒加载——恢复挂载即取数，session-panel-connection 看门狗测试改为增量计数断言
- [x] ql-20260909-003-8a54 会话右栏收纳：TaskExecutionPanel 空数据不再常驻 0 计数折叠条（FR-01 决策演进——全零即隐藏返回 null，对齐 AgentLogCard 空态先例）
