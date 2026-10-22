---
author: qinyi
created_at: 2026-10-22 12:00:54
generated_by: sillyspec-design-init
scale: "small"
---

# 设计文档（Design）— 2026-10-22-trajectory-view-redesign

## 背景

轨迹视图（2026-10-22-session-trajectory-third-view 上线的三态之一）目前是 7 列紧凑网格 + 泳道 + 检查器，实测存在两个问题：一是面板挂在会话外层滚动容器内，向下滚动时顶部泳道/时间轴会一起滚走；二是账本信息密度与参考实现（dsh `packages/client/ui-trajectory`）差距明显，缺少工具栏、折叠、搜索与多标签详情，无法快速定位一轮对话中的关键调用。

用户提供 dsh 截图并要求「看 dsh 源码」整体重做轨迹面板，入口保持本项目「对话 / 进度 / 轨迹」三态不变。

## 设计目标

- 顶部固定：工具栏与时间线不随账本滚动，账本是唯一滚动区。
- 工具栏：时长（实际时长/等宽）、轮次展开收起、调用展开收起、搜索过滤。
- 账本：无表头两列紧凑表格，类型标签 + 摘要，折叠摘要行，子工具缩进。
- 详情：工具行四标签（概述/参数/结果/计时），其它行简化；宽度可拖拽，窄屏抽屉。
- 全部样式走 Tailwind 语义类 + `themes.ts` token，三主题自动换肤。

## 非目标

- 不新增后端 API、不改 daemon 协议、不向会话数据新增工具定义或请求级用量字段（Schema 标签按 D-007 隐藏）。
- 不把 dsh 的 request / 系统提示词变更 / 逐请求用量等无数据支撑的行搬进来（D-006）；产品路径与 dev 预览路径的可派生行型分开定义（依据 FR-06 / D-006）。
- `build-trajectory.ts` 零改动；`from-turn-views.ts` 仅允许本次补充工具行字段映射（raw/result）与行 id 稳定性，不改变既有轮/段语义。
- 不改变三态入口与视图持久化（沿用已归档的 2026-10-22-session-trajectory-third-view）。
- 不引入账本虚拟化库（沿用 `content-visibility`，D-006 范围内按实测决定）。

## 拆分判断

单变更交付：展示层组件族重构；`build-trajectory.ts` 零改动，`from-turn-views.ts` 仅补充工具行字段映射与行 id 稳定性（D-015）。文件之间是顺序装配依赖而非可并行任务簇，不适合 Wave 并行，也不构成批量模板场景。

## 总体方案

分三步实施：

