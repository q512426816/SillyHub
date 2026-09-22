---
author: qinyi
created_at: 2026-09-14 13:50:12
plan_level: full
---

# 实现计划（Plan）— 2026-09-14-workspace-drag-sort

## Spike 前置验证

无——技术不确定性已在前置阶段消除：方案经 Design Grill 独立审查（平台通道 pass/pass，分页数学 off-by-one 已推演修复，D-012/D-013），交互形态有可运行原型（prototype-workspace-drag-sort.html），dnd-kit 与 React 18/antd 6 共存为官方支持事实。跳过本节。

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖 Wave 1）
- task-03

## Wave 3（依赖 Wave 2）
- task-04

## Wave 4（依赖 Wave 2/3）
- task-02

## Wave 5（依赖 Wave 4；两任务文件不相交可并行）
- task-05
- task-06

## Wave 6（依赖 Wave 5）
- task-07

## Wave 7（依赖 Wave 6）
- task-08

## Wave 8（依赖 Wave 7）
- task-09

## Wave 9（依赖 Wave 8）
- task-10

> Wave 划分依据（复审修订）：task-02 与 task-04 同改 `backend/app/modules/workspace/router.py`（move 端点 + list 端点 order_user_id 透传 backend/app/modules/workspace/router.py:301-322 两处调用），共享文件必须分 Wave——router.py 全部改动（含 list 透传）并入 task-02，task-02 依赖 task-03（service.move_workspace）与 task-04（list_with_owner 新参数）；task-04 仅改 service.py。task-03 与 task-04 同改 service.py 亦强制分 Wave。task-05（新测试文件）与 task-06（openapi.json+api-types.ts）文件不相交故同 Wave。前端链 task-07→08→09→10 严格串行（每步消费上一步产物）。

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 后端迁移与模型 | W1 | P0 | — | FR-01, D-001@v1, D-011@v1 | user_workspace_orders 表 + UserWorkspaceOrder 模型 + 唯一/排序索引（model.py + migrations） |
| task-03 | 后端 move 服务 | W2 | P0 | task-01 | FR-01, FR-02, D-001@v1, D-006@v2, D-008@v1, D-011@v1, D-012@v1, D-013@v1 | 幂等 backfill + 锚点解析（id/to 分页数学 + 锚点可见性判据）+ 中点/整集重排 + rank 计算（service.py） |
| task-04 | 后端列表排序 | W3 | P0 | task-01 | FR-03, D-002@v1, D-004@v1, D-011@v1 | list_with_owner 增 order_user_id LEFT JOIN 默认排序；无行用户=现状回归（仅 service.py；router 透传归 task-02） |
| task-02 | 后端 move 端点 | W4 | P0 | task-03, task-04 | FR-02, FR-03, D-007@v1, D-012@v1, D-013@v1 | WorkspaceMoveRequest/Response schema + move 路由（三选一校验、鉴权、中文 422 文案）+ list 端点 order_user_id=user.id 透传（router.py 两处调用） |
| task-05 | 后端测试 | W5 | P0 | task-02, task-03, task-04 | FR-01, FR-02, FR-03, FR-08, D-014@v1 | test_move_order.py：契约 422 分支/幂等 backfill/to 分页数学/精度重排/D-004 回归/分页数量不变量 |
| task-06 | 类型契约 | W5 | P0 | task-02 | FR-04~FR-07 前置 | pnpm gen:types 再生成 api-types + openapi.json 提交（前后端契约对齐） |
| task-07 | 前端依赖与封装 | W6 | P0 | task-06 | FR-04, FR-05, D-010@v1 | 引入 @dnd-kit/core + sortable；moveWorkspace() 封装（lib/workspaces.ts + package.json） |
| task-08 | 前端拖拽网格 | W7 | P0 | task-07 | FR-04, FR-05, FR-08, D-002@v1, D-003@v2, D-008@v1, D-012@v1, D-014@v1 | WorkspaceDragGrid：手柄/页内拖放乐观更新/边缘投放带 to 提交/rank 翻页高亮 + workspace-card 挂点（默认不渲染保持他处兼容） |
| task-09 | 弹窗与接线 | W8 | P0 | task-08 | FR-06, FR-07, D-005@v2, D-009@v2 | 「移动到…」弹窗（方向锚点规则）+ 筛选禁拖保护（含 include_deleted）+ 列表页接线 |
| task-10 | 前端测试 | W9 | P0 | task-08, task-09 | FR-04~FR-08 | 新增 frontend/src/components/__tests__/workspace-drag-grid.test.tsx + 增补 frontend/src/app/(dashboard)/workspaces/__tests__/page.test.tsx（已存在）+ 回归 frontend/src/components/__tests__/workspace-card.test.tsx（挂点默认不渲染不改行为） |

