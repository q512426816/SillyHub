---
author: qinyi
created_at: 2026-09-14 10:32:57
generated_by: sillyspec-design-init
scale: large
risk_level: unit-sufficient
---

# 设计文档（Design）— 2026-09-14-workspace-drag-sort

## 背景

工作区列表页（`/workspaces`）当前固定按 `created_at DESC` 排序，服务端分页 12 张卡/页。用户无法把常用的几个工作区挪到前面，每次都要翻页或搜索。本变更为列表增加拖拽排序能力：页内自由拖拽 + 跨页移动（边缘投放带）+ 显式「移动到…」兜底。

顺序为**每人一套**（user-scoped）：任何用户的拖拽只影响自己的视图，不存在跨用户写冲突与全局写权限问题。方案探索记录见 explore 阶段（2026-09-14 归档）与本变更 decisions.md D-001~D-011。

## 设计目标

1. 登录用户可对工作区卡片拖拽排序，顺序按 user_id 持久化、跨设备一致。
2. 跨页移动：拖拽时页面上下浮现边缘投放带，落带即移到相邻页边界，自动翻页并高亮目标卡。
3. 「移动到…」菜单：选目标页 + 页首/页尾，作为拖拽兜底与键盘/无障碍路径。
4. 筛选/搜索激活时禁用排序（子序列锚点语义不明确），并给出提示。
5. 现有服务端分页（limit/offset）与四路筛选（q/type/unclassified/status/user_id）行为不变。
6. **分页数量不变量**：move 是纯重排（单行 sort_position 更新，不增删行）——任何移动后总条数不变、每页恒 PAGE_SIZE 张（末页允许不满）；跨页移动表现为"源页少一张、目标页多一张后重新切片"，绝不允许出现空页/双卡/丢卡（用户 2026-09-14 明确约束）。
7. 从未拖拽过的用户视图与现状完全一致（created_at DESC），零迁移数据。

## 非目标

- 不做多用户共享顺序 / 全局置顶。
- 不做拖拽悬停自动翻页（交互路线已拍板边缘投放带，D-003）。
- 不改造分页为加载全部/无限滚动（量级一两百，D-002）。
- 不做键盘拖拽之外的批量移动（多选批量排序）。
- 不改变卡片内既有操作（别名/重扫/删除/整卡点击进详情）。
- 不引入 LexoRank 字符串键（量级不需要，D-011 淘汰记录）。

## 拆分判断

单一功能、前后端紧耦合（move 端点 ↔ 拖拽落位调用），交付单元互相依赖（表→端点→排序 SQL→前端网格），不满足"3+ 可独立交付模块"拆分条件；非"模板×数据"批量模式。走标准单变更流程，plan 阶段按后端→前端两 Wave 组织。

## 总体方案

**Wave 1 后端（数据层 + 端点 + 列表排序）**

1. 新表 `user_workspace_orders`（模型 + Alembic 迁移），无存量数据回填——排序行惰性物化。
2. `POST /workspaces/{id}/move` 锚点端点：事务内四步——①backfill-if-missing（见下）；②锚点解析（id 锚点直接用；`to` 枚举在默认视图序列上解析成 id 锚点，见下）；③取锚点邻居算浮点中点；④单行 upsert 并计算响应 rank。
3. `list_with_owner` 增加 `order_user_id` 参数，LEFT JOIN 排序表，默认排序改为 `(o.sort_position IS NULL) DESC, o.sort_position ASC, w.created_at DESC`（无行的新建工作区落最前，D-004；无行用户 = 现状 created_at DESC）。

**backfill 物化（幂等，每次 move 前执行）**：对该用户可见集合 ∧ `status IN ('active','archived')` ∧ 尚无排序行的全部 workspace 批量物化：按当前显示序（无行组在前、组内 `created_at DESC`）整体赋在现有最小位置之下（首用户 = 全集按 `created_at DESC` 赋 `row_number × 1024` 递增序列；后续新增卡物化在 `min(pos) - 1024×n` 区段，D-006@v2）。物化前后显示序零变化（D-004 回归约束）。deleted 软删行不物化；归档行保留位置，恢复后回原位。锚点卡因此永远有行，无"锚点无行"分支（Grill F-04 修订）。