1. **视图模型层**：新增 `trajectory-view-model.ts`，提供纯函数——按轮次分组、轮次/调用折叠、搜索过滤（AND 分词、大小写不敏感）、折叠摘要统计。全部纯函数，便于单测。
2. **组件族**：新增 `trajectory-toolbar.tsx`（四项控件）、`trajectory-ledger.tsx`（两列账本 + 折叠行 + 子工具缩进）、`trajectory-detail-panel.tsx`（标签页 + 可调宽 + 空态）；`trajectory-view.tsx` 改为装配层（持有折叠/搜索/选中状态并组合三件）。时间线复用 `trajectory-timeline.tsx`，新增 `scaleMode` prop（`duration` 实际时长 / `equal` 等宽），默认 `duration` 保持现状行为。
3. **宿主接线**：`turn-timeline.tsx` 中把 `showTrajectory` 的 JSX 分支**移出** `turn-timeline-scroll` 滚动容器（与它并列放在 `relative flex` 层），`TrajectoryPane` 根节点补 `h-full min-h-0` 建立高度链。轨迹视图下：pending AskUser 卡仍渲染在轨迹区域顶部的固定层（不参与账本滚动，保证可作答）；「回到底部」悬浮按钮、贴底跟随与滚动监听不生效（scrollRef 仅绑定对话/进度分支）。真码原型 `trajectory-redesign-view.tsx` 与原型注册已先行落盘，execute 直接对照搬组件。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:frontend/src/components/daemon/trajectory/trajectory-view-model.ts | 分组/折叠/搜索纯函数与类型（LedgerGroupView / LedgerRowView） |
| 新增 | NEW:frontend/src/components/daemon/trajectory/trajectory-toolbar.tsx | 工具栏：时长 toggle + 轮次/调用菜单 + 搜索输入（受控 props） |
| 新增 | NEW:frontend/src/components/daemon/trajectory/trajectory-ledger.tsx | 两列账本：轮次标签/竖线、类型标签、摘要、结果摘要、折叠行、子工具缩进 |
| 新增 | NEW:frontend/src/components/daemon/trajectory/trajectory-detail-panel.tsx | 详情：工具行四标签（概述/参数/结果/计时）、其它行概述+原始内容、可调宽、窄屏抽屉 |
| 修改 | frontend/src/components/daemon/trajectory/trajectory-view.tsx | 重写为装配层：持有 selectedRowId / 折叠集合 / 搜索词 / 时长模式，组合工具栏、时间线、账本、详情 |
| 修改 | frontend/src/components/daemon/trajectory/trajectory-timeline.tsx | 新增 `scaleMode?: "duration" \| "equal"`（默认 duration）；equal 为只读概览（禁缩放/平移/刷子/轴刻度，不拦截滚轮，见 D-016）；裁剪说明行/图例/覆盖率/重置，高度固定约 50px（D-017） |
| 修改 | frontend/src/components/daemon/trajectory/from-turn-views.ts | 工具行映射：inputText=segment.raw、outputText=segment.result ?? segment.primary；行 id 优先 segment.id、缺失时用 startedAt 组合（D-015） |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | `showTrajectory` 分支移出 `turn-timeline-scroll` 与滚动容器并列；`TrajectoryPane` 补 `h-full min-h-0`；轨迹下 pending 卡置顶固定、回底按钮/贴底跟随/滚动监听不生效 |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx | 按新账本结构适配既有断言（轮块让位/空态/选中语义不变） |
| 修改 | frontend/src/components/daemon/trajectory/__tests__/trajectory-timeline.test.tsx | 按 D-017 裁剪说明区后的节点结构适配（保留缩放/命中/等宽模式语义断言，不放宽既有行为） |
| 修改 | frontend/src/components/daemon/trajectory/__tests__/zoom.test.ts | 等宽模式禁用手势的分支核对（纯函数层面保持既有缩放计算断言） |
| 新增 | NEW:frontend/src/components/daemon/trajectory/__tests__/trajectory-view-model.test.ts | 分组、轮次/调用折叠、搜索过滤、摘要统计用例 |
| 新增 | NEW:frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx | 工具栏交互、账本行选中、折叠、详情标签渲染用例 |
| 修改 | frontend/src/components/prototype/trajectory-redesign-view.tsx | 真码原型源（已落盘，按定稿维护） |
| 修改 | frontend/scripts/prototype-build.mjs | 注册 trajectory-redesign-view 到原型构建列表 |

字段数据流：无对外字段/接口/DTO/事件 payload 变更；新增的 `scaleMode`、折叠集合、搜索词均为前端组件内部 props/state（producer=TrajectoryView 装配层 → consumer=Toolbar/Timeline/Ledger），不跨网络与存储边界。

## 接口定义

```ts
// trajectory-view.tsx（对外签名不变）
export interface TrajectoryViewProps {
  trajectory: Trajectory;
  selectedRowId?: string | null;
  onSelectRow?: (_rowId: string | null) => void;
  className?: string;
}

// trajectory-timeline.tsx（新增可选 prop，默认行为不变）
export interface TrajectoryTimelineProps {
  trajectory: Trajectory;
  selectedRowId?: string | null;
  onSelectRow?: (_rowId: string) => void;
  scaleMode?: "duration" | "equal"; // 默认 "duration"
  className?: string;
}

// trajectory-toolbar.tsx（受控）
export interface TrajectoryToolbarProps {
  query: string;
  onQueryChange: (_value: string) => void;
  scaleMode: "duration" | "equal";
  onScaleModeChange: (_mode: "duration" | "equal") => void;
  allTurnsCollapsed: boolean;
  onToggleAllTurns: () => void;
  allCallsCollapsed: boolean;
  onToggleAllCalls: () => void;
}

// trajectory-view-model.ts
export interface LedgerRowView { row: TrajectoryRow; kindLabel: string; summary: string; resultSummary?: string; hidden: boolean; }
export interface LedgerGroupView { turnIndex: number; rows: LedgerRowView[]; stepCount: number; toolCallCount: number; }
export interface LedgerViewOptions { collapsedTurns: ReadonlySet<number>; collapsedCalls: ReadonlySet<string>; query: string; }
export function buildLedgerView(trajectory: Trajectory, options: LedgerViewOptions): LedgerGroupView[];
export function collectCollapsibleCallGroups(trajectory: Trajectory): string[];
```

