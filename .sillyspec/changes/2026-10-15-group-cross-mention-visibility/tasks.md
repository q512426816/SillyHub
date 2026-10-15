---
author: qinyi
created_at: 2026-10-15 12:10:00
generated_by: sillyspec-brainstorm-step8
---
# 任务清单（Tasks）

- [ ] task-01: 数据模型与 DTO——AgentGroupChat 加 cross_mention_mode 列 + alembic 迁移 + Create/Update/Read 透传 + 模型单测
- [ ] task-02: 触发三态分流——mentions.py 按源轮 consensus_task_id > 群模式分流 + ROLE_PROMPT_AGENT_PUBLIC 常量 + 分流/护栏同源/consensus 优先单测
- [ ] task-03: 投影与回流——group_bridge 放行 agent_public 轮 [[GROUP]] 投影 + NEW delegation_notice.py 轻注入 helper + 投影矩阵/打断零副作用单测
- [ ] task-04: 前端设置面——member-panel 模式选择三态联动 + 向导可选项 + 控件测试 + gen:types 前后端再生成提交
