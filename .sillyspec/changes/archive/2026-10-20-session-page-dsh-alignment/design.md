---
author: qinyi
created_at: 2026-10-20 15:24:52
scale: large
---
# 设计文档（Design）— 2026-10-20-session-page-dsh-alignment

<!-- 引用规范：全文源码位置写仓根相对全路径+行号（frontend/src/...:123） -->

## 背景

会话页（`/sessions`）要做两件事：**效果**对齐 deepseek-harness 的会话页观感，**能力**补上「按事件账本读过程」与「这轮改了哪些文件」。推进过程见 `proposal.md` 动机段：三次「看不出区别」的判定被查出建立在缺正文的残缺静态稿上（D-019 / D-018），视觉方向在 D-012 被改为「视觉层重做」，随后追加 D-020（去轮间 hairline）、D-021（对比加强四组参数）、D-022（轨迹档 1）、D-023（文件变更卡走 1b）。

四条交付面（三条技术线 + 一条已落盘的后端端点）的现状差异很大：

| 线 | 状态 | 证据 |
|---|---|---|
| A 视觉层重做 | 已落盘并验证 | `git diff --stat`：`globals.css` +42、`turn-timeline.tsx` 187 行改动、`turn-segment-views.tsx` +36、`round-divider.tsx` +31、`attachment-chips.tsx` +34、`session-list-panel.tsx` +23、`app-shell.tsx`/`top-bar.tsx`/`workspace-switcher.tsx` 预览入参 |
| B 轨迹档 1 | 已落盘并验证 | 目录 `frontend/src/components/daemon/trajectory/`（builder 946 行 + 泳道时间轴 738 行 + 视图 539 行 + `zoom.ts` 272 行 + 56 例单测）+ `/proto/session-trajectory` 路由 |
| C 文件变更卡 1b | 形态原型已落盘（桩数据），数据链路未开始 | `frontend/src/components/daemon/file-changes/file-changes-card.tsx`（props only）+ `/proto/session-file-changes` 路由 + `frontend/e2e/proto-file-card.spec.ts`（Playwright 1 例）+ `__tests__/file-changes-card.test.tsx`（8 例）；daemon 采集 / backend 透传 / 会话汇总仍只有 D-023 契约 |
| D 会话 × 模型用量明细端点（FR-23） | 已落盘并出生成物（UI 未接线） | `backend/app/modules/daemon/router/session_insights.py:933-1052`（+122 行）+ `router/__init__.py:283-286` 注册 + `backend/openapi.json`（+136 行）+ 两侧 `api-types.ts`（各 +117 行）+ `backend/app/modules/daemon/tests/test_session_model_usage.py`（**260 行** / 4 例） |

现状量化事实：真实会话导出为 21 runs / 1271 logs（`.proto-staging/session-export.json`，3,370,986 字节）；无日志的 run 有 1 个，故真实轮数为 20（导出件 `turn-block` 计数 20 与之一致）。

**FR-23 的登记缘由**：独立评审 P1-b 判定「文档零声明而代码已落盘＝三方对齐失败」，故本期把 D 线端点登记为**范围内交付**（FR-23 + 本文「文件变更清单」「接口定义」+ `tasks.md` task-25），同时删除本文此前「不改数据链路 / 不新增端点」的反转断言——那两句只对**线 A / 线 B** 成立，不覆盖这条后端端点。

## 设计目标

1. 一轮之内**答复正文必须先被读到**：正文 15px / 1.8 / 段距 0.65em，过程行 11.5px + `muted/80`，两级字阶差 3.5px（D-021①②）。
2. 一轮只有**一条**元信息行；轮与轮之间**只有留白**（28px），不画线（D-016①、D-020）。
3. 过程视觉降噪：工具行去外框、改 2px 左规线，静息 `border-border/60`（D-016③、D-021③）。
4. 给出**第三个读取视角**（轨迹档 1）：三泳道共享绝对时间轴 + 事件账本 + 记录 inspector，不改现有「进度」视图（D-022 / D-024 / D-026）。
5. 文件变更卡走 **1b**：逐文件 +/− 以 git 快照为准，bash/CLI 改动可回显（D-023）。
6. 所有视觉结论必须能在**三个主题**下成立，且颜色只走语义 token（D-015@v2）。
7. 原型评审载体必须可信：定稿稿由真实组件渲染 + 水合后 DOM 导出，且导出脚本自带正文块断言（D-017、D-018）。
8. 后端能力不留暗账：随工作树落盘的只读端点（FR-23 model-usage）必须进文档清单与验收面，文档不得与代码反向陈述。

## 非目标

- 不做 TTFT / decode 切片（D-022）：模型条在无 TTFT / attempt 采样时只能是近似，禁止画成 TTFT/decode 双色切分；真实区间待 daemon 上报后替换（D-024 / D-026）。**口径更正（D-025@v1）**：本条只禁止 **UI 呈现层的 TTFT/decode 双色切分**；daemon 侧的 TTFT / attempt **采集**在范围内且不得缓发——采集落地后模型条改回「真实 API 占用区间」，无采样字段时前端保持现有单色近似（版本门控，见 plan task-10 / task-12）。~~不做轨迹区间聚焦与滚轮缩放~~——该子句已被 **D-026 取代**：缩放 / 平移 / 总览刷子已实现。
- 不做会话页工具审批卡、不做交互式时间概览（D-002 未选）。
- 不做移动端 inspector 抽屉（轨迹检查器桌面固定 320px）。
- 不做每会话独立 worktree（D-023 接受标注）。
- 不做首屏 / 翻页 / 滚动 / 流式四项性能优化（D-006、D-007）。
- 不移植 DSH 的 Cordis + Slots 插件化客户端（D-001）。
- 不把整轮折叠做成默认行为（D-012）；不恢复手绘 HTML / SSR 抓稿作为定稿（D-011、D-018）。

## 拆分判断

本变更在提交时已是**三条线**，且三条线的交付形态不同：

- 线 A / B 是**纯前端**、已落盘、已由单测与实测锁住；
- 线 C（1b）**跨仓**：daemon（`sillyhub-daemon/src/`）出快照 → backend 透传字段 → 前端卡片，并且**动 daemon 需要发版**与版本门控（老 daemon 必须降级为「仅工具编辑」），性能红线还要求遥测（p50 / 降级率）；
- **外加一条已落盘的后端只读端点**（FR-23 会话 × 模型用量明细）：只读、零迁移、独立于线 C，见「背景」末段。

因此实现路径必须一次定死，**不在本文档留二选一**：

**裁决：全并本变更，走完整五阶段（brainstorm → plan → execute → verify → archive），`scale` 取 `large`。** 依据（用户 2026-10-21 拍板，权威记录见 `tasks.md`「规模评估」末条；两条旧判据只作留痕）：

1. 三条线各自有**独立验收面**（视觉目视 + 轨迹数据对数 + 1b 四段测试），需要多阶段治理，不能一次 --done 收口；
2. 1b 引入 daemon 采集与**版本门控**，兼容矩阵必须在 daemon 侧单独验收（R-06）；
3. 1b 的性能红线需要**遥测与告警阈值**（p50 / 降级率，R-07），不能与前端样式改动同批回滚；
4. 泳道时间轴的**前端**推进（D-024 / D-026 已落盘）与 **TTFT / attempt 采集的 daemon 侧**推进（D-023 的 1b）构成两个可并行任务簇，满足 Wave 编排条件。

**已作废的旧判据（保留以防被重新引用）**：

- 旧判据 A（`scale: small` 的论证）：「已落盘两条线均验证完毕，剩余 1b 是一条顺序线（daemon → backend → 前端），不存在可真并行任务簇，按 brainstorm 规模判据不应声明 large」。**已被上条 ④ 推翻**：1b 的 daemon 采集与前端泳道/卡片可并行，且跨仓 + 版本门控 + 遥测三项都不是「顺序单线」形态。
- 旧判据 B（拆分建议）：「**推荐**把『文件变更卡 1b』拆成独立变更，本变更只做线 A + 线 B 收口 + 文档，理由是 daemon 发版节奏会绑架前端视觉验收」。**已被用户裁决推翻**：三条线全部留在本变更、一次到位，接受周期变长；该理由（发版节奏）同样适用于「全并」方案，属自我论证矛盾，执行时不得再据此拆变更。

拆分的代价如实登记：1b 的落点文件（daemon / backend / 前端三段）与回退路径见本文「文件变更清单」「兼容策略」；进入 plan 时按该清单出任务卡（`tasks.md` task-13…task-19），不再另立变更。

## 总体方案（做法概述）

### 线 A：视觉层重做（已完成）

全部改动落在真实组件与 `globals.css`，不改 DOM 契约、不改数据链路、不改渲染分支（D-012 的执行口径）：

1. **字阶分离**：`frontend/src/app/globals.css:815-855` 新增 `.seg-text-body .markdown-text .wmde-markdown` 元素级规则（15px / 1.8 / 段距 0.65em；h1/h2 16.5px、h3/h4 15.5px、行内 code 13px；全部 `!important` 以压住 MarkdownText compact 档的 `[&_.wmde-markdown]:!text-xs`）。该块**必须排在手机端覆盖块之前**——mobile 规则（`globals.css:864-897`）与本块同特异度，靠源码顺序让手机端赢，桌面字阶改动不进手机端。
2. **过程退档**：`frontend/src/components/daemon/turn-segment-views.tsx:687`（思考行）与 `:808`（工具行）改 `text-[11.5px]` + `text-muted-foreground/80`，并去掉思考摘要上叠加的 `opacity-75`（叠乘后浅色主题 < 3:1）。
3. **工具行去框**：`:808` 容器由满宽描边改 `border-l-2 border-border/60`（静息），hover 转 `border-l-brand-600`；行尾动作按钮默认 45% 透明。
4. **轮间节奏**：`turn-timeline.tsx:1698-1712` 外层由 `space-y-5` 改无间距容器 + 每轮 `data-testid="turn-block"` 的 `pb-7`（28px）；D-020 之后 `border-b border-border last:border-b-0` 已删除，**只有留白**。
5. **元信息合并**：`turn-timeline.tsx:696-707` 由 `turnStartedAt` / `replyAt` 派生 `metaDetail` 文本；对话视图经 `RoundDivider.detail`（`round-divider.tsx:69`、`:115-122`）右贴，进度视图经 `data-testid="turn-meta-detail"`（`turn-timeline.tsx:1167`）右贴。原先 `SegmentedTurnBody` 内部那条「开始 · 结束 · 历时」独立行已删除（`turn-timeline.tsx:2129-2133` 注释留痕；本行锚点 2026-10-21 plan 阶段校正，旧行号已随文件增长漂移——对应清理任务 task-06 已核验，文内不再保留旧行号字面量），`turnStartedAt` / `replyAt` 仍用于运行中状态条。
6. **过程/答复分区**：`turn-timeline.tsx:2047-2054` 助手列 `gap-[7px]` + `[&>.seg-text-body]:mt-[7px]`（实际间隔 14px）。
7. **用户气泡降噪**：`turn-timeline.tsx` 用户气泡由 `bg-primary` 实色块改 `max-w-[56%]` + `border border-primary/20` + `bg-primary/[0.08]` + `text-foreground` + `text-[13.5px]`，去品牌投影；附件 chips 与行内引用标签同步走 `tone="brand"`。
8. **左栏**：`session-list-panel.tsx:3460`（行内边距微收）、`:3594`（行时间 9.5px）、`:3773`（chip 统一 `h-[14px]` / `text-[9px]`）、`:3821`（轮数 `ml-auto` 右贴）。

