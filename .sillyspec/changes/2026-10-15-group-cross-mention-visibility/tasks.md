---
author: qinyi
created_at: 2026-10-15 12:10:00
generated_by: sillyspec-brainstorm-step8
---
# 任务清单（Tasks）

- [x] task-01: 数据模型与 DTO——AgentGroupChat 加 cross_mention_mode 列+迁移+Create/Update/Read 透传+模型单测 (depends_on: —) target_files: backend/app/modules/agent/model.py, NEW:backend/migrations/versions/, backend/app/modules/agent/schema.py, backend/app/modules/daemon/group/service/crud.py, backend/app/modules/agent/tests/test_group_chat_models.py, backend/tests/test_align_platform_change_events_migration.py
- [x] task-02: 触发三态分流——mentions.py 按源轮 consensus_task_id>群模式分流+ROLE_PROMPT_AGENT_PUBLIC+分流/护栏同源/consensus 优先单测 (depends_on: task-01) target_files: backend/app/modules/daemon/group/service/helpers.py, backend/app/modules/daemon/group/service/mentions.py, backend/app/modules/daemon/tests/test_group_cross_mention.py, backend/app/modules/daemon/tests/test_group_mention_pipeline.py
- [x] task-03: 投影与回流——group_bridge 放行 agent_public 轮+NEW delegation_notice.py 轻注入+投影矩阵/打断零副作用单测 (depends_on: task-01) target_files: backend/app/modules/daemon/run_sync/service/group_bridge.py, NEW:backend/app/modules/daemon/group/service/delegation_notice.py, backend/app/modules/daemon/tests/test_group_bridge_projection.py
- [x] task-04: 前端设置面——member-panel/向导模式控件三态联动+控件测试+双端 gen:types 再生成提交 (depends_on: task-01) target_files: frontend/src/components/group-chat/member-panel.tsx, frontend/src/components/group-chat/create-group-wizard.tsx, frontend/src/components/group-chat/__tests__/member-panel.test.tsx, frontend/src/lib/api-types.ts, backend/openapi.json, sillyhub-daemon/src/api-types.ts
