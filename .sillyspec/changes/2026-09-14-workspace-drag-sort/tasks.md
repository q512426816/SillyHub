---
author: qinyi
created_at: 2026-09-14 13:42:07
---
# 任务清单（Tasks）

- [x] task-01: 后端迁移与模型——user_workspace_orders 表 + UserWorkspaceOrder 模型 + 唯一/排序索引
- [x] task-02: 后端 move 端点——WorkspaceMoveRequest/Response schema + move 路由（三选一校验、鉴权、中文 422 文案）+ list 端点 order_user_id 透传 (depends_on: task-03,task-04)
- [x] task-03: 后端 move 服务——幂等 backfill + 锚点解析（id/to 分页数学）+ 中点/整集重排 + rank 计算 (depends_on: task-01)
- [x] task-04: 后端列表排序——list_with_owner 增 order_user_id LEFT JOIN 默认排序（无行=现状回归；仅 service.py，router 透传归 task-02）(depends_on: task-01)
- [x] task-05: 后端测试 test_move_order.py——契约 422 分支/幂等 backfill/to 分页数学/精度重排/D-004 回归/分页数量不变量 (depends_on: task-02,task-03,task-04)
- [x] task-06: 类型契约——pnpm gen:types 再生成 api-types + openapi.json 提交 (depends_on: task-02)
- [x] task-07: 前端依赖与封装——引入 @dnd-kit/core + sortable，moveWorkspace() 封装 (depends_on: task-06)
- [x] task-08: 前端拖拽网格组件——WorkspaceDragGrid（手柄/页内拖放乐观更新/边缘投放带 to 提交/rank 翻页高亮）(depends_on: task-07)
- [x] task-09: 前端「移动到…」弹窗 + 筛选禁拖保护 + 列表页接线 (depends_on: task-08)
- [x] task-10: 前端测试 __tests__/workspace-drag-grid.test.tsx + page 测试增补 (depends_on: task-08,task-09)
