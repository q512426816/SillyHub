---
author: WhaleFall
created_at: 2026-06-24T09:35:00
---

# kanban 矩阵 → 时间轴甘特图 UI 重做

变更名:`2026-06-24-kanban-gantt-ui`
关联原型:`prototype-kanban-gantt.html`
Design Grill:已执行(见 §10 修正记录),已修正 P0/P1。

## 1. 背景与目标

当前 `/ppm/kanban` 主体是 **人员×日期矩阵**(`KanbanMatrix` / `KanbanActualMatrix`):纵轴人员、横轴日期、单元格内放当日任务缩略卡。该结构看「单日谁做什么」直观,但**看不出任务跨天排期、并行重叠、排期冲突**。

目标:把主体改成**时间轴甘特图**——纵轴人员(多行泳道),横轴日期,任务以**跨日条形**呈现(`start→deadline` / `actual_start→actual_end`),一眼看清排期冲突和并行。其余功能区(筛选、日期导航、CRUD 弹窗、工时图、计划/实际两 tab)保留不动。

## 2. 需求(已与用户确认)

| 维度 | 决策 |
|------|------|
| 布局 | 时间轴甘特图:纵轴人员、横轴日期、任务跨日条形 |
| 并行任务排布 | **每人多行泳道**(同人多任务各占一行,贪心分配首个不冲突槽位) |
| 交互 | **只读 + 点击详情**(计划:点击 DetailDrawer + 右键 ContextMenu;实际:点击 ActualEditModal,沿用现有 Matrix 行为**无右键菜单**) |
| 计划/实际 | **保留两 tab**(计划甘特 `start→deadline` / 实际甘特 `actual_start→actual_end`) |
| 复用功能 | SearchBar、DateNav、WorkHourChart、Create/Edit/Assign Dialog、DetailDrawer、ContextMenu、ActualEditModal 全部保留 |
| 范围 | 时间轴范围跟随 `KanbanDateNav`(本周/上周/下周/自定义) |

## 3. 方案(方案 A 自研,已确认)

**自研甘特图**:人员泳道行(每人按并行任务数动态展开)+ 日期网格背景 + 任务条形 CSS 绝对定位。零新依赖,全 Tailwind + Design Token,契合「只读静态展示 + 多行泳道」需求。

排除方案 B(第三方库 frappe-gantt):其重功能(拖拽/依赖线/缩放)对只读需求是浪费,且原生单任务一行不支持多行泳道需 hack,与 antd/Tailwind 风格冲突。
排除方案 C(矩阵改造):矩阵是 cell-based(每日格),甘特是 bar-based(跨日条),渲染层要重写,改造工作量 ≥ 新写,且两 tab 要改两个矩阵组件。

## 4. 详细设计

### 4.1 组件结构

```
page.tsx (改:tab children Matrix → Gantt)
├── KanbanSearchBar            (复用,不动)
├── KanbanDateNav              (复用,不动)
├── Tabs
│   ├── plan:  <KanbanGantt .../>        (新增,替代 KanbanMatrix)
│   └── actual:<KanbanActualGantt .../>  (新增,替代 KanbanActualMatrix)
├── KanbanWorkHourChart        (复用,不动)
├── KanbanCreate/Edit/AssignTaskDialog  (复用,不动)
├── KanbanTaskContextMenu / DetailDrawer(复用,不动,仅计划 tab 用)
└── ActualEditModal            (复用,不动,仅实际 tab 用)

新增纯函数模块:kanban-gantt-helpers.ts
  - computeBarLayout(task, rangeStart, rangeEnd, dayWidth) → {left, width, clipped}
  - assignLanes(tasks) → { laneMap: Map<id, laneIndex>, rowCount }(贪心多行泳道)
```

**Props 接口——两个新组件各自对齐自己的 Matrix(不一致,见 Grill P0-2 修正)**:

