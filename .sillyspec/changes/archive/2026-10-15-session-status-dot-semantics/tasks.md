---
author: flow-machine-draft
created_at: 2026-10-15T06:06:16.365Z
---
# 任务注册表（Tasks）— 2026-10-15-session-status-dot-semantics

- [x] task-01: 行首状态点单一源判定：failed→红点；ended→绿点；活性 working→动态转圈；活性 blocked→琥珀点；reconnecting→动态转圈；其余（active 空闲/pending/suspended/活性 idle/unknown/无活性数据）→零渲染留白
- [x] task-02: 终态权威：failed/ended 判定优先于活性信号，终态会话不因陈旧活性数据转圈或琥珀
- [x] task-03: 行尾活性小灯移除，悬停详情卡（Popover）与未读红角标迁移到行首点（有活性数据才可悬停出卡，未读角标挂行首槽右上角）
- [x] task-04: 批量多选模式行首槽仍为勾选框，状态点与悬停卡零渲染（与现状一致）
- [x] task-05: 相关测试更新并通过（session-list-panel 测试 + 门户页测试涉及点），lint 通过
