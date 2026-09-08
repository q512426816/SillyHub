---
author: WhaleFall
created_at: 2026-09-08 11:02:33
scale: large
risk_level: unit-sufficient
---

# design.md — 2026-09-08-session-turn-nav

> scale: large（4 文件 + 新组件 + 多宿主适配，见文件变更清单）。
> 观感基准：`prototype-session-turn-nav.html`（可交互原型）。

## 1. 背景与目标

高轮次智能体会话中，用户无法快速回顾"之前问了什么、做了什么"：历史分窗加载（初始 `getAgentSessionLogs(limit=100)`，触顶翻页），只能手动滚；会话内搜索浮层只展示不跳转。本变更新增 ZCode 式左缘刻度轨（每轮一条细横杠刻度 + hover 飞出提问/正文摘要卡）+ 点击跳转定位 + 全量轮次覆盖。

## 2. 决策追踪

| ID | 决策 | 来源 | 摘要 |
|---|---|---|---|
| D-001@v1 | 常驻左栏 + 移动端收菜单 | user | 桌面常驻可折叠；mobile ⋯ 菜单抽屉；悬浮窗修正见 D-006 |
| D-002@v1 | 覆盖全部历史轮次 | user | runs 补全未加载轮次；点击自动加载后定位 |
| D-003@v2 | ZCode 横杠式条目 | user | 已被 D-007 取代（横杠列表仍不符用户预期） |
| D-004@v1 | 方案 A 前端拼装零后端 | agent | B 违 D-002、C 引新契约 YAGNI |
| D-005@v1 | 未加载条目摘要策略 | agent | v1 元数据+点击回填；可选增强=runs 加 prompt_preview 字段（轻后端），默认不做，用户原型确认时可改选 |
| D-006@v1 | 悬浮窗归 desktop 常驻分支（默认折叠） | agent | Grill 修正：floating-session-host 不传 variant→实际为 desktop；D-007 后刻度轨仅 ~30px 无需折叠，floating 零改动复用 |
| D-007@v1 | 形态终版：刻度轨 tick + hover 飞出卡 | user | 每轮一条 2px 细横杠贴聊天区左缘（~30px 轨），hover 飞出深色信息卡，点击跳转；取消 232px 面板/折叠/localStorage |

## 3. 现状锚点（调研结论，行号为 2026-09-08 main 快照）

- 门户骨架：`sessions-portal.tsx:521-541` `PageContainer size=full` + `grid-cols-[320px_minmax(0,1fr)]`；左列为跨会话列表（不动）。
- 会话面板：`session-panel-page.tsx`（3060 行）；主体区 `sessionBody`（2388-2422）= 历史加载提示 + `TurnTimeline`。
- 轮次渲染：`turn-timeline.tsx` `TurnRow`（272 行 memo）按 `turns.map` 顺序渲染，**无 DOM 锚点属性**；`SessionTurnView`（136-229）含 `prompt/output/segments/status/sender/realRunId/turnStartedAt`。
- 历史窗口化：初始 100 条（`HISTORY_PAGE_SIZE`，turn-state.ts:82）；触顶（scrollTop≤48，page-helpers.tsx:102）经 `handleLoadEarlierRef`（session-panel-page.tsx:881-942）`before` 游标 prepend，带滚动锚补偿（1024-1031）。
- runs 接口：`listSessionRuns` → `GET /sessions/{id}/runs`（lib/daemon/sessions.ts:639-647），`SessionRunRead` 含 `id/status/started_at/finished_at/sender_name/error_code` 等，**无 prompt 文本**（api-types.ts:20926+）。
- 跳转先例：`handleJumpToSubagent`（session-panel-page.tsx:1990-2038）双 rAF + querySelectorAll 类名匹配（脆弱，本变更改 data 属性精确匹配）。
- 共用宿主：桌面 /sessions、移动 /m（`app/m/workspaces/[id]/sessions/[sid]/page.tsx:59-69`）、悬浮窗 `floating-session-host.tsx` 均 `<SessionPanel mode="page">`；dialog 模式走 `SessionPanelDialog` 独立消费 TurnTimeline。

## 4. 总体设计（方案 A）