### 线 B：轨迹档 1（已完成；D-024 把泳道时间轴定为主视图，账本降为「调用」档，D-026 扩入缩放/平移/窗口）

- **纯函数装配器** `frontend/src/components/daemon/trajectory/build-trajectory.ts`（946 行）：输入 `AgentRunLogEntry[]` + run 元数据，输出 `{ rows, turns, lanes, coverage, windowStart, windowEnd }`。职责：按 run 分组、轮内排序（同毫秒用 `agent_event.seq`）、`tool_use`/`tool_result` 按 `call_id` 配对成一行、`depth`/`parentCallId` 透传、文本协议前缀剥除、`inputText`/`outputText` 默认截 800 字；并派生三条泳道的条（`lanes`）与 wall-clock 覆盖率（`coverage`）。
- **主视图＝泳道时间轴** `trajectory-timeline.tsx`（738 行）：**三泳道（输入 / 模型 / 工具）共享同一条绝对时间轴**，不做逐轮缩放、不分面。交互五项：
  1. **滚轮缩放**——以指针所指时刻为锚点，一档 `ZOOM_STEP=1.15`，视野跨度钳在 `[MIN_VIEW_SPAN_MS=60000, 整窗]`；监听器用 `addEventListener(..., { passive: false })` 注册（React `onWheel` 是 passive，`preventDefault` 会被浏览器忽略并刷控制台警告）。
  2. **拖拽平移**——泳道空白处按下并移动即平移（两端钳制到整窗），在条上按下是选中而非平移；位移小于 3px 视为点击。
  3. **双击 / 「重置」按钮**——回到整窗（已是整窗时按钮禁用）。
  4. **10px 总览刷子**——整窗缩略条上的半透明矩形＝当前视野；拖它平移视野，点刷子外面把视野中心挪到指针处。
  5. **6px 命中带 + 最近中心裁决**——条本身可只有 2px（`MIN_BAR_PX`），命中按 `HIT_BAND_PX=6` 扩；`pickSpanAt` 先取真正压住指针的候选、中心离指针最近者胜，没有再取扩展带内中心最近者，都没有＝点空白不选中（O(n)，只在点击/按下时跑一次）。
- **刻度跟视野走**：刻度由**视野**派生而非整窗（`tickTimes` 7 档：整窗 ≥1h 走钟点、视野 <10min 补秒；短会话走相对视野起点的 `+mm:ss`）——旧实现按整窗算再夹到视野跨度，缩放后 7 个刻度会全显示同一时刻。
- **轴与账本右缘对齐**：时间轴与账本在 `trajectory-view.tsx` 同一左列内上下叠放、共用同一列宽，**验收 Δ≤2px**；实测 **Δ=0.00px**（改前时间轴横跨整页，右缘偏离账本 **308px** ＝ 320px 检查器列 − 12px 时间轴右内边距；本机 1600×1000 实测：轴右缘 / 账本盒右缘同为 1280px，检查器 1280→1600 恰为 320px）。
- **只读视图** `trajectory-view.tsx`（539 行）：左列＝泳道时间轴（上）+ `role="grid"` 账本（22px 密排行，按 depth 缩进）；右列＝320px 检查器（入参/输出 `<pre>`、JSON 美化切换、复制），整列高度、时间轴不再横跨它的上方。行级 `content-visibility: auto`，不引虚拟化库。此前「时间概览（每轮一行小刻度）」已被**删除**——D-024 判定该形态为错误（主视图不是表格，也不是每轮一行的小刻度）。
- **model 条口径（近似，必须标注）**：`deriveModelSpans` 把本轮被工具占用切出的每个 gap，若**整段非工具空档且含 ≥1 条思考/答复行**，则整段 gap 出**一根** model 条；出条前再与工具区间做一次差集，因此**与工具区间零重叠**，且 `coverage.modelMs + coverage.toolMs ≤ coverage.windowMs` 恒成立（并集口径）。
  **该口径会偏高**：轮首等待、上下文拼装、工具之后到下一动作之间的空闲都落进 gap。整窗覆盖 model **9.2%**（53.3min，条数 183；改口径前 1.3% / 7.4min / 187 条），但**轮内真实口径是 模型 26% / 工具 62% / 空档 12%**，整窗另有 **370min** 属轮间空闲——所以 UI 必须显示 `模型 x% · 工具 y% · 空档 z%`，禁止把 9.2% 读成「模型活动占比」。
- **dev 路由** `frontend/src/app/proto/session-trajectory/`：Server Component 用 `loadStagedSessionExport()` 读盘 → `TrajectoryProtoView` → `buildTrajectory` → `TrajectoryView`。`dynamic = "force-dynamic"` 保证每次请求读最新导出（`page.tsx:24`）。
- **零后端改动（仅限线 B）**：轨迹视图复用产品既有 `AgentRunLogEntry` DTO 与 run 快照，自身不新增端点、不改数据链路（D-022 明令）。**边界**：本变更另有一条后端交付 `GET /sessions/{session_id}/model-usage`（FR-23，已落盘），它不属于轨迹数据链路，两者不得混为一谈——「轨迹零后端改动」不等于「本变更零后端改动」。
- **静态留档**：轨迹页也已产出水合后 DOM 导出稿 `prototype-session-trajectory.html`（2,924,039 字节 / 856 行账本 / 3 条泳道 / 618 根 bar / `<script data-export-shim="vanilla">` **恰 1 段**（该稿为 `--with-js` 产出；纯静态模式才是 0 段）/ 0 `<link>` / 1 `<style>`），已按泳道形态重导出，与 dev 路由同源，供离线评审。

### 线 C：文件变更卡 1b（数据链路未开始；卡片形态原型已落盘）

**已落盘的部分（桩数据，形态验证用）**：`frontend/src/components/daemon/file-changes/file-changes-card.tsx`（props only、零 fetch/store，折叠态一行 28px + 展开态 24px 文件行 + 列表限高 240px 内滚、`truncated` 时行级统计显示破折号、`sharedWorkspace` 恒显「可能含并行会话改动」）+ dev 路由 `/proto/session-file-changes`（折叠 / 展开 / 超时降级 / 100 文件四态）+ `frontend/e2e/proto-file-card.spec.ts`（Playwright 1 例）。它证明的是**形态与节奏**，不是数据链路。daemon 侧另有 `sillyhub-daemon/src/interactive/turn-anchor.ts` 的轮锚 JSONL（2026-10-13-daemon-turn-anchor-snapshot），但那是另一套机制，**不是** D-023 的 `TurnFileChangesSnapshot`，backend 读模型也没有对应字段——所以本变更的卡片目前只吃桩数据。

三段式（仍按 D-023 契约待做）：

1. **daemon 采集**：轮首记 HEAD 作 baseline；轮尾 `git status --porcelain -z --untracked-files=normal` + `git diff --numstat <baseline>`；ignored 目录只按本轮工具调用路径前缀做 mtime 探测；每轮 ≤3 条 git 子进程、`core.preloadIndex`、`--no-optional-locks`、禁 rename 检测、1500ms 硬超时降级 partial、单工作区串行队列。
2. **backend 透传**：轮次/会话读模型多带一个快照字段（形状见「接口定义」的 `TurnFileChangesSnapshot`），老 daemon 无数据时为 `null`，且必须带 `capability` 标记供前端决定走降级还是走卡片。
3. **前端卡片**：turn 级卡片列出逐文件 +/− 与归因（`edit_patch` 归因 / 「命令行/脚本改动」），会话级汇总去重后给总数；卡片必须注明「可能含并行会话改动」；daemon 老版本时降级为「仅工具编辑」并显式提示。

**1b 落点（三段，文件级；未落盘的前缀 `NEW:`，与「文件变更清单」同源；目录惯例沿用 `.sillyspec/docs/frontend/modules/components-daemon.md` 的 `daemon/*` 分目录与 `file-changes/` 子目录写法）**：

1. **daemon 采集**：`NEW:sillyhub-daemon/src/interactive/turn-file-changes.ts`（采集纯函数 `collectTurnFileChanges`：轮首 HEAD 基线 → 轮尾 `status --porcelain -z` + `diff --numstat` + ignored 目录 mtime 探测；≤3 子进程、1500ms 硬超时、单工作区串行队列）+ `NEW:sillyhub-daemon/src/interactive/turn-file-changes-types.ts`（快照 DTO 的 daemon 侧类型）+ 接线点 `sillyhub-daemon/src/interactive/session-manager.ts`（轮终态落库后**异步**触发采集；**不碰** `turn-anchor.ts` 的轮锚 JSONL 机制，那是另一套）+ `NEW:sillyhub-daemon/tests/interactive/turn-file-changes.test.ts`。
2. **backend 透传**：`backend/app/modules/daemon/schema.py`（`TurnFileChangesSnapshot` 的 pydantic 镜像 + `capability`）+ `backend/app/modules/daemon/model.py`（承载面：新列或侧表，由 1b 立项定）+ `backend/app/modules/daemon/lease/service.py`（轮终态 apply 处按 `runId` 幂等落库，与 `AgentRunModelUsage` 同处）+ `backend/app/modules/daemon/router/session_insights.py`（轮次读模型投影多带 `fileChanges`；与本文件的 FR-23 model-usage 段**同文件不同段，禁混改**）+ `NEW:backend/app/modules/daemon/tests/test_session_file_changes.py`。
3. **前端卡片**：`NEW:frontend/src/components/daemon/file-changes/turn-file-changes.ts`（快照 → 卡片 props 的纯函数：归因映射 / partial → `truncated` / `tool_only` → 降级态）+ `frontend/src/components/daemon/file-changes/file-changes-card.tsx`（补 `capability="tool_only"` 的「仅工具编辑」形态）+ `NEW:frontend/src/components/daemon/file-changes/file-changes-summary.tsx`（会话级汇总，去重 + Σ+/− + 横幅）+ 接线点 `frontend/src/components/daemon/turn-timeline.tsx`（轮级挂载，快照未到不出空卡）+ `NEW:frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts` / `NEW:frontend/src/components/daemon/file-changes/__tests__/file-changes-summary.test.tsx`。

承载面（1b 快照落在哪张表/列）由 1b 立项决定，本设计只定形状：见「数据模型」与「接口定义」的 `TurnFileChangesSnapshot` 契约要点。

### 线 D：会话 × 模型用量明细端点（FR-23，已落盘）

`backend/app/modules/daemon/router/session_insights.py:933-1052` 新增只读端点 `GET /sessions/{session_id}/model-usage`：`agent_run_model_usage` JOIN `agent_runs` 直出 run × model 的 token 明细（含 cache 两维），轮次序优先排序、`get_agent_session` 归属闸门（missing / 跨用户 / 软删 → 404，不泄露存在性）、硬上限 2000 行 + `truncated`（不分页）；`backend/openapi.json` 与两侧 `api-types.ts` 由 `pnpm gen:types` 同源重生成。**UI 消费面尚未接线**——本期只交付后端能力与生成物（验收见 SC-10 / task-25）。

### 配套：原型与导出管线

