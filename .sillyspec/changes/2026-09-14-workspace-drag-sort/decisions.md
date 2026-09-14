---
author: qinyi
created_at: 2026-09-14 02:21:02
generated_by: sillyspec-fourpiece-init
change: 2026-09-14-workspace-drag-sort
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->

## D-001@v1: 顺序归属——每人一套（user-scoped order）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 拖拽产生的顺序是全局共享还是每用户独立？
- answer: 每人一套（用户 2026-09-14 explore 会话 AskUserQuestion 亲答）。新表 `user_workspace_orders(user_id, workspace_id, sort_position)`。
- normalized_requirement: 排序数据按 user_id 隔离；任何用户的拖拽不得影响其他用户看到的顺序。
- impacts: [FR-数据层, task-后端迁移, task-move端点]
- evidence: explore 会话（已归档，2026-09-14 `--done` 摘要）
- 模块域: backend

## D-002@v1: 保留服务端分页（量级一两百）
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 工作区总数预期与分页去留？
- answer: 一两百个量级，服务端分页（12/页 limit/offset）保留，不做"加载全部"改造。
- normalized_requirement: 列表接口分页语义不变；跨页能力由边缘投放带提供，不靠消灭分页。
- impacts: [FR-交互层]
- evidence: explore 会话 AskUserQuestion 亲答
- 模块域: backend, frontend

## D-003@v1: 跨页交互——边缘投放带
- type: architecture
- priority: P0
- status: superseded
- source: user
- question: 拖着的卡片如何越过页边界？
- answer: 边缘投放带：拖拽时页面上下浮现投放区；下带=放到本页最后一张之后（after_id），上带=放到本页第一张之前（before_id）。落带后自动翻到目标页并高亮该卡闭环。
- normalized_requirement: 第 1 页不显示上带；最后一页不显示下带；落带后前端跳转目标页并高亮被移动卡片。
- impacts: [FR-交互层, task-前端投放带]
- evidence: explore 会话 AskUserQuestion 亲答

## D-004@v1: 新建工作区落位——最前
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: 新建的工作区（无排序行）在已物化用户列表中落最前还是最后？
- answer: 最前。与现状 `created_at DESC`（最新在前）感知一致；SQL 语义=排序行缺失（NULL）优先于一切已有位置。
- normalized_requirement: 列表 SQL 中无 order 行的 workspace 排在所有有 order 行的之前，无行之间按 created_at DESC。
- impacts: [task-列表排序SQL]
- evidence: `backend/app/modules/workspace/service.py:420`（现状 created_at desc）；惯例默认，低风险内联
- 模块域: backend

## D-005@v1: 筛选/搜索/按人筛选激活时禁用拖拽
- type: boundary
- priority: P1
- status: superseded
- source: docs
- question: 过滤视图下（子序列）锚点拖拽语义模糊，是否允许？
- answer: 禁用。默认视图（status=active、无类型筛选、无搜索、无人员筛选）之外一律禁拖：手柄隐藏 + 提示"清除筛选后可手动排序"。「移动到…」菜单同样只在默认视图出现。
- normalized_requirement: q/type/unclassified/status≠active/user_id 任一生效时，前端不渲染拖拽手柄与投放带。
- impacts: [FR-交互层, task-前端]
- evidence: explore 定稿；子序列中两可见卡之间可能隔着不可见卡，锚点无唯一落位

## D-006@v1: backfill 物化范围——可见 ∩ status IN (active, archived)
- type: architecture
- priority: P1
- status: superseded
- source: code
- question: 用户首次拖拽时物化哪些 workspace 的排序行？
- answer: 该用户可见集合中 status 为 active 与 archived 的全部行（deleted 软删行不占位）。归档行保留位置，恢复（un-archive）后回到原位，符合直觉。
- normalized_requirement: backfill = INSERT ... SELECT 对 (用户可见 ∧ status IN ('active','archived')) 按 created_at DESC 赋 sort_position 递减序列；同一事务内完成 backfill + 首次移动。
- impacts: [task-后端move端点]
- evidence: 内联决策（工程判断）：恢复保位 vs 落最前，保位无额外成本且更符合直觉