| | KanbanGantt(计划,对齐 KanbanMatrix) | KanbanActualGantt(实际,对齐 KanbanActualMatrix) |
|---|---|---|
| 数据 | `tasks: KanbanTaskCard[]` | `executes: TaskExecuteWithPlan[]` |
| 条形字段 | `start_time → deadline` | `actual_start_time → actual_end_time` |
| 点击 | `onTaskClick` → DetailDrawer(**必填**) | `onEdit` → ActualEditModal(**必填**) |
| 右键 | `onTaskContextMenu`(**必填**) | **无**(对齐现状,实际 tab 无右键菜单) |
| 选中联动 | `selectedUserId`/`onSelectUser`(**必填**) | 可选(`?`) |
| 项目色 | `projectColorMap`(**必填**) | **无**(实际 Matrix 无此 prop) |

`page.tsx` 仅替换标签名 + 调整传参(实际 tab 不传 onTaskContextMenu/projectColorMap),改动最小。

### 4.2 甘特布局与条形定位(Grill P1-2/P2-2/P2-4 修正)

**统一布局常量(左右同源,避免 table + absolute 混用错位)**:
- `LANE_HEIGHT = 36px`(唯一行高常量,驱动左侧行头与右侧条形)
- `DATE_ROW_HEIGHT = 48px`(顶部日期刻度行,固定)
- `DAY_WIDTH = 90px`(每日列宽,横向滚动)
- 左侧行头每人区块 `height = rowCount × LANE_HEIGHT`;右侧该人 lanes 区 `height = rowCount × LANE_HEIGHT`。**左右用同一个 CSS Grid/绝对定位方案驱动**,不再混用 `<table>`。

**条形定位**:
- `totalDays = rangeEnd.diff(rangeStart,'day') + 1`
- 裁剪到范围:`effStart = max(taskStart, rangeStart)`,`effEnd = min(taskEnd, rangeEnd)`
- `left = effStart.diff(rangeStart,'day') × DAY_WIDTH`
- `width = (effEnd.diff(effStart,'day') + 1) × DAY_WIDTH - 间距`
- `top = DATE_ROW_HEIGHT + 该人之前所有人的 (rowCount × LANE_HEIGHT) 之和 + laneIndex × LANE_HEIGHT + 5`

**条形内容**:
- 项目色背景(计划复用 `projectColorMap`;实际用固定 token 色,因无 projectColorMap)。
- 标题:`truncate` + `title` 浮层(超长截断);条宽过窄(<40px)时只显项目色点。
- 状态/优先级 tag:`status`/`priority`/`progress` 均 **可空**,渲染需 null 兜底(无则不显 tag)。

**行头任务数**:取 `KanbanUserColumn.task_count`(store 已派生),**不重新计算**,避免与筛选数不一致。

### 4.3 多行泳道算法(贪心,纯函数,可单测)

```
assignLanes(tasks):  // tasks 已按 start 排序
  lanes = []  // lanes[i] = 第 i 行最后一个任务的 end
  for t in tasks:
    slot = findIndex(lanes, end => end <= t.start)  // 首个不冲突槽
    if slot >= 0: lanes[slot] = t.end; t.lane = slot
    else: lanes.push(t.end); t.lane = lanes.length - 1
  return { laneMap, rowCount: max(lanes.length, 1) }
```
每人独立计算 `rowCount`(至少 1 行)。同人并行任务分到不同 lane → 视觉上多行泳道,排期冲突一目了然。

### 4.4 边界处理(Grill P0-1/P2-1 修正)

**进时间轴的判定**:`start_time && deadline`(计划)/ `actual_start_time && actual_end_time`(实际)**同时存在**才进时间轴。**单边缺失也算未排期**(不按单日渲染)。

**未排期区归属**(按人归,非全局):
- 按 `user_id`(计划)/ `execute_user_id`(实际)归人,**每人泳道尾部**各放一个「未排期」子区(列表展示该人无日期的任务,点击仍触发对应回调)。
- `user_id`/`execute_user_id` 为 null 的任务 → 归到甘特底部**全局未排期区**。
- 实际视图 `plan_task` 为 null → 标题兜底 `"(无关联任务)"`(对齐 ActualEditModal 现有文案)。