**可见行与搜索语义（D-013/D-014）**：`buildLedgerView` 的 `hidden` 标记由折叠与搜索共同决定；`query` 非空时忽略全部折叠集合（命中即显示）；账本对外暴露可见行数组供键盘导航；`TrajectoryView` 在可见行集合变化后校验 `selectedRowId`，不可见则置空并关闭详情。

**计时标签字段表**：

| 指标 | 来源字段 | 缺失时文案 |
|---|---|---|
| 开始 | `row.startedAt`（本地时间 / Unix 秒可切换） | 「不可用」 |
| 结束 | `row.endedAt` | 「不可用」 |
| 总时长 | `row.durationMs` | 「不可用」 |
| 首 token 延迟（TTFT） | `turn.timing.attempts[0].firstTokenAt - attempts[0].startedAt`（可解析时） | 「未记录」 |
| 生成时长 | `attempts[0].endedAt - firstTokenAt` | 「未记录」 |
| 吞吐 | `outputTokens / 生成秒数`（tokens 与生成时长均可解析时） | 「不可用」 |

产品路径只有工具/助手行可能带有轮级 `timing`；工具行无 token 采样时吞吐显示「不可用」，不估算。

## 生命周期契约表

不涉及生命周期契约：本次为纯前端展示层重构，无 session/lease/agent_run 状态变化、无新增长驻进程或外部资源，数据只读消费已加载的会话轮视图。

## 数据模型

无数据库/后端 schema 变更。前端内部新增两个纯视图模型：

- `LedgerGroupView`：按轮次聚合的账本组（行、步骤数、工具调用数），由 `Trajectory` 派生，不持久化。
- `LedgerRowView`：单行展示模型（原 `TrajectoryRow` + 标签文案 + 摘要 + 结果摘要 + 是否被折叠隐藏）。

折叠集合（`Set<number>` / `Set<string>`）与搜索词为组件内存状态，不落 localStorage。时长模式为**全局偏好**（不带会话维度），localStorage key `sillyhub.trajectory.scaleMode`（D-020）。

## 兼容策略（brownfield 必填）