## D-007@v1: move 端点鉴权——登录 + 对目标 workspace 有 WORKSPACE_READ
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: 谁能调用 move（改自己的顺序）？
- answer: 登录用户且对目标 workspace 具备 WORKSPACE_READ（与列表可见性一致）。per-user 顺序只影响本人视图，无需管理员/owner 门槛。锚点目标卡（after_id/before_id）不在该用户可见集合时 422。
- normalized_requirement: `POST /workspaces/{id}/move` 鉴权=WORKSPACE_READ；锚点卡不在用户可见集合返回 422 错误码。
- impacts: [task-move端点]
- evidence: `backend/app/modules/workspace/router.py:266`（列表鉴权同源）；D-001 使全局写权限问题消失
- 模块域: backend

## D-008@v1: 并发策略——后写覆盖，无乐观锁
- type: risk
- priority: P2
- status: accepted
- source: code
- question: 同一用户多标签页同时拖拽如何处理？
- answer: 后写覆盖（last-write-wins）。顺序仅影响本人视图，冲突代价为零；前端 move 成功后 reload 当前页即可收敛。不加版本号/乐观锁。
- normalized_requirement: move 端点无版本校验；响应后前端刷新列表。
- impacts: [task-move端点, task-前端]
- evidence: D-001 推论；YAGNI
- 模块域: backend

## D-009@v1: 「移动到…」菜单纳入本期范围
- type: boundary
- priority: P1
- status: superseded
- source: user
- question: 拖拽之外的显式移动入口是否本期做？
- answer: 做。卡片菜单「移动到…」：选目标页（按默认视图分页）+ 页内位置（页首/页尾/某卡前后），作为拖拽兜底并覆盖键盘/无障碍场景。
- normalized_requirement: 默认视图下每张卡提供「移动到…」入口，提交走同一 move 端点。
- impacts: [FR-交互层, task-前端]
- evidence: explore 定稿方案含此项，用户立项指令原样复述

## D-010@v1: 前端拖拽库——@dnd-kit/core + @dnd-kit/sortable
- type: architecture
- priority: P1
- status: accepted
- source: docs
- question: 网格拖拽用什么实现？原生 HTML5（PPM 先例、零依赖）还是引入库？
- answer: 引入 @dnd-kit/core + @dnd-kit/sortable（两者皆新依赖）。理由：1/2/3 列响应式网格的落点判定与位移动画，原生 HTML5 需手写碰撞检测且体验糙；dnd-kit 轻量、支持网格 sortable、键盘无障碍内置。
- normalized_requirement: 前端新增 dependencies @dnd-kit/core 与 @dnd-kit/sortable；不引入 dnd-kit 之外的 DnD 库。
- impacts: [task-前端]
- evidence: PPM `ppm-sub-table.tsx:350` 原生方案仅适用单列内存表格；`frontend/package.json` 现无 DnD 库
- 模块域: frontend

## D-011@v1: 数据层实现——方案 A（排序表 + 浮点中点锚点）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 顺序存储与移动语义选 A（排序表+浮点中点）/ B（JSON 数组全量重写）/ C（前端本地存储）？
- answer: 方案 A（用户 brainstorm Step 4 AskUserQuestion 亲选）。理由：唯一同时满足锚点跨页（客户端只需边界卡 id）+ 保住现有服务端 limit/offset 分页与四路筛选 SQL（LEFT JOIN 原生 ORDER BY）+ 每次拖拽 O(1) 单行写入；B 把排序挤到应用层与分页 SQL 冲突且全量写放大；C 跨设备不同步、分页下无法独立排序。淘汰记录：B 违反 D-002 精神（架空服务端分页）、C 违反 D-001（顺序非服务端持久）。
- normalized_requirement: 新表 user_workspace_orders(user_id, workspace_id, sort_position DOUBLE PRECISION)；move 端点锚点语义；列表 LEFT JOIN 排序；中点法更新单行，精度耗尽（邻居中点==邻居值或超出阈值）时单事务整集重排。
- impacts: [FR-数据层, task-后端迁移, task-move端点, task-列表排序SQL]
- evidence: brainstorm Step 4 方案选择轮（2026-09-14）；方案 B/C 对比表见该轮对话
- 模块域: backend, frontend