- `frontend/src/app/proto/session-redesign/`：真实 `AppShell`（preview 入参注入 fixture 用户/工作区）+ 真实 `SessionListPanel`（`proto-fixtures.ts` 在 fetch 层打桩 + Query 预热）+ 真实 `TurnTimeline`（数据＝用户提供的真实会话导出，经产品装配器 `logsToTurns` 装配）+ 真实 `CtxUsageBar` / `SessionInputBar`（发送不接线）。
- `frontend/src/app/proto/session-redesign/staged-session-export.ts`：服务端读 `frontend/.proto-staging/session-export.json`（gitignored），数据只进 RSC 载荷、不进 JS bundle。
- `frontend/scripts/export-hydrated.mjs`：playwright 打开路由 → `networkidle` → `waitForFunction(.wmde-markdown ≥ 50)` → 逐片 `cssRules` → `outerHTML` → 剥 `<script>`/`<link>`/原 `<style>` → 合并单 `<style>` → 机械校验 → 落盘（失败 exit 1 且不落盘）。
- `frontend/src/components/prototype/session-fold-view.tsx` + `frontend/scripts/prototype-build.mjs`（注册 view）是 D-010 时期「折叠 A/C 双形态」静态原型的真码变体；D-011 否决静态复刻做定稿后，该线只作留档，不再迭代。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/router/session_insights.py | **FR-23**（已落盘，`:933-1052`，+122 行）：`SessionModelUsageItemRead` / `SessionModelUsageRead` + `GET /sessions/{session_id}/model-usage`。数据流：producer=`agent_run_model_usage` × `agent_runs` JOIN → 端点投影（只读、不二次聚合、不含日志正文）→ consumer=`frontend/src/lib/api-types.ts` 的 `components["schemas"]["SessionModelUsageRead"]`；**UI 消费面尚未接线**（全树只有生成物引用该 path）。1b 后续在同一文件加 `fileChanges` 投影（另一段、另一任务，禁混改） |
| 修改 | backend/app/modules/daemon/router/__init__.py | `__all__` 追加 `get_session_model_usage`（`:283-286`），与 `get_session_usage` 同段，避免路由注册漏项 |
| 修改 | backend/openapi.json | 由应用重新生成：+136 行（1 个 path + `SessionModelUsageItemRead` / `SessionModelUsageRead` 两个 schema + 1 个 operation） |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 重生成：+117 行（`paths` / `components.schemas` / `operations` 三处），**禁手改** |
| 修改 | sillyhub-daemon/src/api-types.ts | 同上重生成：+117 行，与前端生成物逐字节同源（同一份 openapi 产物） |
| 新增 | backend/app/modules/daemon/tests/test_session_model_usage.py | FR-23 契约 4 例（排序 / 404 归属 / 空态 / truncated），**260 行**（LF 260；此前误记为 243） |
| 修改 | frontend/src/app/globals.css | 新增 `.seg-text-body` 正文 15px / 1.8 / 0.65em 与标题、行内 code 上浮规则；块序在手机端覆盖块之前 |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | `turn-block` 去 `border-b` 只留 `pb-7`；进度列 `gap-[7px]` + 答复块 `mt-[7px]`；轮元信息派生 `metaDetail` 并右贴；用户气泡改 56% / `primary/[0.08]` 低饱和底；可选 `detailLevel` prop 与折叠头；**1b 接线点（待改）**：轮级 `FileChangesCard` 挂载（数据来自 run DTO 的 `fileChanges`，快照未到不出空卡） |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | 思考行/工具行 11.5px + `muted-foreground/80`；工具行去框改 2px 左规线（静息 `border-border/60`）；去掉思考摘要 `opacity-75`；D-025 过程行接入固定语义标签（思考 / 运行命令 / 读写文件 / 搜索 / 其它，失败优先），工具名原样保留 |
| 新增 | frontend/src/components/daemon/process-labels.ts | D-025 纯展示标签词表：`processLabel(kind, toolName, status)` → `{ label, icon }`（七类；错误状态优先；大小写不敏感；未知工具 → 其它） |
| 新增 | frontend/src/components/daemon/__tests__/process-labels.test.ts | 词表 18 例（七类 / 未知 / 空工具名 / error·deny·failed 压类别 / 大小写 / mcp 前缀） |
| 修改 | frontend/src/components/daemon/attachment-chips.tsx | 附件 chip 增 `tone: "onPrimary" \| "brand"` 双档，缺省等价旧行为 |
| 修改 | frontend/src/components/chat/round-divider.tsx | 新增 `detail?: string`：轮时间细节右贴（等宽 10.5px / muted），缺省零视觉变化 |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | 行内边距微收、行时间 9.5px、chip 统一 9px、轮数右贴 |
| 修改 | frontend/src/components/app-shell.tsx | 新增可选 `preview?: AppShellPreview`（user / workspace / onLogoutRequest），不传逐字段等价原实现 |
| 修改 | frontend/src/components/top-bar.tsx | 新增可选 `workspacePreview` 并透传给 `WorkspaceSwitcher` |
| 修改 | frontend/src/components/workspace-switcher.tsx | 新增可选 `preview?: WorkspaceSwitcherPreview`（name / bound / online），不传走原派生逻辑 |
| 修改 | frontend/scripts/prototype-build.mjs | 注册 `session-fold-view` 到静态原型清单（D-010 时期产物，D-011 后仅留档） |
| 修改 | frontend/src/components/daemon/__tests__/turn-time-display.test.tsx | 新增「轮间节奏与助手列分区（2026-10-21 视觉裁决）」describe（3 例）锁住无 hairline / 保留 `pb-7` / 14px 分区 |
| 修改 | frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx | 字阶断言更新到 15px/1.8/0.65em、11.5px、`/80`、`/60`，并断言旧值 14.5px 不回流 |
| 修改 | frontend/src/components/daemon/__tests__/turn-segment-views-thinking-translate.test.tsx | **D-025 词表连带（+2/−1）**：`expandRow()` 的开合按钮查询由 `name: /思考过程/` 改为 `name: /思考/`（折叠头改渲染固定语义标签「💭 思考」） |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx | **D-025 词表连带（+2/−2）**：两处折叠头断言由 `getByText("💭 思考过程")` 改为 `getByText("思考")` |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx | **D-025 词表连带（+2/−2）**：`queryByText(/💭 思考过程/)` 两处改为 `getByText("思考")` / `queryByText("思考")` |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx | **D-025 词表连带（+4/−4）**：对话视图「不出现思考行」与进度视图「出现思考行」两处断言由「思考过程」改「思考」（含注释同步） |
| 新增 | frontend/src/components/daemon/turn-fold.ts | 折叠判定纯函数（`isTurnFoldable` / `processStepCount` / `formatFoldDuration` / `foldHeaderText` / `textOnlySegments`）与 `DetailLevel` |
| 新增 | frontend/src/components/daemon/__tests__/turn-fold.test.ts | 折叠纯函数 22 例 |
| 修改 | frontend/src/components/daemon/trajectory/build-trajectory.ts | 轨迹装配器纯函数（新增→改，946 行）：分组/排序/配对/截断/窗口 + D-024/D-026 增 `TrajectorySpan` / `TrajectoryLanes` / `TrajectoryCoverage`、`deriveModelSpans`（整段非工具空档 + 含思考/答复行、与工具区间零重叠）、导出 `buildTrajectoryLanes` |
| 新增 | frontend/src/components/daemon/trajectory/zoom.ts | 视野纯函数：`zoomAt` / `panView` / `clampView` / `tickTimes` / `pickSpanAt` / 刻度与范围文案 + `MIN_VIEW_SPAN_MS` / `ZOOM_STEP` / `HIT_BAND_PX`（272 行，零 DOM） |
| 新增 | frontend/src/components/daemon/trajectory/trajectory-timeline.tsx | 三泳道共享绝对时间轴：滚轮缩放（非 passive）/ 拖拽平移 / 双击与按钮重置 / 10px 总览刷子 / 6px 命中带最近中心裁决 / 视野派生刻度（738 行） |
| 修改 | frontend/src/components/daemon/trajectory/trajectory-view.tsx | 轨迹视图（新增→改，539 行）：删「每轮一行」时间概览，泳道时间轴 + `role="grid"` 账本同列叠放（右缘对齐 Δ≤2px）+ 320px 检查器整列高度 |
| 新增 | frontend/src/components/daemon/trajectory/__tests__/build-trajectory.test.ts | 轨迹 builder 单测（现 31 例，含泳道/覆盖率/口径用例） |
| 新增 | frontend/src/components/daemon/trajectory/__tests__/zoom.test.ts | 视野数学 18 例（锚点稳定、两端钳制、跨度上下界、命中带裁决、刻度文案） |
| 修改 | frontend/src/components/daemon/trajectory/__tests__/trajectory-timeline.test.tsx | 泳道组件 7 例（三泳道渲染、非 passive wheel、重置、刷子、命中带选中） |
| 新增 | frontend/src/app/proto/session-trajectory/page.tsx | dev 路由：SSR 读 `.proto-staging` 真实导出（`force-dynamic`） |
| 新增 | frontend/src/app/proto/session-trajectory/trajectory-proto-view.tsx | 客户端壳：取数 → `buildTrajectory` → `TrajectoryView`（含 dev 说明条与计数） |
| 新增 | frontend/src/app/proto/session-redesign/page.tsx | dev 路由：v2 预览（SSR 读真实导出，缺文件返回 null） |
| 新增 | frontend/src/app/proto/session-redesign/view.tsx | 真实壳层 / 左栏 / 输入区 + 真实导出装配的 `TurnTimeline`；现状/ v2 与对话/进度切换 |
| 新增 | frontend/src/app/proto/session-redesign/proto-fixtures.ts | fetch 打桩 + Query 预热（仅 `/proto/` 作用域；未打桩 `/api/*` 返 404 不返 401，避免清登录态） |
| 新增 | frontend/src/app/proto/session-redesign/staged-session-export.ts | 服务端读盘读取器（`node:fs`，仅 server component 引用） |
| 新增 | frontend/src/app/proto/session-redesign/types.ts | `StagedSessionExport` / `StagedRun` / `StagedSessionMeta` 声明 |
| 新增 | frontend/src/app/proto/session-redesign/session-redesign.module.css | v2 skin 作用域（`.v2` 下 token 化节奏参数 + 本页自建 chrome） |
| 新增 | frontend/src/components/daemon/file-changes/file-changes-card.tsx | 轮级文件变更卡（props only、桩数据形态原型）：折叠一行 28px / 展开 24px 文件行 / 限高 240px 内滚 / `truncated` 破折号 / `sharedWorkspace` 提示 |
| 新增 | frontend/src/app/proto/session-file-changes/page.tsx | dev 路由：折叠 / 展开 / 超时降级 / 100 文件四态 + 三主题换肤（桩数据，文件行点击只写日志） |
| 新增 | frontend/e2e/proto-file-card.spec.ts | Playwright 1 例：三卡在场、28px 折叠行、点行触发 `onOpenFile`、降级/归因标记各一次、100 文件内滚、console 0 错 |
| 新增 | frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx | 卡片形态面 8 例（折叠 28px 头 / 展开 24px 行 / shell 归因徽标 / truncated 破折号 / sharedWorkspace 提示 / 行点击 Enter·空格 / 空 files 零渲染 / 100 文件限高内滚） |
| 新增 | NEW:sillyhub-daemon/src/interactive/turn-file-changes.ts | **1b 第一段（daemon 采集，待新建）**：`collectTurnFileChanges()` 纯函数——轮首 `baselineHead`；轮尾 `git status --porcelain -z --untracked-files=normal` + `git diff --numstat <baselineHead>`；ignored 目录按本轮工具调用路径前缀做 mtime 探测；`≤3` 子进程 / `core.preloadIndex` / `--no-optional-locks` / 禁 rename / 1500ms 硬超时降 `partial` / 单工作区串行队列（`queue_overflow`）。producer=daemon 轮生命周期钩子 → consumer=`session-manager.ts` 上报 |
| 新增 | NEW:sillyhub-daemon/src/interactive/turn-file-changes-types.ts | 1b 快照 DTO 的 daemon 侧类型（`TurnFileChangesSnapshot` / `TurnFileChange` / `FileChangesCapability`），字段名必须与 backend pydantic 镜像逐字对齐（`status` / `reason` / `truncated` / `files[].attribution` / `source`） |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | 1b 采集接线点（待改）：轮终态落库**之后**异步触发采集（禁阻塞轮结束与 SSE 终态），按 `runId` 幂等覆盖写；不碰 `turn-anchor.ts`（另一套 JSONL 机制）。**同一接线点还承接 TTFT/attempt 上报（task-10）**——两个 daemon 任务共用本文件，必须串行（plan W4→W5） |
| 修改 | sillyhub-daemon/src/daemon.ts | **D-028 范围扩（2026-10-21）**：`notifyRunResult` 的 payload 内联类型（`:980-1010`）与 body 组装（`:4040-4200`）加**可选** `file_changes`（task-10 再追加 `timing`），字段存在才写（沿用 `model_usage` 惯例） |
| 修改 | sillyhub-daemon/src/hub-client.ts | **D-028 范围扩**：`notifyRunResult` 请求体类型（约 `:1200-1300`）加同名可选字段并映射 `body.file_changes` |
| 新增 | NEW:sillyhub-daemon/tests/interactive/turn-file-changes.test.ts | 1b daemon 单测：六类夹具（有改动 / 无改动 / 非 git 仓 / untracked / binary / ignored-by-mtime）+ 超时 `partial` + 串行队列不并发 + 子进程计数 ≤3 |
| 修改 | backend/app/modules/daemon/schema.py | 1b 第二段（backend 透传，待改）：`TurnFileChangesSnapshot` 的 pydantic 镜像 + `capability: "full" \| "tool_only"`，加入轮次读模型响应（老 daemon 缺字段 → `null` + `tool_only`） |
| 修改 | backend/app/modules/daemon/model.py | 1b 承载面（待改，视 1b 立项而定）：轮次读模型侧新增快照承载（新 `JSON` 列或侧表；若增列则同时出新迁移，迁移文件由 1b 立项时生成，本清单不预造路径） |
| 修改 | backend/app/modules/daemon/lease/service.py | 1b 落库 helper（待改）：新增 `_upsert_run_snapshot(agent_run, payload)`（`:1168-1196` 段，与 `_upsert_batch_model_usage` 相邻，供 batch 与 interactive 两条路径共用），`(runId)` 键幂等 upsert。**interactive 的实际调用点在 `close_run_steps.py:379-417`（2026-10-21 校正，D-027）** |
| 修改 | backend/app/modules/daemon/router/lease.py | **D-027 范围扩（2026-10-21 用户批准）**：`InteractiveRunResultRequest`（`:217` 附近）加**可选** `file_changes` / `timing` / `daemon_version`，不改既有字段与必填性 |
| 修改 | backend/app/modules/daemon/run_sync/service/__init__.py | **D-027 范围扩**：`close_interactive_run`（`:386-449`）加同名可选入参并透传给 `close_run_steps` |
| 修改 | backend/app/modules/daemon/run_sync/service/close_run_steps.py | **D-027 范围扩**：`_close_apply_terminal` 在 `agent_run_model_usage` upsert（`:379-417`）之后调 `_upsert_run_snapshot`（同事务、异常 best-effort 捕获不拖垮终态）。**D-030**：终态 no-op 分支（`status in TERMINAL_TURN_STATUSES`）也要补写侧表——daemon 采集必然晚于首报 close，否则后到快照被丢弃 |
| 修改 | backend/app/modules/daemon/service.py | **D-027 范围扩（实现期新增第 4 个）**：`DaemonService.close_interactive_run` facade 加同名可选参数并透传给 RunSyncService（router → facade → run_sync 链路必经，纯透传不改形状） |
| 新增 | NEW:backend/app/modules/daemon/tests/test_session_file_changes.py | 1b backend 契约单测：`full` / `tool_only` 两分支序列化输出 + 字段名与前端声明一致 |
| 修改 | backend/tests/test_align_platform_change_events_migration.py | **D-033 范围扩（2026-10-21 实现期登记）**：新增迁移 `20261021120000` 后，仓内「迁移链尾锚」守护测试必须把 `heads[0]` 前移到新 head（注释链续写），否则提交 hook 直接拒签——属加迁移的强制连带改动，非新交付面 |
| 新增 | NEW:frontend/src/components/daemon/file-changes/turn-file-changes.ts | 1b 第三段（前端，待新建）：`TurnFileChangesSnapshot \| null` → `FileChangesCardProps` 的纯函数（`attribution: "edit_patch" \| "command"` → `source: "tool" \| "shell"`；`partial` → `truncated`；`tool_only` → 降级态；`null` → 不出卡），零 DOM |
| 新增 | NEW:frontend/src/components/daemon/file-changes/file-changes-summary.tsx | 1b 会话级汇总卡（待新建）：turn 卡聚合去重后给总数与 Σ+/−，`status` 取最差值，恒标「可能含并行会话改动」 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | **1b 接线面补口（2026-10-21 plan 阶段登记）**：`runsMeta`（`:1697`、`:1721`）→ `SessionTurnView` 透传 `fileChanges` / `fileChangesCapability`；只加 props 透传，不改取数 / 分页 / SSE 编排（FR-22 边界） |
| 新增 | NEW:sillyhub-daemon/src/interactive/turn-timing.ts | **TTFT/attempt 采集（2026-10-21 plan 阶段登记，D-025@v1 更正后属于范围内）**：从驱动事件流派生 `TurnTimingSnapshot`（per-attempt 起点 / 首 token / 终点 / model / tokens），纯函数、零 I/O；无采样返回 `null` → 前端保持单色近似 |
| 新增 | NEW:sillyhub-daemon/tests/interactive/turn-timing.test.ts | TTFT/attempt 派生单测：首 token 锚点 / 同一轮多次 attempt / 空流返回 null / 工具调用后的新 attempt 边界 / 无时间戳降级 |
| 修改 | sillyhub-daemon/package.json | **task-13 发版（2026-10-21 plan 登记）**：version 0.1.1 → 0.2.0（新增 1b 快照与 TTFT/attempt 两能力，属 minor）；sillyhub-daemon/src/daemon-version.ts 的 DAEMON_VERSION 由此唯一来源读取，不另设常量 |
| 修改 | .sillyspec/docs/frontend/modules/components-daemon.md | **task-14 文档同步（2026-10-21 plan 登记）**：轨迹段扩写（observed / approx 两态）+ 轮级文件变更卡 / 会话级汇总 / 降级文案 + `turn-timeline` 挂载与 `session-panel-page` 透传锚点 |
| 修改 | .sillyspec/docs/sillyhub-daemon/modules/interactive.md | **task-14 文档同步**：每轮工作区快照（≤3 子进程 / 1500ms→partial / 单工作区串行队列 / ignored 目录 mtime 探测）+ TTFT/attempt 采集与上报时序（`_onResult` 之后异步） |
| 修改 | .sillyspec/docs/backend/modules/daemon.md | **task-14 文档同步**：`daemon_run_snapshots` 侧表 + 轮终态 `(run_id)` 幂等 upsert + 读模型 `file_changes` / `file_changes_capability` / `timing` 与 capability 口径 |
| 修改 | .sillyspec/docs/SillyHub/scan/PROTOTYPE.md | **task-14 文档同步**：dev 预览路由三条（`/proto/session-redesign`、`/proto/session-trajectory`、`/proto/session-file-changes`）已落地实况与 dev-only 边界（不进导航 / 不进 middleware / 真实数据不进 `public/`） |
| 修改 | frontend/src/components/daemon/file-changes/file-changes-card.tsx | 1b 接线（待改）：补 `capability="tool_only"` 的「仅工具编辑」降级形态 + 显式提示，禁止显示「本轮无改动」 |
| 新增 | NEW:frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts | 1b 前端映射纯函数用例（归因映射 / partial → truncated / tool_only 降级 / 空快照不出卡） |
| 新增 | NEW:frontend/src/components/daemon/file-changes/__tests__/file-changes-summary.test.tsx | 1b 汇总卡用例（多轮去重 / Σ+/− / 横幅在场 / 无 worktree 调用） |
| 修改 | frontend/scripts/export-hydrated.mjs | 新增→改：`--with-js`（静态快照 + 约 4.1KB vanilla shim）、`--with-react`（已证伪，保留代码供复核）、`--verify` file:// 离线实测三档 |
| 新增 | frontend/src/components/prototype/session-fold-view.tsx | 折叠 A/C 双形态静态原型的真码变体（D-011 后降为留档） |
| 产物 | frontend/prototype-dist/session-fold.html | `prototype:build` 编译产物（由 `session-fold-view.tsx` 生成；工作树未跟踪，随本次重跑新出） |
| 产物（重生成） | frontend/prototype-dist/index.html | **`pnpm prototype:build` 重跑产物，非手改**（+5/−1）：1 行 CSS 随 `globals.css` 变动 + 新增 `session-fold.html` 页面入口（`:38`） |
| 产物（重生成） | frontend/prototype-dist/change-center.html | 同上重生成（+1/−1）：仅 1 行内联 CSS 随 `globals.css` 变动，HTML 结构未改 |
| 产物（重生成） | frontend/prototype-dist/change-detail.html | 同上重生成（+1/−1）：仅 1 行内联 CSS 随 `globals.css` 变动 |
| 产物（重生成） | frontend/prototype-dist/change-detail-v2.html | 同上重生成（+1/−1）：仅 1 行内联 CSS 随 `globals.css` 变动 |
| 产物（重生成） | frontend/prototype-dist/conflict-sync-states.html | 同上重生成（+1/−1）：仅 1 行内联 CSS 随 `globals.css` 变动 |
| 产物（重生成） | frontend/prototype-dist/session-portal.html | 同上重生成（+1/−1）：仅 1 行内联 CSS 随 `globals.css` 变动 |
| 产物（重生成） | frontend/prototype-dist/sillyspec-flow.html | 同上重生成（+1/−1）：仅 1 行内联 CSS 随 `globals.css` 变动 |
| 产物（重生成） | frontend/prototype-dist/workspace-list.html | 同上重生成（+1/−1）：仅 1 行内联 CSS 随 `globals.css` 变动 |
| 产物（重生成） | frontend/prototype-dist/workspace-overview.html | 同上重生成（+1/−1）：仅 1 行内联 CSS 随 `globals.css` 变动；9 个文件合计 `13 insertions(+) / 9 deletions(-)` |
| 产物 | .sillyspec/changes/2026-10-20-session-page-dsh-alignment/prototype-session-final.html | 水合后 DOM 导出的定稿静态稿（**`--with-js` 产出**；**2,539,861 字节 / 2,480 KB** / 138 个正文块 / `turn-meta-detail` 20 / `turn-block` 20 / `<script data-export-shim="vanilla">` **恰 1 段**（纯静态模式为 0）/ `<link>` 0 / `<style>` 1，2026-10-21 实测量取） |
| 产物 | .sillyspec/changes/2026-10-20-session-page-dsh-alignment/prototype-ab-annotated.html | A/C 双形态对比稿（2,092 KB，留档） |
| 产物 | .sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-final-2026-10-21.png | 定稿稿 `file://` 截图（1600×1000） |
| 产物 | .sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-final-2026-10-21-turn-gap.png | 轮间间距对照截图 |
| 产物 | .sillyspec/changes/2026-10-20-session-page-dsh-alignment/prototype-session-trajectory.html | 轨迹页水合后 DOM 导出的静态稿，已按泳道形态重导出（**2,924,039 字节** / 856 行账本 / `trajectory-lane-label` 3 条泳道 / `trajectory-bar` **618** 根 / `<script data-export-shim="vanilla">` **恰 1 段**（`--with-js` 产出；纯静态模式为 0）/ 0 link / 1 style） |
| 产物 | .sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-trajectory-2026-10-21.png | 轨迹页 `file://` 截图（258,383 字节） |
| 产物 | .sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-trajectory-lanes-2026-10-21.png | 三泳道时间轴截图（316,620 字节） |
| 产物 | .sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-trajectory-zoom-2026-10-21.png | 缩放后视野（刻度补秒 + 刷子位置）截图（295,150 字节） |
| 产物 | .sillyspec/changes/2026-10-20-session-page-dsh-alignment/prototype-file-changes.html | 文件变更卡离线稿：`--with-js` 产出（561,812 字节 / 1 段 vanilla shim / 7 处 `file-changes-card`），**非 React 水合** |
| 产物 | .sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-file-card-2026-10-21.png | 文件变更卡 dev 路由截图（含 100 文件长列表用例另存 `proto-file-card-100files-2026-10-21.png`） |