**锚点解析**：请求体三选一携带 `after_id` / `before_id` / `to`。id 锚点直接取邻居；`to: "next_page_head" | "prev_page_tail"`（边缘投放带专用）由服务端解析：取该用户默认视图有序 id 列表（可见 ∧ `status='active'` ∧ `deleted_at IS NULL`，按显示序，一两百个直接整取），定位被移动卡 rank r，页 P=floor(r/page_size)，目标插入 rank = (P+1)×page_size（下页页首）或 P×page_size-1（上页页尾，P=0 时 422），越界收敛到序列尾/首，解析出相邻锚点卡后走统一中点路径。`page_size` 请求可选携带（默认 12，与前端 `PAGE_SIZE` 常量同源，契约写明耦合）。此路径消除客户端"不知道相邻页边界卡"的分页数学问题（Grill F-01 修订：`after_id=本页末卡` 的落位是本页末位而非下页开头，锚点必须由持有全量顺序的服务端解析）。

**中点与重排**：`after_id=A` → 新位置 = (pos(A) + pos(A 的后一个))/2（无后继 = pos(A)+1024）；`before_id=B` 对称（无前驱 = pos(B)-1024）。中点结果与任一邻居相等（浮点精度耗尽）→ 同一事务内整集重排（按当前顺序重赋 1024×i）后重算本次位置。所有行均为该用户私有，重排一两百行无压力。

**Wave 2 前端（dnd-kit 网格 + 投放带 + 菜单）**