## D-005@v2: 筛选态手柄形态——禁用态而非隐藏
- type: boundary
- priority: P1
- status: accepted
- supersedes: D-005@v1
- source: design-grill
- question: v1 措辞"手柄隐藏/不渲染"与 design"禁用态"打架（Grill F-05），以哪个为准？
- answer: 禁用态：手柄可见但灰显（cursor-not-allowed）+ 筛选条内提示。可发现性优于隐藏——用户在筛选态能看见"有排序功能但被保护"，而非以为功能不存在。
- normalized_requirement: 筛选/搜索/按人筛选激活时手柄渲染为禁用态（不响应拖拽），提示文案"筛选状态下不可拖拽排序"；投放带与「移动到…」入口同样禁用。
- impacts: [FR-交互层, task-前端]
- evidence: design.md Wave 2-5；Grill F-05
- 模块域: frontend

## D-006@v2: backfill 幂等化 + 位置方向勘误
- type: architecture
- priority: P1
- status: accepted
- supersedes: D-006@v1
- source: design-grill
- question: v1"首次拖拽才物化 + 递减序列"两处不成立（Grill F-04/F-06）：backfill 后新建卡无行，作锚点时中点不可计算；ASC 排序下初始位置应递增非递减。
- answer: ①backfill 幂等化：每次 move 事务首步 INSERT..SELECT WHERE NOT EXISTS，对（可见 ∧ active+archived ∧ 无行）全集物化，无行组整体赋在现有最小位置之下、组内 created_at DESC——锚点卡永远有行，物化前后显示序零变化。②初始/新增物化位置按 created_at DESC 赋 row_number×1024 **递增**序列（v1"递减"为笔误，display 顺序语义以 design 公式为准）。
- normalized_requirement: move 事务首步幂等物化；新增排序行位置 < 现有最小位置且组内保持 created_at DESC；无"锚点无行"输入域。
- impacts: [task-后端move端点, test_move_order.py]
- evidence: design.md Wave 1 backfill 段；Grill F-04/F-06
- 模块域: backend

## D-009@v2: 「移动到…」弹窗范围收敛——页首/页尾 + 方向锚点
- type: boundary
- priority: P1
- status: accepted
- supersedes: D-009@v1
- source: design-grill
- question: v1 含"某卡前后"，design 弹窗仅页首/页尾且未对账（Grill F-07）；页首/页尾锚点还存在跨页方向 off-by-one（Grill F-02）。
- answer: 弹窗仅保留页首/页尾（用户 Step 5 确认的设计形态），"某卡前后"精确落位由页内拖拽覆盖不重复提供。锚点按移动方向区分：页首=向上 before_id 目标页第一张/向下 after_id 目标页第一张；页尾=向上 before_id 目标页最后一张/向下 after_id 目标页最后一张；目标页内容先经现有列表接口拉取；锚点为自身时前端跳过请求。
- normalized_requirement: 弹窗提交前拉取目标页默认视图数据；锚点按方向规则计算；自锚不发请求（服务端 422 兜底）。
- impacts: [FR-交互层, task-前端]
- evidence: design.md Wave 2-4；Grill F-02/F-07
- 模块域: frontend