## 接口定义（接口契约）

### 轨迹装配器（已落盘）

```ts
// frontend/src/components/daemon/trajectory/build-trajectory.ts
export type TrajectoryRowKind = "user" | "assistant" | "thinking" | "tool" | "tool_result" | "system" | "compaction" | "error";
export type TrajectoryRowStatus = "ok" | "error" | "running" | "interrupted";

export interface TrajectoryRow {
  id: string; kind: TrajectoryRowKind;
  turnIndex: number; stepIndex: number; depth: number;
  parentCallId?: string; callId?: string; toolName?: string;
  status: TrajectoryRowStatus;
  startedAt: number; endedAt: number; durationMs: number;   // epoch ms
  inputText?: string; outputText?: string; truncated?: boolean;
  inlineTokens?: { in?: number; out?: number };
  meta?: { toolKind?: string; subagentType?: string; seq?: number };
}
export interface TrajectoryTurn {
  index: number; runId: string; startedAt: number; endedAt: number;
  durationMs: number; status: string; inputTokens?: number; outputTokens?: number;
}
export interface Trajectory { rows: TrajectoryRow[]; turns: TrajectoryTurn[]; lanes: TrajectoryLanes; coverage: TrajectoryCoverage; windowStart: number; windowEnd: number; }
export interface TrajectoryRunInput { id: string; status?: string | null; model?: string | null; started_at?: string | null; finished_at?: string | null; input_tokens?: number | null; output_tokens?: number | null; duration_api_ms?: number | null; error_code?: string | null; }
export interface BuildTrajectoryOptions { maxTextLen?: number }  // 默认 800

/** 泳道条（Gantt bar）：start/end 是真实 epoch ms，渲染端只做线性换算；三泳道共用同一根绝对轴。 */
export type TrajectoryLaneKind = "input" | "model" | "tool";
export interface TrajectorySpan {
  id: string; lane: TrajectoryLaneKind;
  start: number; end: number;            // epoch ms；end === start 表示零宽事件（输入 tick 按下限 2px 渲染）
  label: string; status: TrajectoryRowStatus;
  rowId: string;                         // 指向 rows[]，inspector 复用行详情
  depth: number;                         // 工具嵌套层级（input / model 取来源行 depth）
  // 另有渲染分档字段：turnIndex / tokensLevel("turn"|"event") / tokens?{in,out} / toolName? / subRow
}
export interface TrajectoryLanes { input: TrajectorySpan[]; model: TrajectorySpan[]; tool: TrajectorySpan[]; }
/** 三条泳道的 wall-clock 覆盖率（并集口径：嵌套子工具 / 跨轮重叠只算一次）。 */
export interface TrajectoryCoverage { modelMs: number; toolMs: number; windowMs: number; }  // 空档 = windowMs - modelMs - toolMs

export function buildTrajectory(
  logs: AgentRunLogEntry[],
  runs: TrajectoryRunInput[],
  opts?: BuildTrajectoryOptions,
): Trajectory;
/** 泳道派生单独可测（导出）：行/轮 → 三条泳道的条，start 升序。 */
export function buildTrajectoryLanes(rows: TrajectoryRow[], turns: TrajectoryTurn[]): TrajectoryLanes;
```