- 入口与持久化不变：三态切换、按会话恢复视图、移动版同款行为均沿用上一变更。
- `TrajectoryView` / `TrajectoryTimeline` 对外 props 只增不改，dev 预览页 `/proto/session-trajectory` 自动获得新布局。
- `buildTrajectory` 零改动；`trajectoryFromTurnViews` 仅按 D-015 补充工具行 raw/result 映射与行 id 稳定性，轮/段既有语义不变；旧账本的 7 列网格与右侧检查器被新组件替换，不做双渲染开关。
- 无 API、表结构、OpenAPI 变更，无需 `gen:types`。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 会话面板较窄时，详情列 + 时间线挤压账本可读性 | P1 | 详情默认 clamp(320px,38%,440px)，≤760px 改抽屉覆盖；原型已按此呈现，execute 后真机验收 |
| R-02 | 大账本（千行级）滚动与搜索性能 | P1 | 行组件 memo + `content-visibility` 沿用；搜索走预计算索引纯函数，实测不达标再引入虚拟化（另行决策） |
| R-03 | 折叠/搜索状态在会话切换或轨迹视图卸载后残留 | P2 | 状态全部持有在 `TrajectoryView` 实例内，卸载即丢弃；不写入持久化 |
| R-04 | 等宽模式改变条块位置导致选中/命中错位 | P1 | `scaleMode` 只影响条块布局计算，`rowId` 与选中逻辑不变；补两种模式的单测 |
| R-05 | 工具栏四项控件与原「进度视图呈现方式」状态混淆 | P2 | 第二层开关已在上一变更删除；本次工具栏只在轨迹视图渲染，不写回 `viewMode` |
| R-06 | 共享仓库并行会话提交造成冻结面混入 | P2 | 提交一律显式 pathspec；收口前核对 `git diff --cached --name-only` |
| R-07 | 无长驻进程/外部资源，生命周期面不适用 | P3 | 接受：纯展示组件，无计时器、无订阅、无文件句柄 |
| R-08 | 段缺 id 时行 id 用下标兜底，流式追加可能造成选中漂移 | P1 | `from-turn-views` 行 id 优先用 `segment.id`，缺失时用 `${runId}:${kind}:${startedAt}:${index}`；叠加 D-014 的「不可见即清空选中」兜底，漂移最多导致一次选中丢失，不指向错误行 |
| R-09 | 轨迹模式下 pending AskUser 卡置顶固定，可能与工具栏争高度 | P2 | 卡片放在轨迹区域最上方、工具栏之下，高度由内容决定并 `shrink-0`；账本区 `min-h-0` 自适应剩余高度，原型同步验证 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-01/02/03/05；总体方案以 dsh 为基准 | 已覆盖 |
| D-002@v1 | FR-01；顶部固定布局（工具栏/时间线固定、账本滚动） | 已覆盖 |
| D-003@v1 | FR-02/04；工具栏四项语义与行为 | 已覆盖 |
| D-004@v1 | FR-03；账本两列结构与行内字段取舍 | 已覆盖 |
| D-005@v1 | FR-05；详情多标签、可调宽、窄屏抽屉 | 已覆盖 |
| D-006@v1 | FR-06；行类型限定与缺失数据空态 | 已覆盖 |
| D-007@v1 | FR-05；隐藏 Schema 标签 | 已覆盖 |
| D-008@v1 | FR-05；工具行完整标签、其它行简化 | 已覆盖 |
| D-009@v1 | 总体方案；组件族拆分（Toolbar/Ledger/DetailPanel） | 已覆盖 |
| D-010@v1 | 方案取舍；否决原地重构（落选记录） | 已覆盖（落选） |
| D-011@v1 | 方案取舍；否决直接移植 dsh（落选记录） | 已覆盖（落选） |
| D-012@v1 | 原型定稿；execute 直接对照搬组件 | 已覆盖 |
| D-013@v1 | FR-02；搜索时折叠失效、时间线不降透明 | 已覆盖 |
| D-014@v1 | FR-03/FR-05；隐藏选中行清空、键盘只遍历可见行 | 已覆盖 |
| D-015@v1 | FR-03/FR-05；工具行参数/结果字段映射与 from-turn-views 小改 | 已覆盖 |
| D-016@v1 | FR-02；等宽模式只读概览契约 | 已覆盖 |
| D-017@v1 | FR-01；时间线 50px 与说明区裁剪 | 已覆盖 |
| D-018@v1 | FR-05；D-007 覆盖 D-005 的 Schema 子项 | 已覆盖 |
| D-019@v1 | FR-03；账本不渲染请求边界点 | 已覆盖 |
| D-020@v1 | FR-02；时长偏好为全局偏好 | 已覆盖 |

无未解决决策。多条裁定组合面：D-002（脱离滚动流）与 R-01（窄屏抽屉）同时生效时，轨迹面板仍保持 `h-full` 纵向 flex，抽屉以绝对定位覆盖账本，不参与高度链，无死锁组合。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale）
- [x] 引用所有当前版本 D-xxx@vN
- [x] 涉及生命周期关键词时含「生命周期契约表」或紧邻豁免短语（已写「不涉及生命周期契约」）
- [x] UI 原型分级核对：按「必须生成」产出真码原型 `prototype-trajectory-redesign.html`（源 `frontend/src/components/prototype/trajectory-redesign-view.tsx`，经 `pnpm prototype:build` 编译；token 源 `frontend/src/app/globals.css` + `frontend/src/styles/themes.ts`）
- [x] 无「⚠️ 自审存疑」项
- [x] 审查修复复核（2026-10-22 Design Grill 6 项 P1）：requirements/proposal/tasks 已补齐；工具行字段映射允许 from-turn-views 小改并写入清单（D-015）；时间线 50px 承诺配套说明区裁剪（D-017）；宿主接线写明 showTrajectory 移出滚动容器与 pending 卡/回底按钮去留；等宽模式定义为只读概览（D-016）；选中失效与搜索组合语义定稿（D-013/D-014）；行型按产品/dev 两档定义；D-007 与 D-005 的 Schema 冲突已记账（D-018）