```
SessionPanelPage (mode=page, 真会话)
├─ header（现状不动；mobile ⋯ 菜单 +「轮次导航」项）
├─ SessionUsageBar / 横幅 / AgentLogCard / TaskExecutionPanel（不动）
└─ ★ sessionBody 区外包 flex 行：
   ├─ ★ <TickRail>（~30px 刻度轨：每轮一条 2px 刻度 + hover 飞出卡；mobile=Drawer 内容）
   │    entries[]（merge 产物）· activeTurnKey · onJump
   └─ 聊天列（现状：load-earlier 提示 + TurnTimeline + 输入区，flex-1 占满剩余宽度）
        └─ TurnRow 新增 data-turn-key；highlightTurnKey 受控高亮
```

数据流（单向）：

```
displayTurns(已加载) ──┐
                       ├→ useMemo merge → catalogEntries → TurnCatalog(受控纯组件)
listSessionRuns(全量) ─┘                                      │ click
                                                              ▼
                                        handleJumpToTurn(key)（session-panel-page）
                                        ├─ 已加载：rAF×2 → scrollIntoView → highlight
                                        └─ 未加载：循环 loadEarlier(≤N页) → 同上
```

## 5. 组件设计：TickRail（新文件 turn-catalog.tsx）

`frontend/src/components/sessions/turn-catalog.tsx`，仿 `subagent-catalog.tsx` 受控模式（props 进回调出，不碰聊天区 DOM）。

```ts
interface TurnCatalogEntry {
  key: string;              // realRunId ?? runId（与 data-turn-key 同源）
  turnNo: number;           // 1 基轮号（按时间序）
  startedAt: string | null;
  status: "completed" | "failed" | "running" | "stopped" | "pending";
  senderName?: string | null;
  promptSummary?: string;   // 已加载/已回填：飞出卡提问；未加载：undefined
  answerSummary?: string;   // 已加载/已回填：飞出卡正文摘要（首个 text 段截 ~120 字）
  loaded: boolean;          // false → 空心刻度
}
interface TickRailProps {
  entries: TurnCatalogEntry[];
  activeTurnKey: string | null;
  loadingEarlier?: boolean;
  onJump: (entry: TurnCatalogEntry) => void;
}
```

- 渲染（D-007，对齐原型 v3）：宽 ~30px 垂直细条（`w-[30px]`，`flex-col items-center gap-[7px] py-2`，**刻度组垂直居中**——伪元素上下 `flex:1` 撑开，刻度超出面板高度时 spacers 收缩到 0 回落顶对齐 + 轨内 `overflow-y-auto` 隐藏滚动条）；每轮一条刻度 `button`（`w-[14px] h-[2px] rounded-full`，hover/active 放宽 `w-[20px]` + `bg-brand-600`）；失败 `bg-destructive/75`、运行中 `bg-warning animate-pulse`、未加载空心（`box-shadow inset 0 0 0 1px` 描边）；默认 `bg-muted-foreground opacity-45`。
- hover 飞出卡：深色反转卡（`bg-foreground text-background`，宽 300px，圆角 10px，重投影）绝对定位于轨右侧 40px，内容=轮号+提问（semibold 2 行钳制）+正文摘要（3 行钳制）+meta（时间 · 状态 · 发送者，10px）；垂直位置=刻度 offsetTop 居中并钳制在面板可视范围（上下留 8px）；`@media (hover:none)` 不挂载（触屏点击直跳）。
- 全部颜色走主题语义类（brand-*/destructive/warning/muted-foreground/foreground/background），随 html data-theme 换肤，不硬编码。
- active 刻度变化时在轨内 `scrollIntoView({block:"nearest"})`（useEffect + ref 守卫首次渲染不滚）。
- 无障碍：每条刻度 `button` 带 `aria-label="第N轮 · 状态 · 提问摘要（截断）"`；飞出卡由刻度 hover **或键盘 focus（focus-visible）** 触发（共用定位逻辑），键盘用户同样可达；`aria-pressed` 不用，active 态以 `aria-current="true"` 标注当前轮。
- 组件名保留 turn-catalog.tsx / TurnCatalog 导出（历史一致），内部即刻度轨实现。

## 6. 数据派生（session-panel-page.tsx）