不变量：零日志 run 不产轮、不占轮号；`stepIndex` 轮内 1 起；`durationMs ≥ 0`；`windowStart/windowEnd` 覆盖所有行（含早于 `run.started_at` 的 `user_input`）；`modelMs + toolMs ≤ windowMs`；model 条与 tool 条零重叠；同输入恒同输出（无全局状态）。

### 视野数学（`trajectory/zoom.ts`，已落盘）

```ts
// frontend/src/components/daemon/trajectory/zoom.ts —— 无 DOM / 无 React / 无时间源
export const MIN_VIEW_SPAN_MS = 60_000;   // 最近缩放到 1 分钟
export const ZOOM_STEP = 1.15;            // 一档滚轮放大 1.15 倍
export const HIT_BAND_PX = 6;             // 命中带宽度（2px 条也能点中）

export interface ViewWindow { start: number; end: number }   // 当前视野（epoch ms）
export interface ViewLimits { start: number; end: number }   // 整窗边界（= windowStart/windowEnd）

export function viewSpan(view: ViewWindow): number;
export function fullWindowSpan(limits: ViewLimits): number;
export function viewSpanBounds(limits: ViewLimits, minSpan?: number): { min: number; max: number };
export function clampView(view: ViewWindow, limits: ViewLimits, minSpan?: number): ViewWindow;
export function zoomAt(view: ViewWindow, anchorTime: number, factor: number, limits: ViewLimits, minSpan?: number): ViewWindow;
export function panView(view: ViewWindow, deltaMs: number, limits: ViewLimits, minSpan?: number): ViewWindow;
export function timeAtRatio(view: ViewWindow, ratio: number): number;
export function ratioAtTime(view: ViewWindow, at: number): number;
export function tickTimes(viewStart: number, viewEnd: number, count: number): number[];  // 别名 tickTicks
export function axisTicks(viewStart: number, viewEnd: number, count: number): Array<{ at: number; ratio: number }>;
export interface SpanBand<T> { span: T; leftPx: number; rightPx: number }
export function pickSpanAt<T>(bands: SpanBand<T>[], x: number, tolerancePx?: number /* 默认 HIT_BAND_PX/2 */): T | null;
export function clockLabel(at: number, withSeconds?: boolean): string;
export function offsetLabel(at: number, origin: number): string;
export function formatTickLabel(at: number, view: ViewWindow, fullSpanMs: number): string;
export function formatViewRangeLabel(view: ViewWindow, windowStart: number, fullSpanMs: number): string;
```

约定：`ratio = (at - view.start) / (view.end - view.start)`，渲染端 `left% = ratio * 100`，没有第二套坐标；缩放锚点在视野里的比例保持不变（边界处因钳制滑动）；平移只挪起点、跨度不变。

### 折叠候选能力（已落盘，未接线）

```ts
// frontend/src/components/daemon/turn-fold.ts
export type DetailLevel = "compact" | "standard" | "detailed";
export interface FoldTurnLike { status: string; segments?: readonly { kind: string }[] | undefined; processItems?: readonly { kind: string }[] | undefined; apiDurationMs?: number | null | undefined; }
export function isTurnFoldable(turn: FoldTurnLike): boolean;          // 仅 completed
export function processStepCount(turn: FoldTurnLike): number;         // text/preamble/compact 不计
export function formatFoldDuration(ms: number | null | undefined): string | null;  // 缺失返 null，不伪造
export function foldHeaderText(turn: FoldTurnLike, level: DetailLevel): string;
export function textOnlySegments<T extends { kind: string }>(segments: readonly T[]): T[];
```

```ts
// frontend/src/components/daemon/turn-timeline.tsx:393（`TurnRowProps` 的 detailLevel 声明）
detailLevel?: DetailLevel;   // undefined＝现行为；非 detailed 且 isTurnFoldable 才折
```

### 视觉组件扩参（向后兼容，全部可选）

```ts
// frontend/src/components/chat/round-divider.tsx:69
detail?: string;             // 轮时间细节右贴；缺省＝原结构（胶囊居中不动）

// frontend/src/components/daemon/attachment-chips.tsx:31
tone: "onPrimary" | "brand"; // 缺省 onPrimary＝旧外观

// frontend/src/components/app-shell.tsx:162-169
export interface AppShellPreview { user: SessionUser | null; workspace?: CurrentWorkspace | null; onLogoutRequest?: () => void; }
AppShell({ children, preview }: { children: ReactNode; preview?: AppShellPreview })

// frontend/src/components/workspace-switcher.tsx:106-113
export interface WorkspaceSwitcherPreview { name: string; bound: boolean; online: boolean; }

// frontend/src/components/top-bar.tsx:136
workspacePreview?: WorkspaceSwitcherPreview;
```

### 原型数据面（已落盘）

```ts
// frontend/src/app/proto/session-redesign/types.ts:53
export interface StagedSessionExport {
  export_version: number; exported_at: string;
  session: StagedSessionMeta; runs: StagedRun[]; logs: AgentRunLogEntry[];
  tasks?: unknown[]; attachments?: unknown[]; truncated?: boolean; dropped_rows?: number | null;
}

// frontend/src/app/proto/session-redesign/staged-session-export.ts:36
export function loadStagedSessionExport(): StagedSessionExport | null;  // 读盘失败/坏 JSON → null，不抛
```

### 会话 × 模型用量明细端点（FR-23，已落盘）

```python
# backend/app/modules/daemon/router/session_insights.py:933-1052
_SESSION_MODEL_USAGE_MAX = 2000          # 单会话明细行硬上限；溢出裁剪 + truncated=true（不分页）

class SessionModelUsageItemRead(BaseModel):
    run_id: uuid.UUID
    model: str
    started_at: datetime | None = None   # 所属 AgentRun 起止；缺失如实 null，不搬 run 级 duration 冒充调用时长
    finished_at: datetime | None = None
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int               # 该表确有列，故一并透出
    cache_creation_tokens: int

class SessionModelUsageRead(BaseModel):
    session_id: uuid.UUID
    items: list[SessionModelUsageItemRead]
    truncated: bool

@router.get("/sessions/{session_id}/model-usage", response_model=SessionModelUsageRead)
async def get_session_model_usage(...) -> SessionModelUsageRead: ...
```

