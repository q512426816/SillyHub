---
author: qinyi
created_at: 2026-09-07 23:15:54
---

# 任务清单（Tasks）

- [x] task-01: backend 模型与迁移——AgentSession 加 pinned_at 列+索引、新增 AgentSessionScheduledMessage 表、alembic 迁移 (depends_on: —)
- [x] task-02: pin/unpin/rename 服务+三端点+SSE + 列表排序 pinned 优先 + AgentSessionRead.pinned_at（合并置顶/重命名/排序为单卡，共享后端四文件）(depends_on: task-01)
- [x] task-03: 定时消息 CRUD（schema+service+三端点：创建校验/列表/取消）(depends_on: task-02)
- [x] task-04: scheduled_send sweeper 单趟四分支+常驻循环+lifespan 注册 (depends_on: task-03)
- [x] task-05: gen:types 同步 api-types + openapi.json + 前端六个 API 函数 (depends_on: task-02, task-03)
- [x] task-06: backend 测试——pin/rename、scheduled CRUD、sweeper 四分支 (depends_on: task-02, task-03, task-04)
- [x] task-07: 会话树置顶/重命名 UI（hover 按钮+行内编辑+置顶徽标）+ sessions-portal 接线 (depends_on: task-05)
- [x] task-08: 定时发送 UI（输入栏 ⏰ 按钮+定时弹窗+use-scheduled-messages hook+ScheduledMessagesBar 双挂载）(depends_on: task-05)
- [x] task-09: 前端测试（session-list-panel 补用例 + scheduled-messages-bar/use-scheduled-messages 新用例）(depends_on: task-07, task-08)
- [x] task-10: 回归验证（backend daemon/agent 模块测试 + frontend tsc/lint + 既有测试零回归）(depends_on: task-06, task-07, task-08, task-09)