```ts
// 1) runs 全量轮次元数据——复用既有 runsMeta state（attach/turn_completed 已全量拉刷，
//    新鲜度优于独立 useQuery，且不新增 queryKey；仅当 runsMeta 为空时（异常路径）降级
//    为仅已加载轮次条目）
//    （session-panel-page.tsx 既有 runsMeta：attach 期与每轮完成后已全量拉取刷新）

// 2) 合并：runsMeta 定序定号（时间正序），displayTurns 命中(realRunId)的用本地摘要覆盖
const catalogEntries = useMemo(() => {
  const loadedByKey = new Map(displayTurns.map(t => [t.realRunId ?? t.runId, t]));
  return orderedRuns.map((run, i) => {
    const loaded = loadedByKey.get(run.id);
    return {
      key: run.id, turnNo: i + 1, startedAt: run.started_at,
      status: mapRunStatus(run.status),
      promptSummary: loaded?.prompt?.slice(0, 60),
      answerSummary: firstTextSegment(loaded)?.slice(0, 120),
      senderName: run.sender_name, loaded: !!loaded,
    };
  });
}, [orderedRuns, displayTurns]);
```

- 轮号基准：runs 全序的 1 基序号（与目录一致、与聊天流无强绑定，聊天区不加轮号显示）。
- `firstTextSegment(turn)`：取 `turn.segments?.find(kind==="text")?.text ?? turn.output`（旧回退路径无 segments 用 output）。
- 兼容 runs 不可用/失败：降级为仅已加载轮次刻度（loaded=true）；未加载刻度本身即状态标识（空心描边），无额外计数 UI（§9 不设头部）。
- 实时性：SSE 新增轮经 displayTurns 更新自然进入 entries（runs 只提供骨架，不追求其即时刷新；新轮 turnNo 取 max+1 保守派生）。

## 7. 跳转链路：handleJumpToTurn（session-panel-page.tsx）

```ts
const jumpSuppressLoadEarlierRef = useRef(false);
const handleJumpToTurn = useCallback(async (entry) => {
  const container = bodyWrapRef.current?.querySelector('[data-testid="turn-timeline-scroll"]');
  const hit = () => container?.querySelector(`[data-turn-key="${CSS.escape(entry.key)}"]`);
  if (!hit()) {
    // 未加载：循环翻页（≤8 页上限 = 800 条日志，防死循环），suppress 触顶自动加载
    jumpSuppressLoadEarlierRef.current = true;
    try {
      for (let i = 0; i < 8 && !hit() && hasEarlierRef.current; i++) {
        await loadEarlierOnce();          // 包一层 handleLoadEarlierRef.current() 的 Promise 化
      }
    } finally { jumpSuppressLoadEarlierRef.current = false; }
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    hit()?.scrollIntoView({ behavior: "smooth", block: "start" });
    setHighlightTurnKey(entry.key);       // TurnTimeline 受控高亮 ~2.2s 后自清
  }));
}, …);
```

- 触顶自动加载 hook（995-1021 捕获阶段 scroll 监听）读取 `jumpSuppressLoadEarlierRef`，为 true 时跳过触发；`hasEarlierRef` 为新建镜像 ref（随既有 hasEarlier state 同步），供跳转循环同步读取。
- TurnRow 为 fragment 双分支根节点（静默切换轮紧凑分支 + 常规轮分支），**两处根节点都加** `data-turn-key`；`highlightTurnKey` 在 TurnTimeline 内先派生为 per-row 布尔 prop（`isHighlighted={highlightTurnKey === key}`）再进 memo 行，避免每帧字符串比较击穿全部行 memo。
- 未命中兜底：循环后仍无 hit 分两档 toast——`hasEarlierRef=false`（已到头）→「该轮次日志不存在（可能已被清理）」；达页数上限→「已连续加载 8 页仍未到达，可再次点击继续加载」（可续点）。
- 降级说明：tool_report 会话（isToolReportBody）的 platform-managed 轮无用户锚点轮可跳，跳转恒走「已到头」toast 兜底，属可接受降级。

## 8. 布局挂载与多宿主

