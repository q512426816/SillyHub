---
author: WhaleFall
created_at: 2026-10-14 09:59:33
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-10-14-session-turn-preview-cards

## 背景

长会话打开时前端只拉最新 `HISTORY_PAGE_SIZE=400` 条日志窗口（frontend/src/components/daemon/session-panel/turn-state.ts:117，2026-09 窗口化防卡决策），未加载轮次在消息流中**完全隐身**。探索期实测（会话 f231ca18，35 轮）：打开仅尾部约 12 行有内容，其余 23 轮连占位都没有，用户无从得知「看不见 = 未加载」；点击左侧导航跳转后，目标轮经单轮直达加载（frontend/src/components/daemon/session-panel/session-panel-page.tsx:2268 handleJumpToTurn），但相邻轮次仍不可见，且自动翻页拉回的半截轮渲染成片「时间· 未指定· 主机· 本机默认」零信息配置行——逐轮点击导航成为查看中间内容的唯一手段，体验不友好（用户原话反馈）。

数据基础已具备：轮次大纲接口（frontend/src/lib/daemon/sessions.ts:715 fetchSessionTurnOutline）一次下发全部轮次摘要（seq/prompt_summary 60 字/answer_summary/started_at/status/sender_name），当前仅被左侧导航消费（frontend/src/components/daemon/session-panel/session-panel-page.tsx:285 mergeTurnNavEntries）。本变更把这份既有数据铺进消息流：未加载轮原位渲染预览卡，点开复用既有直达链路完整加载；跳转时异步预取相邻轮，形成连贯阅读上下文。

## 设计目标

1. 打开长会话即见全量轮次骨架：消息流按轮序呈现预览卡（提问/答复摘要），滚动浏览如正常聊天记录；
2. 点预览卡原地展开完整轮块（不抢滚动），复用既有 run_id 单轮直达，加载后原位替换、2.2s ring 高亮反馈；
3. 导航跳转某轮后自动后台预取前后各 1 个未加载轮，上下文连贯；
4. 后端与 daemon 零改动（D-002）；旧消费方（/runtimes 弹窗等）零回归。

## 非目标

- 不做「一键加载全部轮次」入口（探索方案三，用户未选）；
- 不做后台静默渐进回填（探索方案四，请求扇出与既有收敛优化方向冲突）；
- 不做头尾双窗口 + 中间折叠带（探索方案五）；
- 不改「加载更早」翻页、跳转三抑制窗、prepend 锚钉回、SSE 实时流、孤儿门控等既有机制；
- 不改静默配置切换轮的紧凑配置行语义（frontend/src/components/daemon/turn-timeline.tsx:531，ql-20260818-011 语义正确保留）；
- 不改左侧导航形态（未加载空心刻度语义保留）。

## 拆分判断

不拆分。改动集中于会话面板族单模块（frontend_components 会话域），三个源文件 + 归并纯函数 + 三组测试，单上下文可完整吞吐；不涉及跨模块/跨子项目依赖。判 large 依据：CLAUDE.md 规则 3 新功能走完整流程 + 新增渲染分支与预取交互状态（在飞去重 ref）。

## 总体方案

### Phase 1 数据层：归并纯函数（preview-merge.ts 新文件）

导出 `mergePreviewIntoDisplayTurns(outline, turns, opts)`：以大纲 items（seq 升序，权威轮序）为骨架，已加载轮（turns 按 `realRunId ?? runId` 索引命中，沿用 mergeTurnNavEntries:293 口径）用真实 turn 原样透传；未加载轮合成预览条目——`SessionTurnView` 形状 + 新可选字段 `preview: { promptSummary?: string; answerSummary?: string }`（可选字段缺省零回归惯例），`runId` 用大纲 `run_id`、`status` 经 `mapRunStatus` 映射、`whoLine`/`sender` 从大纲字段构造。孤儿轮（turns 有、大纲无）尾部追加（mergeTurnNavEntries:316 同口径）。outline 缺失/空 → 原样返回 turns（降级不劣于现状）。纯函数无副作用，独立单测。

displayTurns 派生接线（frontend/src/components/daemon/session-panel/session-panel-page.tsx:2652）：`enrichDisplayTurns(...)` 之后再过归并函数，依赖数组增补 `turnOutline`（outline 仅会话切换拉取一次，重派生成本可接受）。

### Phase 2 渲染层：TurnPreviewCard（turn-timeline.tsx）

TurnRow（frontend/src/components/daemon/turn-timeline.tsx:479）新增前置分支：`turn.preview` 存在且无 prompt/output → 渲染 TurnPreviewCard：轮号徽章 + 状态点 + 时间 + 提问摘要（line-clamp-2）+ 答复摘要（有才显，line-clamp-2）+「展开完整对话」入口；整卡 button 可点。视觉：`border-dashed` + `bg-brand-50` 浅底与已加载实心气泡区分，brand-* 语义阶随主题换肤，零硬编码色值；`[content-visibility:auto]` 屏外跳过（先例同文件 :555-560）。新增可选 prop `onExpandPreview(runKey)`——缺省（dialog 等旧消费方）预览分支整体不渲染，零回归。TurnTimeline 新 prop `expandPreview` 接线透传。

### Phase 3 交互链路：原地展开 + 附近预取（session-panel-page.tsx）