## D-012@v1: 边缘投放带锚点由服务端页相对解析（to 枚举 + rank 响应）
- type: architecture
- priority: P0
- status: accepted
- source: design-grill
- question: 客户端锚点（after_id=本页末卡/before_id=本页首卡）在 limit/offset 分页下落位恒为本页边界槽位，跨页永不发生（Grill F-01，P0）；客户端不持有相邻页数据，怎么表达跨页落位？
- answer: 投放带请求改 `{to: "next_page_head"|"prev_page_tail"}`（可选 page_size 默认 12），服务端在默认视图有序序列（可见 ∧ active ∧ 未删，按显示序）上定位被移动卡 rank、按分页数学解析目标插入 rank，再走统一中点路径；响应携带移动后 rank，前端 floor(rank/page_size) 换算目标页自动翻页+高亮。否决客户端预取相邻页方案：每次拖拽多两请求且边界卡在并发移动下会过期，分页数学在客户端重复实现必再出 off-by-one。
- normalized_requirement: move 端点接受 to 枚举锚点；服务端单点实现分页解析；响应含 rank；越界收敛到序列尾/首；第 0 页 prev_page_tail 422。
- impacts: [task-move端点, task-前端投放带, 风险 R-07/R-08]
- evidence: Grill F-01 推演（24/36 卡算例）+ 原型 JS 实测；design.md「锚点解析」段
- 模块域: backend, frontend

## D-013@v1: move 请求契约修订——三选一锚点、无 null 置顶、自锚 422
- type: architecture
- priority: P1
- status: accepted
- source: design-grill
- question: v1 契约三处不可实现/未定义（Grill F-03/F-08/F-09）：after_id:null 置顶与"同缺 422"在 pydantic 下不可区分；锚点"可见集合"缺精确判据；自锚（锚点=被移动卡）未定义。
- answer: ①锚点三选一：after_id / before_id / to 恰好一个出现，全为非 null uuid 或枚举值；置顶场景由弹窗页首锚点表达，删除 null 置顶语义。②锚点有效性 = 存在 ∧ 在可见集合 ∧ deleted_at IS NULL ∧ status ∈ {active, archived}（与 D-006@v2 物化范围对齐），违反 422 HTTP_422_MOVE_ANCHOR_NOT_VISIBLE。③自锚 422 HTTP_422_MOVE_ANCHOR_SELF（前端正常流程不会发，作契约兜底）。
- normalized_requirement: WorkspaceMoveRequest 三选一校验；三类 422 错误码 + 中文文案；错误码命名沿用项目大写蛇形惯例。
- impacts: [task-move端点, test_move_order.py]
- evidence: Grill F-03/F-08/F-09；schema.py *Response/*Request 惯例
- 模块域: backend

## D-003@v2: 边缘投放带锚点表达改 to 枚举（UX 不变）
- type: architecture
- priority: P0
- status: accepted
- supersedes: D-003@v1
- source: design-grill
- question: v1"下带=after_id 本页末卡/上带=before_id 本页首卡"经 Grill F-01 证伪（该锚点落位恒为本页边界槽位，跨页永不发生），投放带交互路线是否维持？
- answer: 维持边缘投放带路线（用户 explore 亲选的 UX 不变），仅锚点表达从客户端 id 锚点改为 `{to: next_page_head|prev_page_tail}` 服务端解析（D-012）。v1 的锚点写法作废；翻页+高亮闭环承诺保留。
- normalized_requirement: 投放带请求 to 枚举；第 1 页无上带/末页无下带；落带按响应 rank 翻页并高亮。
- impacts: [FR-交互层, task-前端投放带, task-move端点]
- evidence: Grill F-01；平台复审 checklist#2/#8 指出 v1 未标 superseded 的对账缺口
- 模块域: backend, frontend

## D-014@v1: 分页数量不变量——move 是纯重排
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 重新排序后每页数量是否允许变化？
- answer: 不允许（用户 2026-09-14 明确约束）。move 只做单行 sort_position 更新，不增删任何行；任何移动后 total 不变、每页恒 PAGE_SIZE 张（末页允许不满），跨页移动=源页少一张/目标页多一张后重新切片。
- normalized_requirement: test_move_order.py 断言 move 前后 total 不变、各页条数=PAGE_SIZE、结果序列无重复 id、无空页；前端翻页高亮后页大小恒定。
- impacts: [设计目标 6, test_move_order.py, task-前端投放带]
- evidence: 用户 2026-09-14 brainstorm 进行中指示"重新排序后每页的数量不能变"
- 模块域: backend, frontend