契约：数据源 `agent_run_model_usage` JOIN `agent_runs`（只读投影，不二次聚合、不读日志正文 / `system_prompt` / `agent_profile_snapshot`）；排序 `created_at asc, id asc, started_at asc, model asc`（轮次序优先，与 turn-outline / runs 同源口径）；归属闸门复用 `get_agent_session`（missing / 跨用户 / 软删 → 404，不泄露存在性）；生成物 `backend/openapi.json` → `frontend/src/lib/api-types.ts` / `sillyhub-daemon/src/api-types.ts` 由 `pnpm gen:types` 重生成（禁手改）。**UI 消费面尚未接线**：全树目前只有生成物引用该 path，接 UI 属后续变更。

### 文件变更卡 DTO（线 C 实现契约：卡片已落盘，数据链路未落盘）

```ts
/** 设计契约：execute 阶段按此形状落 daemon → backend → 前端三段（D-023@v1）。 */
export interface TurnFileChange {
  path: string;                    // 仓根相对
  status: "added" | "modified" | "deleted" | "untracked";  // 禁 rename 检测 → 改名呈现为 delete+add 两条
  added: number; deleted: number;  // git diff --numstat（二进制为 0/0 + binary:true）
  binary?: boolean;
  attribution: "edit_patch" | "command";   // edit_patch 归因 or 「命令行/脚本改动」
  editToolNames?: string[];        // attribution=edit_patch 时的工具名（Edit/Write）
  source?: "git" | "mtime";        // ignored 目录来自 mtime 探测时必须标 mtime
}
export interface TurnFileChangesSnapshot {
  runId: string;
  baselineHead: string | null;     // 轮首 HEAD；非 git 仓为 null
  collectedAt: string;             // ISO
  collectMs: number;
  status: "ok" | "partial" | "failed" | "unavailable";
  reason?: "timeout" | "not_a_repo" | "git_missing" | "queue_overflow";
  truncated?: boolean;             // 改动数超上限被截断
  files: TurnFileChange[];
  concurrentSessionsHint: true;    // 恒 true：共享工作区可能含并行会话改动
}
/** capability 标记：daemon 未上报快照时前端据此降级为「仅工具编辑」。 */
export type FileChangesCapability = "full" | "tool_only";
```

**`TurnFileChangesSnapshot` 契约要点（1b 三段共用，逐跳不得增删字段）**

1. **producer（daemon）**：`files[].added/deleted` 只取 `git diff --numstat <baselineHead>`（二进制 → `0/0` + `binary:true`）；`status` 由 `--porcelain -z` 的 `XY` 裁决（`??` → `untracked`、含 `A` → `added`、含 `D` → `deleted`、其余 → `modified`）；禁 rename 检测，改名一律呈现为 delete + add 两条。
2. **归因**：`attribution="edit_patch"` 只在同一文件命中本轮 `Edit/Write` 的 `edit_patch.path` 时使用（`editToolNames[]` 记录来源工具）；其余一律 `"command"`（「命令行/脚本改动」）。**禁止**用 `edit_patch` 反推改动来源（D-023 已核实 91/1271 覆盖，bash 178 条与 sillyspec 30 条无 patch）。
3. **降级三态**：`status="ok"` 全量可信；`"partial"` ＝ 1500ms 超时（`reason="timeout"`）或改动数超上限（`truncated=true`）或队列溢出（`reason="queue_overflow"`）——**卡片一律照出**：有文件清单时列文件、行级 +/− 显示破折号；**无文件清单时（超时 / 队列溢出，daemon 返回 `files=[]`）出「一行提示卡」**（`data-testid="file-changes-notice"`：「工作区快照未完成（超时或队列溢出），本轮改动未知」，D-034），绝不静默成「本轮无改动」；`"failed"` / `"unavailable"`（`reason="not_a_repo"` / `"git_missing"`）＝ 前端按 `capability="tool_only"` 走降级卡。`partial` 不是错误态（E3）。
4. **capability 独立成字段**（`"full" | "tool_only"`）：老 daemon 不认这个字段时 backend 必须补 `"tool_only"`；前端**只看 capability、不看字段是否存在**——否则「快照字段缺失」会被误显示成「本轮无改动」（E6 / E8）。
5. **顺序与幂等**：`(runId)` 为键覆盖写；E2 在轮终态落库**之后**异步执行；同一 `runId` 重复上报必须等价于最后一次上报（禁追加）。
6. **不含**：不改 `agent_run_logs`、不写 `edit_patch` 表、不新增 HTTP 端点——快照随轮次读模型透传（E5 只读投影）。

### 1b 承载面与读模型字段（2026-10-21 plan 阶段定稿，plan task-08 / task-09 / task-10）

契约要点已钉死形状，本节只钉**承载面与命名**（此前「由 1b 立项定」的空白）：

- **承载面**：`backend/app/modules/daemon/model.py` 新增侧表 `daemon_run_snapshots`（`run_id` FK `agent_runs.id` 唯一 + `ondelete CASCADE`；`file_changes` JSON、`timing` JSON、`collect_ms` int、`status` str、`reason` str、`truncated` bool、`capability` str、`daemon_version` str），配一条增量迁移；**不改 `agent_runs` 既有列**。
- **落库点**（2026-10-21 execute 期校正，见 D-027）：**interactive 轮**＝`backend/app/modules/daemon/run_sync/service/close_run_steps.py` 的 `_close_apply_terminal`（与 `agent_run_model_usage` upsert 同事务段，`:379-417`）——`complete_lease` 只服务 batch，原写「`lease/service.py`（与 `_upsert_batch_model_usage` 同事务，`:1168-1196`）」对 interactive 不成立；**batch 轮**仍在 `lease/service.py:1168-1196` 段。两处共用同一 `_upsert_run_snapshot` helper，`(run_id)` 幂等覆盖写。
- **读模型字段**（轮次投影，snake_case 为后端口径、camelCase 为前端口径）：`file_changes` / `fileChanges`（`TurnFileChangesSnapshot | null`）、`file_changes_capability` / `fileChangesCapability`（`"full" | "tool_only"`，无快照时必须为 `tool_only`）、`timing`（`TurnTimingSnapshot | null`，无采样时必须为 `null` 而非空对象）。
- **daemon 侧命名**：`collectTurnFileChanges()`（`sillyhub-daemon/src/interactive/turn-file-changes.ts`）与 `deriveTurnTiming()`（`sillyhub-daemon/src/interactive/turn-timing.ts`，纯函数，零事件返回 `null`）。
- **`TurnTimingSnapshot`**：`{ runId, basis: "observed" | "approx", ttftMs: number | null, totalMs, attempts: [{ index, startedAt, firstTokenAt, endedAt, model, inputTokens, outputTokens }] }`——`ttftMs` 只在取到首 token 时有值，禁填 0 冒充；attempt 区间与工具区间必须零重叠。

## 生命周期契约表

本变更只有**线 C（1b）**触及 daemon 每轮的采集期；线 A / 线 B 是纯渲染与纯函数，不产生事件、不改任何状态机（表内事件全部属于线 C 的契约）。

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| E1 轮首基线 | daemon 轮启动点 | 本工作区快照队列 | `runId`、`baselineHead`、`workspaceRoot` | 快照态 `idle → armed` |
| E2 轮尾采集 | daemon 轮结束点 | git 子进程（≤3 条） | `runId`、`baselineHead`、本轮工具调用路径集合 | `armed → collecting` |
| E3 采集完成 | git 子进程 | daemon 快照模块 | `files[]`、`collectMs`、`status`、`truncated` | `collecting → collected`（超时/超限则 `→ partial`，git 不可用则 `→ unavailable`） |
| E4 快照上报 | daemon | backend（轮次/会话读模型） | 整个 `TurnFileChangesSnapshot` + `capability` | `collected/partial → persisted` |
| E5 读模型透传 | backend | 前端会话页 | `TurnFileChangesSnapshot \| null`、`capability` | 无状态机（只读透传） |
| E6 前端渲染 | 前端 turn 卡片 | 用户 | `files[].attribution`、`concurrentSessionsHint`、`status` | `null → 省略卡片`；`full → 卡片`；`tool_only → 「仅工具编辑」降级卡` |
| E7 会话级汇总 | 前端会话卡 | 用户 | 去重后的 `files` 与 Σ`added`/Σ`deleted`、`status` 最差值 | 无状态机（派生只读） |
| E8 版本门控 | daemon 版本上报 | 前端 | daemon 版本 / `capability` | `absent → tool_only`（显式提示，不静默显示「无改动」） |

约束：E2 必须在**轮终态已落库之后**异步执行（禁止用 1500ms 采集阻塞轮结束与 SSE 终态）；E3 的 `partial` 不是错误态（卡片照出，标注来源）；E4/E5 字段缺失一律按 `capability="tool_only"` 处理（前向兼容）。

## 数据模型

- **无 DB schema 变更（本阶段已落盘部分）**：线 A / B 零持久化；FR-23 的 model-usage 端点只读既有表 `agent_run_model_usage` + `agent_runs`，不新增列、不出迁移。线 C 的 1b 快照随轮次读模型承载，是否需要新列 / 侧表由 1b 立项决定（本设计只定形状 `TurnFileChangesSnapshot`，见「接口定义」契约要点）。
- **前端数据模型**：`Trajectory` / `TrajectoryRow` / `TrajectoryTurn` / `TrajectorySpan` / `TrajectoryLanes` / `TrajectoryCoverage`（纯内存，由 logs+runs 派生，不缓存；视野 `ViewWindow` 只活在组件 state，不入模型）；`StagedSessionExport`（只读文件形状）；`TurnFileChangesSnapshot`（线 C 契约）。
- **不变量**：`Trajectory.rows` 与 `Trajectory.turns` 均按 `startedAt` 升序；`TurnFileChangesSnapshot.files` 按 `path` 唯一；rename 不检测（D-023③），改名一律呈现为 delete + add 两条 —— 这会让「改名」看起来像「删一个加一个」，是本设计的已知呈现代价。

## 兼容策略（brownfield 必填）

- **默认行为不变**：`detailLevel` / `RoundDivider.detail` / `AttachmentChips.tone`（缺省 `onPrimary`）/ `AppShellPreview` / `WorkspaceSwitcherPreview` 全部为可选入参；不传时逐字段等价旧实现（`app-shell.tsx:185-187` 明确写出 `preview ? … : 原值`）。
- **旧回退路径保留**：`turn.segments === undefined` 的旧数据仍走 output 气泡 + `processItems` 路径，本变更只把该路径的阅读限宽从 48rem 改 52rem 并共用同一套字阶规则。
- **手机端不受影响**：`globals.css` 的 `[data-variant="mobile"]` 规则未被本变更改动，且桌面规则靠源码顺序让位（`:827-829` 注释为证）。
- **性能线隔离**：`frontend/src/components/daemon/session-panel/`（取数 / 分页 / SSE 编排）**未改动**（`git status` 无该目录），符合 D-006 出界。
- **不改的文件（读取后确认未动；此清单只覆盖线 A 的前端面）**：`frontend/src/components/daemon/turn-status-bar.tsx`（本轮只读取、未改，`git status` 无记录）、`frontend/package.json`（依赖面零新增）。**backend / daemon / 两侧 api-types 的改动见「文件变更清单」**，不在本清单的「未动」范围内。
- **FR-23 端点只增不改**：新 path + 两个 schema 只进 `openapi.json` 与两侧生成物，既有端点响应形状零变化；不新增权限面（沿用 `TaskRunAgentUser` 闸门）。
- **1b 的回退路径与前端不同**：daemon 发版无法按前端方式「删文件即回退」，回退只能靠「老 daemon 无快照字段 → `capability="tool_only"` → 前端省略卡片或显示『仅工具编辑』」的降级链（E8）；禁止把 1b 的回滚写进前端回退清单。
- **可回退**：`/proto/*` 与 `frontend/.proto-staging/` 可整块删除（生产零引用）；`turn-fold.ts` + `detailLevel` 若要回退，删除两者与 `turn-fold.test.ts` 即回到 D-012 之前的状态。

