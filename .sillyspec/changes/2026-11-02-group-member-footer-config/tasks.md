---
author: flow-machine-draft
created_at: 2026-11-02T05:29:44.707Z
---
# 任务注册表（Tasks）— 2026-11-02-group-member-footer-config

- [x] task-01: 后端数据面——agent_group_members 增 model/thinking_level 可空列 + alembic 单头迁移；成员 create/update schema 与 members.py 服务校验（thinking_level 值域=同源词表）并持久化；两键入 Read schema
- [x] task-02: 后端派发与快照——shadow.py 首 run AgentRun.model=成员模型、prepare_interactive_dispatch 透传 thinking_level（None 零回归兜底）；helpers 快照组装 model 键存真实模型名+thinking_level；新增 test_group_member_model_thinking.py（指定/未指定两态+快照断言）跑绿
- [ ] task-03: 前端四选子组件——member-config-fields.tsx（供应商+模型级联+思考等级+档案，数据源/词表同 session-config-bar）；三表面接入并更名标签（供应商/档案）；codex 无需选供应商降级语义维持
- [ ] task-04: 前端机器 label 修正与卡片展示——runtime 下拉 label=display_alias/hostname 优先删引擎名兜底（三表面）；成员卡片「模型」行展示所选模型名+思考等级
- [ ] task-05: 前端测试——member-panel-config.test.tsx（四选渲染/级联/payload 携 model+thinking_level/机器 label 不回落引擎名）跑绿；vitest 触达面 + tsc 零错 + backend pytest group 面回归 + ruff 零告警
