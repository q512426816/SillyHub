---
author: qinyi
created_at: 2026-09-03 16:49:47
---
# 任务清单（Tasks）

- [x] task-01: backend 数据层——迁移加 archived_at 列 + AgentGroupChat 模型字段 + GroupChatRead 暴露
- [x] task-02: backend service——archive/unarchive/delete_group（行锁+幂等+SSE）+ delete 双置位与旁路封堵 + list_groups 三态过滤
- [x] task-03: backend router——POST archive/unarchive + DELETE 软删三端点 + 列表 archived Query（默认 False）
- [x] task-04: backend 测试——归档/删除/过滤/权限/SSE/旁路封堵用例 (depends_on: task-02, task-03)
- [x] task-05: 前端类型与 lib——gen:types + daemon.ts 三函数与 archived 参数 + panel presence 显式 archived:null (depends_on: task-03)
- [x] task-06: 前端列表交互——群行 hover 操作/徽标/归档视图数据源 + portal 群回调接线 (depends_on: task-05)
- [x] task-07: 前端测试——群行操作渲染/归档视图/确认流用例 (depends_on: task-06)