## 关键路径
task-01 → task-03 → task-04 → task-02 → task-06 → task-07 → task-08 → task-09 → task-10（9 个任务 8 跳，最长链决定最短交付周期；task-05 在旁路不延长关键路径）

## 全局验收标准
1. 后端 workspace 模块相关测试全绿（仅跑本模块：`uv run pytest -q --no-cov app/modules/workspace/tests/test_move_order.py` + 既有列表测试回归），前端 `__tests__/workspace-drag-grid.test.tsx`、page 测试增补与 workspace-card 测试回归全绿；双端 lint/typecheck 0 新增错误
2. 集成冒烟：dev 栈起后手工/脚本走通「页内拖拽 → 落带跨页翻页高亮 → 弹窗移动 → 刷新后顺序保持」四步（对照原型交互）
3. 兼容验收（brownfield）：无排序行用户的列表顺序与现状逐字节一致（created_at DESC）；不调用 move 的旧路径零行为变化
4. 分页数量不变量（D-014@v1）：测试断言 move 前后 total 不变、各页恒 PAGE_SIZE、无重复 id
5. 错误文案中文（l10n 守护测试通过）；422 错误码命名符合项目惯例

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-03 | task-05 断言两用户顺序互不影响（FR-01 GWT） |
| D-002@v1 | task-04, task-08 | 列表分页回归 + 投放带跨页不依赖消灭分页 |
| D-003@v2 | task-08 | task-10 断言落带 to 参数与翻页高亮 |
| D-004@v1 | task-04 | task-05 断言无行用户=created_at desc、新建卡落最前 |
| D-005@v2 | task-09 | task-10 断言筛选态手柄禁用 + 提示 + 入口禁用 |
| D-006@v2 | task-03 | task-05 断言重复 move 不重复插入、backfill 后新建卡物化位置正确 |
| D-007@v1 | task-02 | task-05 断言鉴权 403 与锚点 422 分支 |
| D-008@v1 | task-03, task-08 | 设计约定后写覆盖，测试不设乐观锁断言 |
| D-009@v2 | task-09 | task-10 断言弹窗方向锚点与自锚跳过 |
| D-010@v1 | task-07 | package.json 依赖落地 + 组件可用 |
| D-011@v1 | task-01, task-03, task-04 | 方案 A 全要素实现 |
| D-012@v1 | task-02, task-03, task-08 | task-05 断言 to 分页数学（下页页首/上页页尾/越界/第 0 页 422）+ rank 响应 |
| D-013@v1 | task-02, task-03 | task-05 断言三选一 422/自锚 422/锚点不可见 422 |
| D-014@v1 | task-05, task-08 | 分页数量不变量断言（后端）+ 翻页恒 PAGE_SIZE（前端） |

FR 覆盖：FR-01（task-01/03/05）、FR-02（task-02/03/05）、FR-03（task-02/04/05）、FR-04（task-07/08/10）、FR-05（task-08/10）、FR-06（task-09/10）、FR-07（task-09/10）、FR-08（task-05/08/10）。
