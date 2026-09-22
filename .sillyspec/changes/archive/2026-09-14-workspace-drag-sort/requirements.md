---
author: qinyi
created_at: 2026-09-14 02:21:02
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 普通用户 | 对自己可见的工作区集合拥有独立的拖拽排序权（WORKSPACE_READ 可见即可拖） |
| 平台管理员 | 全量可见；同样维护自己的顺序；按人员筛选（user_id）是过滤视图，看到的仍是自己的顺序且禁拖 |
| 未拖拽用户（隐式） | 无排序行的用户，视图必须与现状完全一致 |

## 功能需求

### FR-01: 每人一套排序持久化（D-001/D-011/D-006@v2）
Given 登录用户 U 在默认视图拖动工作区卡片或使用「移动到…」
When 一次 move 成功（单行 sort_position 更新，事务含幂等 backfill）
Then U 的列表按新顺序展示，刷新/换设备后保持；其他任何用户的列表与此前完全一致

### FR-02: move 锚点端点契约（D-013/D-007）
Given 用户对目标工作区具备 WORKSPACE_READ（非管理员还需行级可见）
When POST /workspaces/{id}/move 携带恰好一个锚点（after_id / before_id / to）
Then 服务端按锚点更新位置并返回 {workspace, rebalanced, rank}；锚点三选一违反→422 ANCHOR_CONFLICT；锚点不可见/软删/状态越界→422 ANCHOR_NOT_VISIBLE；自锚→422 ANCHOR_SELF；第 0 页 prev_page_tail→422

### FR-03: 列表默认排序接入（D-004/D-011）
Given 用户 U 打开列表（或任意筛选组合）
When 服务端执行 list_with_owner(order_user_id=U)
Then 结果按 (无排序行→最前, sort_position ASC, created_at DESC) 排列；无行用户与从未拖过的视图 = 现状 created_at DESC；四路筛选与 limit/offset 分页行为不变

### FR-04: 页内拖拽（D-003@v2/D-010）
Given 默认视图、无筛选激活、页内 ≥2 张卡
When 用户拖动卡片手柄落在本页某位置
Then 前端发一次 moveWorkspace(id, {after_id: 落位前邻卡})，乐观更新，失败回滚刷新；卡片手柄与整卡点击进详情不冲突

### FR-05: 边缘投放带跨页（D-003@v2/D-012）
Given 默认视图拖拽进行中
When 网格上下浮现投放带（第 1 页无上带、末页无下带）
Then 下带提交 {to:"next_page_head"}、上带提交 {to:"prev_page_tail"}（均含 page_size，默认 12）；成功后按响应 rank=floor(rank/page_size) 翻到目标页并按主题 token 青色高亮该卡 1.6s；被拖卡最终落位=下页页首/上页页尾

### FR-06: 「移动到…」弹窗（D-009@v2）
Given 默认视图某张卡的菜单
When 用户选目标页与页首/页尾并确认
Then 前端先拉取目标页默认视图数据，按方向规则计算 id 锚点（页首：向上 before/向下 after=目标页第一张；页尾对偶到目标页最后一张；同页：页首 before/页尾 after），提交 move；锚点为自身时跳过请求

### FR-07: 筛选态禁拖保护（D-005@v2）
Given q/type/unclassified/status≠active/user_id/include_deleted 任一激活
When 列表渲染
Then 手柄呈禁用态（可见灰显）+ 提示"筛选状态下不可拖拽排序"；投放带与「移动到…」入口同步禁用；不发任何 move 请求

### FR-08: 分页数量不变量（D-014）
Given 任意合法 move（页内/投放带/弹窗）
When 移动完成并重新分页
Then total 不变、每页恒 PAGE_SIZE 张（末页允许不满）、序列无重复 id、无空页/丢卡

## 非功能需求
- 兼容性：无排序行用户零行为变化；不改动 workspaces 表结构；旧客户端不调用 move 无感知；Windows/Linux/macOS 与双主题（blue/ai-native/dark）下高亮走主题 token
- 可回退：move 端点独立新增；前端不渲染手柄即回退；排序表存在但不 JOIN 时排序回到现状
- 可测试：后端 test_move_order.py 覆盖 FR-01/02/03/08 全部分支（含精度重排、幂等 backfill、D-004 回归）；前端 __tests__ 覆盖 FR-04/05/06/07；错误文案中文（l10n 守护）
- 性能：单次 move=1 行更新（重排兜底为单事务整集 ≤几百行）；列表查询 (user_id, sort_position) 索引支撑

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 顺序 per-user 隔离 |
| D-002@v1 | FR-03/05 | 分页保留，跨页靠投放带 |
| D-003@v2 | FR-05 | 投放带 UX + to 枚举表达 |
| D-004@v1 | FR-03 | 无行落最前（新建工作区） |
| D-005@v2 | FR-07 | 筛选禁拖（禁用态+菜单/投放带同步禁用） |
| D-006@v2 | FR-01/02 | 幂等 backfill + 递增位置公式 |
| D-007@v1 | FR-02 | move 鉴权与锚点可见性 422 |
| D-008@v1 | FR-04 | 后写覆盖、无乐观锁 |
| D-009@v2 | FR-06 | 弹窗页首/页尾 + 方向锚点规则 |
| D-010@v1 | FR-04 | @dnd-kit/core + sortable |
| D-011@v1 | FR-01/03 | 方案 A 全要素（排序表/中点/锚点/JOIN） |
| D-012@v1 | FR-05 | to 枚举服务端解析 + rank 响应 |
| D-013@v1 | FR-02 | 三选一契约/无 null 置顶/自锚 422/锚点判据 |
| D-014@v1 | FR-08 | 分页数量不变量（纯重排） |

全部当前版本决策均有 FR 覆盖，无剩余风险决策。