**跨范围任务**:条形裁剪到范围边界 + 边缘渐变指示(暗示延伸)。
**`start_time > deadline`(两者都有但异常)**:兜底按 `deadline` 单日渲染,不报错。

### 4.5 计划 / 实际两视图

- **计划甘特**(`KanbanGantt`):数据 `tasks: KanbanTaskCard[]`,条形 `start_time → deadline`,点击 `onTaskClick` → DetailDrawer,右键 `onTaskContextMenu` → ContextMenu。
- **实际甘特**(`KanbanActualGantt`):数据 `executes: TaskExecuteWithPlan[]`,条形 `actual_start_time → actual_end_time`,点击 `onEdit` → ActualEditModal(仅 status=90 可编辑)。**无右键菜单**(对齐 KanbanActualMatrix 现状,TaskExecute 无 ContextMenu 适配)。
- 两者共用 `kanban-gantt-helpers` 的定位/泳道算法,差异仅在数据字段、点击回调、项目色来源。

### 4.6 样式与 Token(Grill P1-3 修正)

- 行头 `sticky left`、日期头 `sticky top`(双向滚动时表头常驻)。
- 周末列:`bg-amber-50`(tokens.color.amber 淡底)。
- **今天竖线**:渲染在**内容滚动容器内**(随横向滚动移动),`position:absolute; top:0; height:100%; left = 今天相对 rangeStart 的偏移 × DAY_WIDTH`;`z-index` 低于条形、高于周末背景列;仅今天在范围内时渲染。颜色 `tokens.color.error`(#ef4444)2px。
- 条形:项目色背景 + 圆角 + `shadow-sm` + `hover:shadow-md/-translate-y-px`。
- 选中人员行(联动工时图):行头高亮 `bg-blue-50`。

## 5. 文件变更清单(Grill P1-1 修正)

| 文件 | 动作 | 说明 |
|------|------|------|
| `_components/kanban-gantt.tsx` | 新增 | 计划甘特组件 |
| `_components/kanban-actual-gantt.tsx` | 新增 | 实际甘特组件 |
| `_components/kanban-gantt-helpers.ts` | 新增 | 条形定位 + 泳道算法(纯函数) |
| `_components/kanban-gantt-helpers.test.ts` | 新增 | 定位/裁剪/泳道分配单测 |
| `page.tsx` | 改 | tab children 换 Gantt;实际 tab 不传 onTaskContextMenu/projectColorMap;删旧 import |
| `_components/kanban-matrix.tsx` | 删除 | 被 KanbanGantt 替代(仅 page.tsx 引用,已确认) |
| `_components/kanban-actual-matrix.tsx` | 删除 | 被 KanbanActualGantt 替代(仅 page.tsx 引用,已确认) |
| `_components/kanban-actual-cell.tsx` | 删除 | 仅被 kanban-actual-matrix 引用,随之删 |
| `_components/kanban-grouping.ts` | **execute 阶段 grep 决定** | `groupByUserAndDate`/`groupByUserAndExecuteDate`/`dateRangeKeys`/`weekdayMeta` 仅被两个 Matrix 引用(Grill 确认),删 Matrix 后成死代码;**execute 前再 grep 全 frontend/src 确认该文件其余导出(`TaskDateBucket` 等)无其他引用**,无则删除整个文件,有则仅删 Matrix 专用函数 |

**不动**:`kanban-search-bar.tsx`、`kanban-date-nav.tsx`、`kanban-work-hour-chart.tsx`、`kanban-create/edit/assign-task-dialog.tsx`、`kanban-task-context-menu.tsx`、`kanban-task-detail-drawer.tsx`、`stores/kanban.ts`、`lib/ppm/kanban.ts`、后端(只读展示,无 API/数据模型变化)。

## 6. 数据契约(复用现有,不改;Grill P2-3 补可空性)

- `KanbanTaskCard`(`lib/ppm/types.ts`):`start_time`/`deadline`/`status`/`priority`/`progress`/`user_id` 均**可空**(`number|string|null`),条形/tag 渲染需 null 兜底;`start_time && deadline` 同时有才进时间轴。
- `TaskExecuteWithPlan`:`actual_start_time`/`actual_end_time` 可空;`plan_task` 可空(标题兜底);按 `execute_user_id` 归人。
- `KanbanUserColumn`:行头任务数取 `task_count`(store 派生,不重算)。
- `useKanbanStore`:`users`/`tasks`/`filters`/`fetchTasks` 等不变。

## 7. 决策记录

- **D-001@v1 甘特图自研(方案 A)**:只读静态展示 + 多行泳道需求下,第三方库重功能浪费且不支持多行泳道;矩阵改造工作量 ≥ 新写。自研零依赖 + 风格统一。
- **D-002@v1 多行泳道(贪心)**:同人多任务按 start 排序贪心分配首个不冲突槽位,行数动态。替代「同行堆叠」(密集遮挡)与「单行取主」(隐藏任务)。
- **D-003@v1 只读 + 点击详情**:先满足查看排期核心诉求,拖拽改期(需后端 update + 乐观更新 + 冲突校验)留作后续增强(YAGNI)。
- **D-004@v1 两新组件 Props 各自对齐 Matrix(不强行统一)**:计划/实际 Matrix 的 Props 本就不一致(实际无右键菜单/projectColorMap,selected 可选)。新 Gantt 各自对齐,不强行统一接口,避免引入实际 tab 不需要的 ContextMenu。
- **D-005@v1 定位/泳道抽纯函数 + 单测**:条形定位(日期→像素)和泳道分配是易错点(边界/跨范围/异常),抽 `kanban-gantt-helpers.ts` 纯函数 + 单测覆盖。
- **D-006@v1 统一行高常量驱动左右布局**:`LANE_HEIGHT`/`DATE_ROW_HEIGHT`/`DAY_WIDTH` 常量统一驱动左侧行头与右侧条形,左右用同一 CSS Grid/绝对定位(不混用 table),避免 sticky 行头与条形竖直错位。
- **D-007@v1 未排期区按人归 + 全局兜底**:无日期任务按 user_id/execute_user_id 归到每人泳道尾;null user 归底部全局区。比「全局一个区」更贴合「看每人排期」语义。

## 8. Trade-off / 风险

- **横向滚动 + sticky 表头性能**:人员多/范围长时 DOM 条形多。缓解:`DAY_WIDTH=90px` 横向滚动(不渲染范围外日期列),条形按需裁剪;若超大可后续虚拟化(YAGNI 暂不做)。
- **DAY_WIDTH 固定 90px**:范围越长横向滚动越宽。可接受(甘特图标准交互);动态按容器宽度算会破坏条形定位一致性,不做。
- **删除 Matrix + grouping.ts**:execute 前 grep 确认无其他引用后删除,避免死代码。

## 9. 验收标准

1. `/ppm/kanban` 计划 tab 渲染甘特图:人员泳道(多行)+ 日期刻度 + 跨日任务条形,条形位置/宽度与 `start→deadline` 一致。
2. 同人并行任务分到不同泳道行,无重叠遮挡;左侧行头与右侧条形竖直对齐(同 `LANE_HEIGHT`)。
3. 无 `start/deadline`(或单边缺失)任务进对应人的「未排期」区;`user_id` 为 null 进全局未排期区;跨范围任务条形裁剪 + 渐变指示。
4. 周末列高亮、今天竖线(今天在范围内时,随横向滚动定位)。
5. 计划:点击条形 → DetailDrawer,右键 → ContextMenu;实际:点击条形 → ActualEditModal,**无右键菜单**;两 tab 切换正常;实际条形用 `actual_start/end`。
6. 筛选(SearchBar)、日期导航(DateNav)、工时图(WorkHourChart)、Create/Edit/Assign 弹窗功能不回归。
7. `kanban-gantt-helpers` 单测覆盖定位/裁剪/泳道分配/null 兜底;`pnpm typecheck` 通过;现有 kanban 相关测试不回归。
8. 样式统一(Design Token,无散落 hex);行头任务数取 `KanbanUserColumn.task_count`。

## 10. Design Grill 修正记录

独立 agent 交叉审查发现并已修正:
- **P0-1** 未排期区归属歧义 → §4.4 明确按人归 + null user 全局区 + plan_task=null 兜底。
- **P0-2** Props 对齐描述错误 → §4.1/§4.5 改为各自对齐 Matrix(实际无右键/projectColorMap,selected 可选)。
- **P1-1** kanban-grouping.ts 死代码 → §5 纳入(execute grep 决定整删或删函数)。
- **P1-2** 行高对齐缺常量 → §4.2 + D-006 统一 `LANE_HEIGHT`/`DATE_ROW_HEIGHT`/`DAY_WIDTH`,左右同布局。
- **P1-3** 今天竖线实现层 → §4.6 明确内容层绝对定位 + z-index。
- **P2-1/2/3/4** 单边缺失算未排期 / 任务数取 task_count / null 兜底 / 标题截断 → 分别并入 §4.2/§4.4/§6。

## 11. 自审

写完 design.md 后的自洽性核对(对照实际代码):
- **数据契约**:`KanbanTaskCard.start_time/deadline/status/priority/progress/user_id` 均**可空**已确认(`types.ts:1119-1131`),§4.4/§6 已覆盖 null 兜底;`TaskExecuteWithPlan.actual_*/plan_task/execute_user_id` 可空已确认,§4.4/§4.5 覆盖。
- **Props 对齐**:Grill 已核对 `KanbanMatrix`(`onTaskClick`+`onTaskContextMenu`+`projectColorMap`+必填 selected)与 `KanbanActualMatrix`(`onEdit` 单回调、selected 可选、无右键/无 projectColorMap)的实际定义,§4.1 表格 + D-004 修正。
- **删组件引用**:Grill grep 确认 `kanban-matrix`/`kanban-actual-matrix` 仅 `page.tsx` 引用、`kanban-actual-cell` 仅 `kanban-actual-matrix` 引用;`kanban-grouping.ts` 的 Matrix 专用函数(`groupByUserAndDate` 等)仅被两 Matrix 引用,execute 阶段复核后清理(§5)。
- **行高对齐**:D-006 用 `LANE_HEIGHT`/`DATE_ROW_HEIGHT`/`DAY_WIDTH` 统一驱动左侧行头与右侧条形,左右同一 CSS Grid/绝对定位,避免 table + absolute 混用错位。
- **今天竖线**:§4.6 明确渲染在内容滚动容器内(随横向滚动),z-index 低于条形高于周末背景。
- **未覆盖(已知 YAGNI)**:超大人员数的虚拟滚动(§8 风险已记);拖拽改期(D-003 留后续)。
- **结论**:design 内部自洽,核心方案(自研 + 贪心泳道 + 纯函数单测 + Props 各自对齐 + 统一行高常量)成立,可进入 plan。

## 12. 非目标(Non-goals)

本期**不做**(防止 scope creep):
- **拖拽改期**:拖条形改 start/deadline(需后端 update + 乐观更新 + 冲突校验),留后续增强(D-003)。
- **第三方甘特库**:frappe-gantt / gantt-task-react / dhtmlx 等(方案 B 已排除)。
- **任务依赖线 / 关键路径**:甘特图高级功能,本期只做静态排期展示。
- **虚拟滚动**:人员/范围超大时的 DOM 虚拟化(§8 风险,当前规模 YAGNI)。
- **后端改动**:只读展示,不改 API/数据模型/kanban store。
- **矩阵视图保留/切换**:Matrix 组件直接删除替换,不保留「矩阵/甘特」切换开关。
- **跨月/跨年长周期甘特**:范围跟随 DateNav(周级),不做月/年级缩放。