## 边界与并发四问

**问一：谁在什么上下文调用？**
- 线 A：纯渲染期 className/结构改动，无新调用方；`metaDetail` 在 `TurnRow` 渲染体内派生（memo 行内，不新增 state）。
- 线 B：`buildTrajectory` 是纯函数，在 `/proto/session-trajectory` 的 `useMemo` 与 SSR 各跑一次（`trajectory-proto-view.tsx:62-65`），无副作用；`TrajectoryView` 无 fetch / 无 store / 无 context。
- 线 C：daemon 轮生命周期钩子内调 git，跑在 daemon 侧独立子进程，不进前端渲染线程；前端只读 DTO。

**问二：并发与重入怎么防？**
- 线 C 必须**单工作区串行队列**（D-023③）：同一工作区的多会话并发轮尾采集排队执行，队列满时按 `queue_overflow` 降级 `partial`，不允许并发跑 git（会与用户操作争 index.lock）。
- 同一 `runId` 重复采集必须幂等：以 `runId` 为键覆盖写，不追加。
- 线 B 无并发面（纯函数、同输入恒同输出）；线 A 无共享可变状态。

**问三：顺序与竞态在哪？**
- 线 C 的关键顺序：**先落轮终态、再异步采集**——否则 1500ms 采集会把 SSE 终态与前端收尾一起拖住，卡片允许「后到」（前端收到快照才渲染卡片，未到时不显示空卡）。
- 线 A 的竞态面在流式热路径：本变更**没有**碰 `displayTurns` 的身份稳定守卫、`upsertTurn`、贴底重申循环（`turn-timeline.tsx` 的 diff 只在渲染结构与 className 层，另加 `metaDetail` 派生与折叠 state），因此 delta 期的 memo 命中面不变；`metaDetail` 依赖 `turnStartedAt` / `replyAt`，流式期间 `replyAt` 为空即不渲染，不引入额外重渲染。
- 线 B 的顺序面：轮内排序同毫秒用 `agent_event.seq`（`build-trajectory.ts` 的 `orderLogs()` 同毫秒 tiebreak `:340-342`；行级再排序在 `turnRows.sort` 的 `a.meta?.seq` tiebreak `:607-613`），`seq` 缺失时保持原始行序——这是「稳定」而非「正确时间」的取舍，已在单测锁定。

**问四：失败与降级路径？**
- 线 C：git 不存在 / 非 git 仓 → `unavailable`；超 1500ms → `partial`（`reason=timeout`）；改动数超上限 → `partial` + `truncated`；daemon 老版本 → `capability="tool_only"` 显式提示。任何情况下**禁止**把「没有快照」显示成「本轮无改动」。
- 线 B：导出文件缺失 → `loadStagedSessionExport()` 返回 `null` → 占位提示，不白屏（`trajectory-proto-view.tsx:110-116`）。
- 线 A：无失败路径（纯样式），唯一风险是参数被打回旧值 → 由单测断言挡住。

## 风险与死路（风险登记 / Risk）

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 11.5px + `muted/80` 在部分浅色主题接近可读下限（D-021 故障面） | P1 | 已去掉思考摘要叠加的 `opacity-75`（唯一可叠加项），三主题目视复核；若实测 < 3:1 则回到 `/90` 并同步改单测断言与 D-021 记录，禁止只改样式不改断言 |
| R-02 | 长会话「分轮感」完全依赖 28px 留白，留白被压缩即失去分段（D-020 故障面） | P1 | 双向锁死：单测断言 `pb-7` 存在且无 `border-b`；导出脚本对每个 `turn-block` 校验 `pb-7` 在场、线不在场（缺白处 > 0 即失败） |
| R-03 | 视觉结论只在 1600×1000 单视口截图验证，窄屏与超宽屏未覆盖（D-015@v1 故障面） | P2 | 桌面规则与手机端规则分成两个块且 mobile 靠源码顺序优先；execute 前补窄屏截图；本变更不承诺窄屏观感达标（不在范围内） |
| R-04 | `session-redesign.module.css` 仍保留 D-021 之前的 14.5px / 0.55em 参数，当前靠 `globals.css` 的 `!important` 覆盖才不生效，形成「两处参数并存」的漂移隐患 | P2 | 由 1b 前置的小收口把该模块里的 `.seg-text-body` 规则改为引用同一组 token 变量或直接删除，并加注释标注失效；本变更内不改（避免与已验收稿不同源） |
| R-05 | 折叠候选能力无调用方（`turn-fold.ts` + `detailLevel` 属未接线代码），若不裁决会长期悬空（D-012 要求显式写采纳或回退） | P2 | 本设计结论＝**保留为可选能力、禁止接线**（FR-20）；若用户裁决不采纳，删除 `turn-fold.ts` / `detailLevel` / `turn-fold.test.ts` 三处并回退 `turn-timeline.tsx` 折叠头 |
| R-06 | 1b 需 daemon 发版；老 daemon 无快照字段（版本门控面） | P1 | `capability` 标记 + 「仅工具编辑」降级卡 + 显式提示（E8）；字段缺失按 `tool_only` 处理，禁止静默「无改动」 |
| R-07 | 超大仓/超大改动集触顶 1500ms 硬超时 | P1 | `partial` 降级 + 遥测（p50 > 300ms 或降级率 > 5% 报警）；卡片标注 partial 来源，不阻塞轮结束 |
| R-08 | 共享工作区无法区分并行会话归属（D-023 已接受） | P2 | 卡片恒标 `concurrentSessionsHint`「可能含并行会话改动」；不引入每会话 worktree（留作后续根治项） |
| R-09 | 目标仓 gitignore 了 `.sillyspec/` 之类目录时 git 差异看不到 | P2 | ignored 目录走「本轮工具调用路径前缀 + mtime」探测，并在 `files[].source="mtime"` 标明来源 |
| R-10 | 导出脚本依赖 dev server 在跑与浏览器水合（D-018 故障面） | P2 | 脚本自带水合门（`.wmde-markdown ≥ 50`）、120s 超时、失败 exit 1 不落盘；不满足即大声失败而不是产出半成品 |
| R-11 | 静态稿剥掉 `<script>` 后无 hydrate，任何依赖 JS 的交互/懒渲染内容不会出现，容易被当「功能完整性」证据误判；`--with-js` 只有一段 vanilla shim，不改变这个结论 | P1 | 分工写死：交互评审走 dev 路由（`/proto/session-redesign`、`/proto/session-trajectory`、`/proto/session-file-changes`），观感评审走静态稿；禁止用静态稿证明功能 |
| R-12 | 仓根 `.sillyspec/local.yaml`（机器本地、gitignored）的 `known_failures` 里仍有一条为本变更在途 WIP 加的临时豁免 `turn-segment-views.test.tsx`（另一会话 2026-10-21 登记） | P1 | 本变更收口时必须移除该条，否则 verify 会长期遮蔽该文件的真实失败；移除后单跑该文件确认为 **93/93 绿**（2026-10-21 13:58 实测口径；豁免是否已清由 task-20 的勾选状态决定，当前仍未勾） |
| R-13 | 「三次看不出区别」的重判结论只有用户能下（D-019），本变更无法自证观感达标 | P1 | 本变更只保证「稿里有 138 个正文块 + 真实组件树」这一可验证事实；SC-06 与 tasks 的目视条目交原型确认轮收口 |

### 死路（已否决路径，照做即退回）

1. **静态 `prototype:build` 复刻会话页做定稿**（D-011 否决）：`tsc + react-dom/server` 无浏览器运行时，承载不了 `turn-timeline` 的 antd / zustand / thinking-translate 依赖，功能面永远补不完；实测用户判断「缺很多功能」。
2. **抓 SSR HTML 当静态稿**（D-018）：实测该稿含 138 个 CSR `<template>` 占位、真实 `.wmde-markdown` 为 0，答案正文全缺——任何基于它的观感/功能结论都不成立。
3. **以深色截图作为唯一视觉基线并作废浅色稿**（D-015@v1，已被 @v2 取代）：平台有三套主题并存，按单主题写死色值会在另外两套下失效。
4. **整轮折叠作为主线**（D-012 用户否决「折叠没用，方向错了」）：改为视觉层重做；折叠只留候选能力。
5. **每会话独立 worktree 解决并行归属**（D-023 范围外）：成本与调度复杂度远超本期收益，接受标注。
6. **把 `edit_patch` 当改动来源**（D-023 已核实）：真实导出 1271 条日志里只有 91 条带 patch，bash 178 条与 sillyspec 30 条无 patch——只靠它必然漏掉命令行改动。

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-21；本文「非目标」「兼容策略」 | 已覆盖 |
| D-002@v1 | FR-01 / FR-02 / FR-03 / FR-08；`proposal.md` 关键问题 1–2 | 已覆盖 |
| D-003@v1 | FR-01 / FR-02 / FR-08 / FR-09；`proposal.md` 动机 | 已覆盖 |
| D-004@v1 | FR-20；本文线 B「配套原型」与折叠候选能力节 | 已覆盖 |
| D-005@v1 | FR-17；本文「配套：原型与导出管线」（A/C 双形态 → 已由 D-010 升级为 dev 路由） | 已覆盖 |
| D-006@v1 | FR-22；本文「非目标」「兼容策略」 | 已覆盖 |
| D-007@v1 | FR-22；`proposal.md` 不在范围内 | 已覆盖 |
| D-008@v1 | `proposal.md` 成功标准 SC-01…SC-10（原型确认轮定稿的结果） | 已覆盖 |
| D-009@v1 | FR-17 / FR-20；本文「拆分判断」与折叠候选能力节 | 已覆盖 |
| D-010@v1 | FR-12 / FR-17 / FR-19；本文「配套：原型与导出管线」 | 已覆盖 |
| D-012@v1 | FR-20；本文线 A 边界（不改 DOM 契约 / 数据链路 / 渲染分支） | 已覆盖 |
| D-013@v1 | FR-02 / FR-03 / FR-09；本文线 A 第 1–2 条 | 已覆盖 |
| D-014@v1 | FR-17 / FR-18 / FR-19；本文导出管线（并注明被 D-018 升级为水合后 DOM） | 已覆盖 |
| D-015@v1 | FR-09；本文死路第 3 条（已被 @v2 取代，留引用防误用） | 已覆盖（被 D-015@v2 取代） |
| D-015@v2 | FR-09；本文设计目标 6 与线 A 全部改动（零字面色） | 已覆盖 |
| D-016@v1 | FR-01 / FR-02 / FR-03 / FR-04 / FR-06 / FR-07 / FR-08；本文线 A 第 2–8 条 | 已覆盖 |
| D-017@v1 | FR-17；本文死路第 1、2 条 | 已覆盖 |
| D-018@v1 | FR-12 / FR-18 / FR-19；本文导出管线与 R-10 / R-11 | 已覆盖 |
| D-019@v1 | FR-17 / FR-18；`proposal.md` 动机 1 与本文背景 | 已覆盖 |
| D-020@v1 | FR-06；本文线 A 第 4 条与 R-02 | 已覆盖 |
| D-021@v1 | FR-01 / FR-02 / FR-03 / FR-04 / FR-05；本文设计目标 1、3 与 R-01 | 已覆盖 |
| D-022@v1 | FR-10 / FR-11 / FR-12；本文线 B 全节 | 已覆盖 |
| D-023@v1 | FR-13 / FR-14 / FR-15 / FR-16；本文线 C、生命周期契约表 E1–E8、DTO 契约、R-06…R-09 | 已覆盖 |
| D-024@v1 | FR-10 / FR-11；本文线 B「主视图＝泳道时间轴」与「model 条口径」两条 | 已覆盖 |
| D-025@v1 | FR-03；本文线 A 过程行条 + 新增 `process-labels.ts` | 已覆盖：`processLabel` 固定七类词表（思考 / 运行命令 / 读写文件 / 搜索 / 回复 / 失败 / 其它）+ 18 例单测；`turn-segment-views` 消费，工具名原样渲染、未知工具回退「其它」 |
| D-026@v1 | FR-10 / FR-11；本文线 B 全部（缩放 / 平移 / 重置 / 刷子 / 6px 命中带 / 轴对齐 Δ≤2px / model 口径）与「非目标」首条 | 已覆盖（**取代 D-022 的「不做轨迹区间聚焦与滚轮缩放」子句**） |