- **原地展开** `handleExpandPreview(runKey)`：复用既有单轮直达拉取（getAgentSessionLogs({run_id})，handleJumpToTurn:2350 同链路）→ 已加载判（同 run 状态判 + jumpEmptyJumpedRunIdsRef:794 幂等）→ 经 prepend/merge 通道写入 turnState → 归并层同 run_id 自动原位替换预览条目 → 复用 highlightTurnKey 2.2s 自清（不 scrollIntoView，卡片在视口内）。会话纪元归属校验 + 卸载守卫与 handleJumpToTurn 同款。
- **附近预取**：handleJumpToTurn 直达成功后 fire-and-forget——按大纲序取目标轮前后各 1 个未加载轮 run_id，串行异步拉取（不阻塞目标轮），走同一写入通道；三重防重：已加载判重 + 在飞去重 ref（新 `previewPrefetchInflightRef: Set<string>`）+ 零正文幂等标记。预取失败静默（下次点击/跳转再触发）。

### Phase 4 测试与验收

- 归并纯函数单测：轮序正确、加载后原位替换（无双块）、孤儿追加、空大纲降级、preview 字段缺省；
- 渲染测试：预览卡渲染内容/点击回调/`onExpandPreview` 未传不渲染（dialog 零回归）；
- 预取测试：在飞去重、已加载跳过、失败静默；
- 复跑既有 jump / turn-nav / turn-timeline 相关测试面（规则 0 不跑全量）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:frontend/src/components/daemon/session-panel/preview-merge.ts | 归并纯函数 mergePreviewIntoDisplayTurns + 预览条目类型（大纲 items → SessionTurnView 变体构造） |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | TurnRow 预览分支 + TurnPreviewCard 组件 + TurnTimeline/RowProps 新增 onExpandPreview/expandPreview 可选 prop |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | displayTurns 接线归并 + handleExpandPreview + 跳转后附近预取 + TurnTimeline 挂载点传 prop |
| 新增 | NEW:frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts | 归并纯函数单测 |
| 新增 | NEW:frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx | 预览卡渲染/交互/零回归测试 + 预取判重/跳过/静默测试（同文件两 describe 组） |
| 新增 | NEW:frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx | 整页集成测试（FR-01 预览卡呈现/FR-03 直达+附近预取判重/D-005 hit 门回归锚/FR-04 降级；execute 期新增——预取回调在页面装配层，组件级测试无法触达；verify 步 3 已对账回写 task-04 卡） |

## 接口定义

本变更接口面：0 端点（无接口变更，不触发 pnpm gen:types）。前端内部契约：

```ts
// preview-merge.ts
interface TurnPreviewInfo { promptSummary?: string; answerSummary?: string }
// SessionTurnView 扩展（turn-timeline.tsx）：preview?: TurnPreviewInfo
function mergePreviewIntoDisplayTurns(
  outline: SessionTurnOutlineRead | null,
  turns: SessionTurnView[],
): SessionTurnView[];
// turn-timeline.tsx 新 props（均可选，缺省零回归）
// TurnTimelineProps.expandPreview?: (runKey: string) => void
```

## 生命周期契约

生命周期契约：N/A——本变更纯前端渲染与交互层，不引入任何生命周期状态、事件或状态转移；SSE/轮次状态机零改动。

## 数据模型

无 schema 变更（后端/本地存储均不动）。仅前端内存态类型扩展：`SessionTurnView.preview?: TurnPreviewInfo`（可选字段，序列化不落盘）。

## 兼容策略（brownfield 必填）

- **旧消费方零回归**：TurnTimeline / TurnRow 新 prop 均可选，dialog 模式与 /runtimes 弹窗不传 `expandPreview` → 预览分支不渲染，行为与现状逐字节等价（对齐 forkEntry:414 先例）；
- **大纲缺失降级**：turnOutline 为 null（拉取失败/旧 daemon）→ 归并函数原样返回 turns，页面回到现状形态；
- **窗口内半截轮**：已加载判定沿用既有口径，窗口内真实块优先（不叠预览卡），跨页轮分裂已由 2026-10-13-load-earlier-full-turn 轮边界对齐覆盖；
- **不改变的 API 与表结构**：turn-outline / logs / runs 端点、agent_runs 表、SSE 事件协议全部不动。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 数百轮会话预览卡渲染量 | P2 | content-visibility 屏外跳过（既有手段）；预览卡为纯静态 DOM 无 markdown 解析，单卡成本远低于真实轮块 |
| R-02 | displayTurns 派生复杂度上升引发既有渲染回归 | P1 | 归并逻辑纯函数外提独立单测；displayTurns 消费方（时间线/ctx 环/子代理目录）数据形状不变（真实轮透传原引用） |
| R-03 | 预览条目与真实块同屏双块（同 run_id 键冲突） | P1 | 归并函数同键空间去重（同 mergeTurnNavEntries loadedByKey 口径）；单测覆盖「加载后原位替换无双块」 |
| R-04 | 预取请求扇出 | P2 | 仅跳转触发、每次至多 2 轮、串行异步、三重判重；不引入轮询/定时器 |
| R-05 | 大纲 seq 与日志窗口轮序错位（大纲滞后） | P2 | 孤儿轮尾部追加兜底（既有口径）；实时新轮 SSE 先到时按既有 orphanNo 接续编号 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 设计目标 1-3、总体方案 Phase 1-3（方案方向用户实选） | 已确认 |
| D-002@v1 | 非目标、兼容策略（后端/daemon 零改动边界） | 已确认 |
| D-003@v1 | Phase 3 原地展开语义（加载后保持完整不缩回） | 已确认 |
| D-004@v1 | Phase 1 合并式单一数据源架构（方案 A，用户实选；B 双源拼接因对账竞态历史否决） | 已确认 |

无未解决决策。剩余风险见风险登记 R-01~R-05。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-004）
- [x] 涉及生命周期关键词时含「生命周期契约表」或紧邻豁免短语（「生命周期契约：N/A」紧邻段落）
- [x] UI 原型分级核对（prototype-turn-preview-cards.html 已生成并经用户确认）
- [ ] 不确定的问题标注「⚠️ 自审存疑」——无存疑项