- **desktop（mode=page）**：`sessionBody` 外包 `flex min-h-0`（左 TickRail ~30px + 右聊天列 flex-1 min-w-0）；无折叠、无 localStorage 记忆（D-007 取消）。**该包裹有意更新 `session-panel-variant.test.tsx` 的 desktop 父链断言**（timelineWrap.parentElement 链多一层 flex 行，见 §11）。
- **mobile（variant=mobile）**：不常驻。header ⋯ 菜单（2634-2700）加「轮次导航」项 → antd Drawer（placement=left，宽 min(78vw,300px)）内渲染 TickRail 的列表形态（触屏无 hover：Drawer 内为带摘要的行式列表，点击即跳）；`onJump` 后自动关 Drawer。
- **悬浮窗（floating-session-host）**：**实际走 desktop variant**（host 不传 variant，index.tsx:279 默认 desktop，Grill 修正 D-006）→ 刻度轨仅 ~30px 宽，直接复用 desktop 形态，**floating-session-host 零改动**（D-007 后无需 catalogDefaultCollapsed）。
- **dialog 模式**：不挂载（TickRail 挂载点仅在 page 模式渲染分支内，props 不传即不渲染）。

## 9. UI 规格（对照原型 v3 · ZCode 刻度轨）

- 刻度轨：宽 30px，`py-2`，刻度间 gap 7px，刻度组垂直居中（超高溢出回落顶对齐轨内滚动）；不设头部/计数/折叠（D-007）。
- 刻度（`.tick`）：14×2px 圆角横杠；默认 `bg-muted-foreground opacity-45`；hover → `w-20px bg-brand-600 opacity-100`；active（当前轮）→ 同 hover 常亮；failed → `bg-destructive opacity-75`；running → `bg-warning animate-pulse`；unloaded → 空心（inset 1px 描边，无底色）。
- 飞出卡（`.tick-flyout`）：深色反转（bg=foreground、text=background），宽 300px，圆角 10px，投影，绝对定位于轨右 40px；内容：`f-q`（轮号+提问，semibold 12.5px 2 行钳制）、`f-a`（正文摘要 12px 75% 透明 3 行钳制）、`f-m`（meta 10px 55% 透明：时间 · 状态 · 发送者 / 未加载尾注）；淡入+4px 位移过渡 0.15s；垂直随刻度居中、钳制面板内 8px 边距；触发=hover 或刻度 focus-visible（键盘可达）。
- 跳转命中：聊天区目标轮 ring+浅底 2.2s（不变）；对应刻度即时 active。
- 触屏（hover:none）：飞出卡不挂载，点击刻度直接跳转；mobile Drawer 内为行式列表形态（带摘要，点击即跳）。
- **与原型 v3 差异（同 D-005）**：原型未加载刻度的飞出卡预置了摘要文案（演示回填后观感），实现 v1 初始 meta 行只有「未加载 — 点击加载该轮并定位」，回填后才有提问/正文。

## 10. 文件变更清单 / File Changes

| 文件 | 类型 | 内容 |
|---|---|---|
| `NEW:frontend/src/components/sessions/turn-catalog.tsx` | 新增 | TickRail 刻度轨组件（刻度渲染 + hover 飞出卡 + 定位钳制）+ TurnCatalogEntry 类型 + 摘要工具（firstTextSegment/截断） |
| `NEW:frontend/src/components/sessions/__tests__/turn-catalog.test.tsx` | 新增 | 组件单测（刻度渲染/状态态/hover 飞出内容与钳制/点击回调/未加载空心/active） |
| `frontend/src/components/daemon/turn-timeline.tsx` | 修改 | TurnRow **fragment 两分支根节点**均加 `data-turn-key`；TurnTimelineProps 加 `highlightTurnKey`（内派生 per-row 布尔，不击穿行 memo） |
| `frontend/src/components/daemon/session-panel/session-panel-page.tsx` | 修改 | catalogEntries 派生（复用既有 runsMeta，不新增 useQuery）+ handleJumpToTurn + 触顶抑制/hasEarlier 镜像 ref + 布局包裹（desktop 常驻/mobile Drawer 入口）+ activeTurnKey 滚动联动 |
| `frontend/src/components/daemon/session-panel/page-helpers.tsx` | 修改（如需） | 触顶自动加载 hook 接受 suppress ref 参数 |
| `frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx` | 修改 | **有意更新** desktop 父链断言（timelineWrap.parentElement 层级 +1 flex 行）；mobile 分支断言保持不变 |

不动：后端全部、sessions-portal、session-list-panel、dialog 宿主渲染分支。

## 11. 测试策略