D-011@v1 状态为 `rejected`，不产生需求归属；其否决理由已作为死路第 1 条与 FR-17 的反向约束并入本文。

FR-23（model-usage 端点）**无对应 D 条目**：不新增决策面，登记缘由见「背景」末段与 `requirements.md`「剩余风险」；若后续改其口径（分页 / 聚合 / 增列）必须另立 D 条目再动。

## 自审

**章节与硬约束**

- 章节齐全：背景 / 设计目标 / 非目标 / 拆分判断 / 总体方案 / 文件变更清单 / 接口定义 / 生命周期契约表 / 数据模型 / 兼容策略 / 边界与并发四问 / 风险登记与死路 / 决策追踪 / 自审。
- frontmatter 含 `author` / `created_at` / `scale: large`（2026-10-21 用户裁决「全并、改判 large」后由 small 改判，旧判据见「拆分判断」的作废说明）。
- 已引用全部当前版本 `D-001@v1`…`D-026@v1`（含 `D-015@v1` 与 `D-015@v2` 两条并存版本；`D-026@v1` 取代 D-022 的「不做区间聚焦与滚轮缩放」子句）。
- 生命周期关键词命中（daemon / session）→ 已给「生命周期契约表」；线 A / B 在该节显式声明不涉及。
- 无残留占位行；风险登记每行都有应对策略。

**诚实清单：本设计尚未被验证或无法自证的部分**

1. **无法目视验证的点**：三主题（ai-native / blue / dark）下 11.5px + `muted/80` 与 15px 正文的实际对比度我没有逐主题量测；`proto-final-2026-10-21.png` 只覆盖 ai-native 浅色、1600×1000 单视口、`全部（进度）` 单视图。深色与蓝色主题、窄屏、对话视图的观感结论目前只有规则层面的保证（token + 无字面色），没有截图证据。
2. **BEFORE 只能 CSS 近似**：D-016 的 ①②③ 属信息架构级问题，纯 CSS 只能做近似。实际落地时做了组件级改动（删除 `SegmentedTurnBody` 内的独立时间行、新增 `turn-block` 容器、用户气泡换底），因此"改前/改后"不是同一 DOM 的样式切换，而是结构变化——任何「只靠 CSS 就能对齐」的说法都不成立（D-013 故障面已登记此点）。
3. **inspector 800 字截断**：轨迹检查器的 `inputText` / `outputText` 默认截到 800 字并置 `truncated`（`build-trajectory.ts` 的 `DEFAULT_MAX_TEXT_LEN = 800`（`:155`）与 `clipText()`（`:269`））。后果：①长 tool 输出的后半段在界面上不可见（只有标记，无「展开全文」按钮）；②截断发生在展示层，`toolResultStatus()` 仍用未截断原文判定（`:293`），所以状态判定不受影响。这是**已知能力缺口**，不是缺陷，但没有 UI 提示「已截断」的文案设计。
4. **stubbed 壳数据**：`/proto/session-redesign` 的壳层用户、工作区、左栏 6 个会话、机器/供应商列表全部来自 `proto-fixtures.ts` 的打桩（`PREVIEW_USER` / `PREVIEW_WORKSPACE` / fetch mock）；输入区是真实组件但**发送未接线**（点击只弹 dev 提示）。所以该页能证明「真实组件的真实渲染」，不能证明「真实数据量下的列表/壳层表现」。
5. **折叠代码 `turn-fold.ts` + `detailLevel` 待裁决**：两者已落盘但**没有任何调用方传 `detailLevel`**（只有 `turn-timeline.tsx` 内部 `detailLevel={detailLevel}` 透传，`:1737`），因此折叠在真实页面上永远不会触发；`turn-fold.test.ts` 22 例只覆盖纯函数，没有页面级断言。按 D-012 它必须被显式裁决——本设计的结论是「保留为可选能力、禁止接线」（FR-20 / R-05），但这条结论最终要由用户在 execute 前确认或否决。
6. **`turn-status-bar.tsx` 未改动**：任务书输入清单里列了它，但 `git status` 无该文件记录，读取后确认本轮只作为上下文（运行中状态条与计时锚点逻辑原样）。
7. **线 C 的数据链路全是契约**：生命周期契约表 E1–E8、`TurnFileChangesSnapshot` DTO、性能红线数值（≤3 子进程、1500ms、p50 300ms、降级率 5%）全部来自 D-023 的决策文本，**没有任何一条被实测**；目前已落盘的只有**桩数据的卡片形态原型**（`file-changes-card.tsx` + `/proto/session-file-changes` + `proto-file-card.spec.ts` 1 例 + `__tests__/file-changes-card.test.tsx` 8 例，证明 28px 折叠行 / 24px 文件行 / 限高内滚 / 降级与归因标记）。线 C 落地时的真实 git 开销、超大仓行为、daemon 发版窗口都还是预测。**FR-23 的 model-usage 端点不属于线 C**：它已落盘并有 4 例 backend 单测，但该套件本轮未复跑（见第 8 条）。
8. **未跑的检查**：2026-10-21 13:58 本轮**实跑** `build-trajectory`（31）+ `turn-segment-views`（93）+ `file-changes-card`（8）＝ **132 例 / 3 文件全绿、退出 0**；合并既有证据后本变更测试面 = **208 例 / 9 文件**：轨迹 **56 例 / 3 文件**（builder 31 + zoom 18 + timeline 7）、过程行语义标签与段视图 **111 例 / 2 文件**（`turn-segment-views` 93 + `process-labels` 18）、配套视觉面 **33 例 / 3 文件**（`turn-time-display` 8 + `turn-fold` 22 + `attachment-chips` 3）、文件变更卡 **8 例 / 1 文件**。`tsc --noEmit` 退出 0（此前实测，本轮未复跑）；Playwright **21/21**（沿用 `decisions.md` D-026 证据，本轮未复跑——本机 e2e 需 `E2E_BOOTSTRAP_EMAIL` 环境变量）。**没有跑 `pnpm lint`（next lint）**；**FR-23 的 backend 4 例（`test_session_model_usage.py`）本轮未复跑**，1b 落地时 backend / daemon 两套必须跑。
9. **`local.yaml` 临时豁免未清理**：仓根 `.sillyspec/local.yaml` 的 `known_failures` 里 `turn-segment-views.test.tsx` 那条是另一会话为本变更在途 WIP 登记的，现该文件 **93/93 绿**（2026-10-21 13:58 本轮实跑），该条应移除（R-12 / task-20，当前 task-20 仍未勾），否则会遮蔽未来真实失败。
10. **参数并存漂移**：`session-redesign.module.css` 的 14.5px / 0.55em 与 `globals.css` 的 15px / 0.65em 并存（R-04），当前靠 `!important` 覆盖，属于「看起来对但不是唯一真相」的状态。
11. **离线静态稿只是「快照 + 约 4.1KB vanilla shim」，不是真水合**：`--with-js` 成品 = 水合后 DOM 的**静态快照** + 一段 4,248 字节的 vanilla 脚本（只重放卡头开合、文件行点击写日志、主题按钮、100 文件显隐），**没有 React 运行时 / hydration / router / inspector**（实测 `prototype-file-changes.html` = 561,812 字节、1 段 shim、7 处 `file-changes-card`，文件头注释已写死这句）。**真水合已被两条路线实测证伪**：① `--with-react` 把 8 个 `<script src>`（12.4MB dev bundle）与 1.2MB 动态 chunk 全量内联（共 9 个脚本、约 13.7MB），脚本确实全部执行、零 http(s) 请求，React 仍报 `Expected server HTML to contain a matching <script> in <head>` → `Hydration failed` → 整根切回客户端渲染；② 同一份文件换伪 http origin（不用 `file://`）报同样的错，说明根因是「水合后 `outerHTML` 再序列化」与 RSC 载荷对不上，不是 `file://` 的锅。**产品表述禁止把这类稿子说成「完整可交互原型」**。
12. **`prototype-file-changes.html` 里点文件行不会真打开文件**：shim 的 `openFile()` 只把被点行的 `data-path` 写进 dev chrome 的 `[data-testid="open-file-log"]`，用途是证明「行点击回调真的被触发、不是页面自渲染」；文件预览/编辑器/路由跳转一律不存在（导出头注释原话：真实 `onOpenFile` 打开文件都不存在）。所以该稿只能作观感与判据交互的证据，功能完整性必须回 dev 路由看。

**组合约束（≥2 条互相牵制的决策已调和）**

- D-020（禁止任何轮间分割线）× D-016（28px 留白节奏）：调和结论＝分段感全部由留白承担，故 28px 被单测与导出脚本双向锁死，避免「线删了、白也被压」的双重退化（R-02）。
- D-021（11.5px + `muted/80`）× D-015@v2（三主题都必须可读）：调和结论＝**禁止再叠加任何 opacity**（思考摘要的 `opacity-75` 已删），因为叠乘后浅色主题会跌破 3:1（R-01）。
- D-013（只用 token + 作用域选择器）× `globals.css` 的 `!important` 用法：调和结论＝`!important` 只允许用在「压 MarkdownText compact 档」这一处，且规则块必须排在 mobile 块之前，让手机端的同特异度规则靠顺序获胜（`globals.css:824-829` 注释为证）。
- D-017（定稿必须是真码）× D-014（静态稿要能传阅）：调和结论＝真码渲染一次、水合后 DOM 固化一份，两者同源；改源码必须重跑导出（禁止手改产物），由 `export-hydrated.mjs` 的校验兜住。
