---
author: qinyi
created_at: 2026-08-25 22:38:40
change: 2026-08-25-session-spec-binding
---

# 任务（Tasks）

> 任务注册表（唯一真相）：plan 阶段从 brainstorm 骨架 20 条收敛为 13 条（模型+迁移合一、各层测试并入实现卡、lib/daemon.ts 独立成卡）；Wave 分组/依赖/覆盖矩阵见 plan.md，实现细节见 tasks/task-NN.md 任务卡。

- [x] task-01: QuicklogSessionLink 模型 + alembic 迁移（建表+存量播种）(depends_on: -)
- [x] task-02: change/binding.py 绑定基座 + tool_kind 分段提取（default 守卫/解析规则/幂等绑定）(depends_on: task-01)
- [x] task-03: list_change_sessions 改读 links + 标题共享 helper (depends_on: task-01)
- [x] task-04: daemon sessions 列表筛选升级（change_id→M:N 子查询 + 新增 ql_id）(depends_on: task-01)
- [ ] task-05: run_sync 消息入库命令解析接线（agent_session_id NULL 守卫 + 既有 run_sync 测试更新）(depends_on: task-02)
- [ ] task-06: platform_sync agent-logs 双分支绑定接线（hub 补消费 ctx + 聚合落绑定 + 既有测试更新）(depends_on: task-02)
- [ ] task-07: 新端点 GET /workspaces/{wid}/quicklog-entries/{ql_id}/sessions (depends_on: task-03)
- [ ] task-08: 创建会话落绑定 + SessionCreateRequest.quicklog_id + 既有创建测试更新 (depends_on: task-02)
- [ ] task-09: pnpm gen:types + lib/daemon.ts API 客户端扩展（ql_id 筛选/quicklog_id 创建/listQuicklogSessions + 客户端测试）(depends_on: task-04, task-07, task-08)
- [ ] task-10: QuicklogScope 门户 + 路由页 + 会话列表关联筛选下拉（含既有类型测试更新）(depends_on: task-04, task-09)
- [ ] task-11: preContext quickId（session-panel + floating-session + 请求体断言测试）(depends_on: task-09)
- [ ] task-12: quicklog 抽屉关联会话卡（含既有 drawer 测试更新；门户路由集成由 task-13 走查）(depends_on: task-07, task-09)
- [ ] task-13: 全量回归 + 环境走查验收 (depends_on: task-01,task-02,task-03,task-04,task-05,task-06,task-07,task-08,task-09,task-10,task-11,task-12)