1. 引入 `@dnd-kit/core` + `@dnd-kit/sortable`（D-010），新组件 `WorkspaceDragGrid`：DndContext + SortableStrategy（rectSortingStrategy，适配 1/2/3 列响应式网格），卡片左侧悬浮拖拽手柄（手柄承担 drag listeners，卡体保持整卡点击进详情）。
2. 页内拖放：drop 结束按落位计算前邻卡 → 一次 `moveWorkspace(id, {after_id})`；乐观更新 + 失败回滚刷新。
3. 边缘投放带：拖起（DragStart）时网格上下滑入两条虚线投放带（DndContext 外置 droppable）；下带发 `{to: "next_page_head"}`、上带发 `{to: "prev_page_tail"}`（服务端解析锚点，Grill F-01 修订——客户端锚点在本页边界卡上算不出跨页落位）；第 1 页无上带、末页无下带。落带 → move 成功 → 按响应 `rank` 换算页码 `setPage` → 该卡按主题 token accent/info 青色高亮 1.6s（闭环反馈，D-003；高亮取值走 §0.5 主题系统，不硬编码 hex）。
4. 「移动到…」弹窗（antd Modal + Select）：目标页（1..N，按默认视图分页）+ 页首/页尾。选定目标页后前端先拉取该页内容（现有 `listWorkspaces` 默认视图 + offset，仅持当前页数据是现状），锚点按方向区分（Grill F-02 修订，消除移除被拖卡后的 off-by-one）：**页首**——向上移动 `before_id=目标页第一张` / 向下移动 `after_id=目标页第一张`；**页尾**——向上移动 `before_id=目标页最后一张` / 向下移动 `after_id=目标页最后一张`；目标页=当前页时页首走 before_id、页尾走 after_id；锚点即被拖卡自身时跳过请求（自锚服务端 422 兜底）。「某卡前后」的精确落位由页内拖拽覆盖，弹窗不重复提供（D-009@v2）。
5. 筛选保护：q/type/unclassified/status≠active/user_id 任一激活 → 手柄禁用态（可见但灰显，cursor-not-allowed）+ 筛选条内提示"筛选状态下不可拖拽排序"，投放带与「移动到…」菜单入口同步禁用（D-005@v2）。管理员 `include_deleted=true`（含删除视图）同样属非默认视图，禁拖规则一致。
6. `pnpm gen:types` 再生成 api-types（新端点），提交 openapi.json + api-types.ts。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/workspace/model.py | 新增 `UserWorkspaceOrder` SQLModel 模型（表 `user_workspace_orders`） |
| 新增 | NEW:backend/migrations/versions/<rev>_create_user_workspace_orders.py | 建表 + 唯一索引 (user_id, workspace_id) + (user_id, sort_position) 索引 |
| 修改 | backend/app/modules/workspace/schema.py | 新增 `WorkspaceMoveRequest`（after_id/before_id/to 三选一 + page_size）与 `WorkspaceMoveResponse`（workspace/rebalanced/rank） |
| 修改 | backend/app/modules/workspace/router.py | 新增 `POST /{workspace_id}/move` 端点（鉴权 WORKSPACE_READ + 行级可见校验）；list 端点透传 `order_user_id=user.id` |
| 修改 | backend/app/modules/workspace/service.py | `WorkspaceService` 新增 `move_workspace()`（幂等 backfill/to 锚点解析/中点/整集重排/rank）与私有 `_backfill_order_rows()`；`list_with_owner()` 增 `order_user_id` 参数改 LEFT JOIN 排序 |
| 新增 | NEW:backend/app/modules/workspace/tests/test_move_order.py | move 端点/幂等 backfill（重复 move 不重复插入）/中点重排/to 枚举分页数学（下页页首/上页页尾/越界收敛）/锚点 422（不可见/自锚/第 0 页 prev）/backfill 后新建卡落位 D-004 回归/列表排序回归（无行用户=created_at desc）/**分页数量不变量**（move 前后各页条数=PAGE_SIZE、total 不变、无重复 id） |
| 修改 | frontend/package.json | 新增 dependencies `@dnd-kit/core`、`@dnd-kit/sortable` |
| 新增 | NEW:frontend/src/components/workspace-drag-grid.tsx | DndContext 网格 + 边缘投放带 + 落位高亮 + 移动到弹窗（组合现有 WorkspaceCard） |
| 修改 | frontend/src/app/(dashboard)/workspaces/page.tsx | 接入 WorkspaceDragGrid（默认视图启用、筛选态禁用）、翻页高亮状态、moveWorkspace 调用与乐观更新 |
| 修改 | frontend/src/components/workspace-card.tsx | 卡片加拖拽手柄挂点（forwardRef/listeners 注入 props，默认不渲染保持他处兼容） |
| 修改 | frontend/src/lib/workspaces.ts | 新增 `moveWorkspace(id, {after_id?|before_id?|to?, page_size?})` 封装 |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 再生成（producer=后端 openapi → consumer=前端 api-types，字段数据流见接口定义） |
| 修改 | backend/openapi.json | 随 FastAPI schema 导出更新（gen:types 输入源） |
| 新增 | NEW:frontend/src/components/__tests__/workspace-drag-grid.test.tsx + page 测试增补 | 投放带显隐边界（首页/末页/筛选态）/落带 to 参数/页内 after_id/弹窗方向锚点/筛选禁拖/自锚跳过/rank 换算页码（测试路径从 components/__tests__/ 惯例，Grill F-11） |

**对外字段数据流**：`move` 请求体 `{after_id|before_id|to}` + 响应 `{workspace, rebalanced, rank}`：producer=前端拖拽落位/边缘投放带/移动到弹窗（workspace-drag-grid.tsx：页内拖拽算 id 锚点、投放带只发 to 枚举、弹窗按方向规则选 id 锚点）→ `moveWorkspace()`（frontend/src/lib/workspaces.ts，POST JSON）→ consumer=router `WorkspaceMoveRequest`（pydantic 三选一校验）→ service `move_workspace()`；响应 `rank` 反向流：service 计算默认视图 rank → WorkspaceMoveResponse → 前端 `floor(rank/page_size)` 换算目标页驱动自动翻页。列表顺序本身不新增响应字段：消费侧只依赖列表行的**相对顺序**（producer=service `list_with_owner` LEFT JOIN ORDER BY → consumer=page.tsx `items` 渲染顺序），`sort_position` 不出现在任何 DTO/响应体中。

## 接口定义

```
POST /api/workspaces/{workspace_id}/move
鉴权：require_permission_any(Permission.WORKSPACE_READ)（措辞对齐列表端点现状 backend/app/modules/workspace/router.py:269；行级可见=非平台管理员需 workspace_id ∈ allowed_workspace_ids(user)，403）
Request WorkspaceMoveRequest（锚点三选一，恰好一个出现，否则 422 HTTP_422_MOVE_ANCHOR_CONFLICT）：
  after_id:  uuid | 不出现   # 放到锚点卡之后（页内拖拽 / 弹窗向下·页尾）
  before_id: uuid | 不出现   # 放到锚点卡之前（弹窗向上·页首/页尾）
  to: "next_page_head" | "prev_page_tail" | 不出现   # 边缘投放带（服务端默认视图序列解析）
  page_size: int = 12        # 可选；to 路径专用，与前端 PAGE_SIZE 常量同源
  —— 无 null 置顶语义（Grill F-03 修订：pydantic 无法区分缺省与 null，"null=置顶"与"同缺 422"自相矛盾；置顶场景由弹窗页首锚点表达）
锚点校验（422，错误文案中文，HTTP_422_MOVE_ANCHOR_NOT_VISIBLE / _SELF）：
  - 锚点卡不存在 / 不在可见集合 / deleted_at 非空 / status ∉ {active, archived}（与 backfill 物化范围对齐，Grill F-08）
  - 锚点为被移动卡自身（自锚；Grill F-09）
  - to="prev_page_tail" 且被移动卡在第 0 页
Response 200 WorkspaceMoveResponse（*Response 后缀从 schema.py 惯例，Grill F-10）:
  { "workspace": WorkspaceRead, "rebalanced": bool, "rank": int }
  rebalanced=true 表示本次触发整集重排（诊断用）
  rank = 移动后该卡在默认视图序列中的 0 基序号（前端 page = floor(rank/page_size)，驱动落带自动翻页，风险 R-07 依据）
```

```python
# service.py
async def move_workspace(
    self, *, workspace_id: uuid.UUID, user_id: uuid.UUID,
    after_id: uuid.UUID | None, before_id: uuid.UUID | None, to: str | None,
    page_size: int, allowed_ids: list[uuid.UUID] | None,   # None=平台管理员
) -> tuple[Workspace, bool, int]   # (workspace, rebalanced, rank)

async def _backfill_order_rows(self, *, user_id: uuid.UUID, allowed_ids: list[uuid.UUID] | None) -> None
# 幂等：INSERT..SELECT WHERE NOT EXISTS，每次 move 事务首步执行（含锚点无行物化，Grill F-04）
# list_with_owner 新增 keyword-only 参数 order_user_id: uuid.UUID（排序 JOIN 用，与筛选 user_id 语义独立）
```

backfill / 锚点解析 / 中点 / 重排算法见「总体方案」Wave 1；所有写路径单事务。

## 生命周期契约表

不涉及生命周期契约

## 数据模型

```sql
CREATE TABLE user_workspace_orders (
  id            UUID PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id),
  workspace_id  UUID NOT NULL REFERENCES workspaces(id),
  sort_position DOUBLE PRECISION NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX ux_uwo_user_workspace ON user_workspace_orders(user_id, workspace_id);
CREATE INDEX ix_uwo_user_position ON user_workspace_orders(user_id, sort_position);
```

- 排序语义：`sort_position ASC`；行缺失（新建工作区/未物化用户）按 D-004 落最前。
- 无存量回填：首拖惰性物化（D-006）。
- 软删 workspace 的排序行保留（复活回原位）；不做级联清理（量小，保留成本为零）。

## 兼容策略（brownfield 必填）

- 未拖拽用户：排序表零行，列表 SQL 的 NULLS 分支退化为 `created_at DESC` = 现状，行为完全不变。
- 旧客户端/未接入拖拽的前端：不调用 move，无感知；列表接口无 breaking change（不加必填 Query 参数，`order_user_id` 由 router 内部注入）。
- 回退路径：move 端点独立新增，回滚 = 前端不渲染手柄；排序表存在但不 JOIN 即回到现状排序（ORDER BY 分支由 `order_user_id` 有无决定——恒传入，但零行时行为等价）。
- 不改变的 API/表结构：workspaces 表零改动；既有 PATCH /workspaces/{id}（别名等）不动。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 浮点中点精度耗尽（两卡位置贴死） | P1 | 中点==邻居值时同事务整集重排（1024×i）后重算；`rebalanced` 字段暴露诊断 |
| R-02 | @dnd-kit 与 antd 6/React 18 组合兼容性 | P2 | dnd-kit 官方支持 React 18；网格 sortable 为其核心场景；原型已验证交互形态 |
| R-03 | LEFT JOIN + ORDER BY 在数据增长后的列表性能 | P2 | (user_id, sort_position) 索引；一两百量级实测无压力；超过千级再评估（超本期量级假设） |
| R-04 | 同用户多标签页并发拖拽互相覆盖 | P2 | D-008 后写覆盖，接受；move 成功即 reload 收敛 |
| R-05 | 管理员按 user_id 筛选看到的仍是自己的顺序，语义易误解 | P1 | D-005 定案；UI 在筛选激活时本就禁拖 + 文档明示 |
| R-06 | 拖拽手柄与整卡点击进详情的手势冲突 | P2 | 仅手柄承载 drag listeners（PPM 同款先例 frontend/src/components/ppm-sub-table.tsx:350）；卡体点击不受影响 |
| R-07 | 边缘投放带落带后目标页计算错误（页边界漂移） | P1 | move 响应携带服务端计算的默认视图 `rank`，前端 `floor(rank/page_size)` 换算页码，不本地推算（Grill F-01/F-02 修订后主路径） |
| R-08 | `to` 路径 page_size 与前端 PAGE_SIZE 常量漂移（改一处漏一处） | P2 | 请求显式携带 page_size（默认 12）+ 接口文档写明同源耦合；前端单一常量导出供两处引用 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 数据模型（user 维度表）；设计目标 1 | 已覆盖 |
| D-002@v1 | 非目标（不做无限滚动）；总体方案 Wave 2 沿用分页 | 已覆盖 |
| D-003@v1 | 总体方案 Wave 2-3（投放带 + 翻页高亮） | 已覆盖 |
| D-004@v1 | 总体方案 Wave 1-3 列表排序 NULLS 分支；数据模型排序语义；backfill 显示序零变化约束 | 已覆盖 |
| D-005@v2 | 总体方案 Wave 2-5 筛选禁拖（手柄禁用态而非隐藏）；风险 R-05 | 已覆盖 |
| D-006@v2 | 总体方案 backfill 物化（幂等每次执行 + 递增位置公式勘误）；数据模型软删行保留 | 已覆盖 |
| D-007@v1 | 接口定义鉴权段（WORKSPACE_READ + allowed_workspace_ids + 锚点 422） | 已覆盖 |
| D-008@v1 | 风险 R-04（后写覆盖） | 已覆盖 |
| D-009@v2 | 总体方案 Wave 2-4「移动到…」弹窗（页首/页尾 + 方向锚点规则；某卡前后由页内拖拽覆盖） | 已覆盖 |
| D-010@v1 | 文件变更清单（@dnd-kit/core + sortable）；风险 R-02 | 已覆盖 |
| D-011@v1 | 总体方案 Wave 1（方案 A 全部要素：排序表/浮点中点/锚点端点/LEFT JOIN） | 已覆盖 |
| D-012@v1 | 总体方案「锚点解析」；接口定义 `to` 枚举与 rank 响应；风险 R-07/R-08（Grill F-01/F-02 修复） | 已覆盖 |
| D-013@v1 | 接口定义请求契约（三选一锚点/无 null 置顶/自锚 422/锚点可见性判据）；backfill 幂等段（Grill F-03/F-04/F-08/F-09 修复） | 已覆盖 |
| D-014@v1 | 设计目标 6（分页数量不变量）；文件变更清单 test_move_order.py 断言项（用户指令） | 已覆盖 |

无未解决决策；方案 B/C 淘汰记录见 decisions.md D-011；Grill 修订来源（F-01~F-12）见 decisions.md D-005@v2/D-006@v2/D-009@v2/D-012/D-013。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/数据模型/兼容策略/风险登记/决策追踪）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-001@v1~D-011@v1（决策追踪表逐条对账，无遗漏）
- [x] 生命周期关键词核对：本文提及"守护进程徽标/daemon 状态"仅为卡片展示性内容，不涉及会话/租约/状态迁移契约——已写紧邻豁免短语「不涉及生命周期契约」
- [x] UI 原型：变更目录已有 prototype-workspace-drag-sort.html（新交互流程级，分级=必须生成）
- [x] 字段数据流标注：move 请求体 after_id/before_id/to 与响应 rank、隐式列表顺序的 producer→consumer 链已写入文件变更清单
- [x] Design Grill（tier=independent 子代理）12 项发现全部处置：F-01/F-02/F-03/F-04/F-08/F-09 → D-012/D-013 修订；F-05/F-06/F-07 → D-005@v2/D-006@v2/D-009@v2 勘误；F-10/F-11/F-12 → 惯例修订（Response 后缀/__tests__ 路径/主题 token）；原型 JS 分页数学同步修复
- [x] 无「⚠️ 自审存疑」项
