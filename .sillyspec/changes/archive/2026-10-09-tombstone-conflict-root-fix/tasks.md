---
author: qinyi
created_at: 2026-10-09 11:39:02
---
# 任务清单（Tasks）

- [x] task-01: backend tombstone_cleanup 指令通道（端点+WS+action 枚举+openapi/api-types 重生成）(depends_on: —)
- [x] task-02: backend delete_change 收敛环自动下发（终 commit 后 fire-and-forget+绑定机器查询）(depends_on: task-01)
- [x] task-03: daemon tombstone_cleanup 执行器（WS 分发+隔离区移动+doctor 归档+幂等回执）(depends_on: task-01)
- [x] task-04: frontend 冲突行墓碑形态三态渲染（双源 join+收敛按钮+回显）(depends_on: task-01, task-05)
- [x] task-05: sillyspec 仓 CLI 归因记账（纯墓碑归因+幂等合并+全绿清理+type 透传）(depends_on: —)