1. `turn-catalog.test.tsx`（新增，~10 用例）：刻度渲染（数量/状态类）；hover 与 focus-visible 触发飞出卡（内容轮号+提问/正文摘要/meta、垂直钳制）；tick aria-label 与 active 的 aria-current；未加载空心态与 meta 尾注；click 回调携带 entry；触屏（hover:none 匹配）不挂飞出卡。
2. `session-panel-page` 既有测试文件追加（~6 用例）：`handleJumpToTurn` 已加载直跳（mock scrollIntoView 断言）；未加载循环调用 loadEarlier 至命中；页数上限兜底 toast；suppress ref 生效期触顶不触发；data-turn-key 渲染断言；mobile ⋯ 菜单项存在。
3. 回归锚（**有意更新**而非不变）：desktop 布局包裹后 `session-panel-variant.test.tsx:281-286` 的父链断言（`timelineWrap.parentElement.className === "contents"`、`bodyWrap.parentElement === panel`）随之更新为新层级；mobile 分支断言（321-324）保持不回归；runtimes/sessions 相关既有测试跑相关子集。

## 12. 风险登记 / Risk

| ID | 风险 | 缓解 |
|---|---|---|
| R-01 | session-panel-page 已 3060 行，再加目录逻辑膨胀 | 目录逻辑收拢：entries 派生/跳转链抽独立 hook `use-turn-catalog.ts`（同目录新文件，session-panel-page 只接线），必要时并入文件变更清单 |
| R-02 | 触顶自动加载与跳转滚动竞争 | jumpSuppressLoadEarlierRef 抑制 + 跳转后置 scrollTop（设计 §7） |
| R-03 | runs 与 displayTurns 对不齐（realRunId 缺失/孤儿 run） | 以 runs 定序；displayTurns 未命中 runs 的尾部轮追加到末尾（key=runId）；跳转未命中 toast 兜底 |
| R-04 | 高轮次目录渲染性能 | 条目轻 DOM（无 markdown），百级条目普通渲染；卡顿再议虚拟化（Non-Goal 先记录） |
| R-05 | 移动端 Drawer 与悬浮窗高度冲突 | Drawer 挂 SessionPanelPage 局部（antd Drawer getContainer 指面板根），不占全屏 |
| ~~R-06~~ | ~~折叠记忆脏~~ | 已随 D-007 取消折叠与 localStorage（刻度轨仅 ~30px 常驻无需折叠），保留编号防错位 |
| R-07 | TurnRow memo 被 highlight 击穿 / fragment 双根漏锚点 | per-row 布尔派生进 memo 行；两分支根节点都加 data-turn-key（§7） |
| R-08 | runs 双数据源（新 useQuery vs 既有 runsMeta）不一致 | 复用 runsMeta（attach/每轮完成已全量拉刷），不新增独立缓存（§6） |
| R-09 | 飞出卡定位溢出（顶部/底部刻度 hover 出界） | 垂直钳制在面板可视范围 ±8px（§5/§9）；极端窄高面板降级贴边 |
| R-10 | 超高轮次刻度 density（100+ 刻度超一屏） | 轨内 overflow-y-auto 隐藏滚动条；active 刻度自动滚入可见（FR-05） |

## 13. 生命周期契约

生命周期契约：无 / 不适用（不涉及生命周期契约——纯前端 UI 展示层新增，不改 session/lease/agent_run/daemon 的状态机、事件或心跳语义）。

## 14. 自审 / Self-Review

- FR-01~08 与 D-001~007 逐条对得上；文件变更清单覆盖全部 FR（FR-07 由 turn-timeline + jump 链路承载）。
- Grill 修正已吸收：desktop 父链断言为**有意更新**（非不回归，§10/§11 与 requirements 措辞同步）；悬浮窗归 desktop 分支（D-006，D-007 后零改动复用刻度轨）；复用 runsMeta 免新增查询；TurnRow fragment 双根锚点 + per-row 布尔高亮。
- 形态经用户两轮反馈定稿为刻度轨（D-007）：v1 卡片列表（繁琐）→ v2 横杠列表（仍不符）→ v3 tick+飞出卡（对齐 ZCode 截图）。
- 最大的不确定点 = D-005 未加载刻度摘要观感（原型展示回填后形态），已显式列为用户确认点。
- 跳转链路与触顶加载的竞争（R-02）、runs 对齐（R-03）、飞出卡定位（R-09）均有明确缓解与兜底。
