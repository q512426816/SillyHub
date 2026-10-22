---
author: qinyi
created_at: 2026-10-20 15:24:52
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 会话用户（主力工作台） | 每天在 `/sessions` 里读多轮长答复、追工具执行过程；要求正文先被读到、过程可读但不抢焦点 |
| 会话用户（对外演示） | 一次打开就要站得住：排版、节奏、留白、层次不能靠「再多点两下」 |
| 前端维护者 | 改的是真实组件与 token，不接受手绘稿与 SSR 抓取稿作为验收基线 |
| daemon 维护者 | 承接每轮工作区快照（1b）：不能拖慢轮结束、不能把超大仓拖死、兼容老版本客户端 |
| 评审者/回归者 | 用测试与机械计数复核「稿＝实现」，不靠肉眼口头结论 |

## 功能需求

### FR-01: 轮元信息合并为唯一一行
覆盖决策：D-016@v1（①轮元信息重复）、D-021@v1（四组参数中的元信息档）
Given 一个已完成轮（`replyAt` 存在）
When 在对话视图或「全部（进度）」视图渲染该轮
Then 轮号 / 状态 / 结束时刻 / 历时 / tokens / tok·s 必须全部落在**同一条**元信息行内（整页「历时」字样只出现一次）；对话视图必须经 `RoundDivider.detail`（`frontend/src/components/chat/round-divider.tsx:69`）右贴渲染，进度视图必须经 `data-testid="turn-meta-detail"`（`frontend/src/components/daemon/turn-timeline.tsx:1167`）；锚点缺失时必须只显示可得字段，禁止编造开始时刻或历时。

测试绑定：`frontend/src/components/daemon/__tests__/turn-time-display.test.tsx`::「完成轮双锚点：轮号/状态/结束/历时 全在同一条元信息行内（对话视图；悬浮对话共用内核）」与「进度视图（all）同样只有一条元信息行：状态徽章 + 右对齐时间细节」。

### FR-02: 答复正文提档到 15px / 1.8 / 0.65em
覆盖决策：D-013@v1（正文权重层）、D-016@v1（②正文与过程同权重）、D-021@v1（①）
Given 任意一轮的答复正文（段模型 `TextSegmentView`，或旧回退路径的 `seg-text-body` 气泡）
When 桌面端渲染（不在 `[data-variant="mobile"]` 作用域内）
Then `.seg-text-body` 内的 `.wmde-markdown` 必须是 15px / 行高 1.8 / 段距 0.65em（`frontend/src/app/globals.css:830-842`），并用元素级 `!important` 压住 MarkdownText compact 档的 `!text-xs`；h1/h2 必须 16.5px、h3/h4 必须 15.5px、行内 code 必须 13px（`globals.css:845-855`）；禁止回落到 14.5px / 1.78 / 0.6em 这一组旧值。

测试绑定：`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`::「正文/过程字阶分离（2026-10-20 / 2026-10-21 对比加强）：正文 15px / 1.8 / 段距 0.65em 由 globals.css 的 .seg-text-body 元素级规则承担」（含 `expect(css).not.toContain("font-size: 14.5px !important")`）。

### FR-03: 过程行退档到 11.5px + muted/80，并带 D-025 固定语义标签
覆盖决策：D-021@v1（②）、D-013@v1（过程降噪）、D-025@v1（语义标签词表）
Given 思考行或工具行
When 渲染
Then 两者必须同为 `text-[11.5px]` + `text-muted-foreground/80`（`frontend/src/components/daemon/turn-segment-views.tsx` 思考行 / 工具行容器）；思考摘要禁止再叠 `opacity-75`（与 `/80` 叠乘后浅色主题对比度 < 3:1，不可读）；过程行禁止回到 12px，也禁止回到全额 `muted-foreground`。
同时，每个过程行必须渲染固定语义标签（`frontend/src/components/daemon/process-labels.ts` 的 `processLabel`）：思考 → 「思考」、Bash/Pwsh/Shell/terminal_send 等 → 「运行命令」、Read/Write/Edit/MultiEdit/NotebookEdit/str_replace_editor → 「读写文件」、Grep/Glob/WebSearch/web_fetch/CodebaseSearch → 「搜索」、状态 error/deny/failed → 「失败」（优先于类别）；助手正文段若存在折叠头则用「回复」（当前 `TextSegmentView` 无头部，不另造）；词表外工具名必须回退「其它」且**禁止丢行**。标签是纯展示映射：禁止改写日志原文或工具名，工具名必须仍原样出现（形如 `💻 运行命令 · Bash · pnpm vitest…`）。

测试绑定：`frontend/src/components/daemon/__tests__/process-labels.test.ts`（18 例：七类标签 / 词表外工具 / 空工具名 / error·deny·failed 压过类别 / 大小写不敏感 / mcp 前缀末段匹配）与 `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`::「D-025 语义标签：Bash 行渲染「运行命令」，Read 行渲染「读写文件」，工具名仍原样显示」「D-025：工具行标签后必须用「·」连接摘要（icon + 中文标签 + · + 一行摘要）」+「过程行退档（2026-10-21 对比加强）」两例。

### FR-04: 工具行去外框、改 2px 左规线
覆盖决策：D-016@v1（③框线成灾）、D-021@v1（③左规线静息 /60）
Given 一个工具行（`turn-segment-views.tsx:808` 的工具行容器）
When 静息与 hover 两种态
Then 必须去掉满宽描边与卡底，改 2px 左规线；静息必须 `border-border/60`、hover 必须 `border-l-brand-600`；行尾动作按钮必须默认 45% 透明、hover 复原。

测试绑定：`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`::「去外框形态（2026-10-20 / D-016③）：无满宽描边与卡底，改 2px 左规线 + hover 转 brand，行尾动作默认 45% 透明」（其中断言 `border-border/60`）。

### FR-05: 过程块与答复块 14px 分区
覆盖决策：D-021@v1（④）
Given 「全部（进度）」视图的助手列（`data-testid="turn-progress-column"`，`turn-timeline.tsx:2053`）
When 同时渲染过程段与答复正文段
Then 列内过程行之间必须是 7px（`gap-[7px]`），答复正文块必须额外上留 7px（`[&>.seg-text-body]:mt-[7px]`），两区实际间隔 14px；禁止把过程行间距一并放大到 14px（过程区仍须紧凑）。

测试绑定：`frontend/src/components/daemon/__tests__/turn-time-display.test.tsx`::「助手列分区：过程行间距 gap-[7px]，答复块额外上留 7px（两区实际间隔 14px）」。

### FR-06: 轮间只留留白、禁止任何分割线
覆盖决策：D-020@v1、D-016@v1（③）
Given 任意轮列表（`turn-block` 容器，`turn-timeline.tsx:1712`）
When 渲染轮与轮之间的边界
Then 禁止出现任何边框/分割线（`turn-block` 不得含 `border-b`，也不得含 `border-border`），只允许 28px 留白（`pb-7`）；`globals.css` 禁止残留任何轮间画线规则；后续新增轮容器必须受同一约束。

测试绑定：`frontend/src/components/daemon/__tests__/turn-time-display.test.tsx`::「轮间只有留白：turn-block 无 border-b（含 last:border-b-0 已移除），保留 pb-7 的 28px」与「globals.css 无残留轮间画线规则（轮间分节只由组件留白承担）」；导出侧机械核验 `frontend/scripts/export-hydrated.mjs:909-950`（带线 > 0 或缺 `pb-7` > 0 即失败），实测 `prototype-session-final.html` 20/20 合规。

### FR-07: 用户气泡压暗 + 附件 chips 双档
覆盖决策：D-016@v1（④用户气泡最亮）
Given 用户气泡及其内部图片/文件 chip
When 会话页（新形态）渲染
Then 用户气泡必须走压暗的 brand 基底 + 细边（不再是整屏最亮的纯亮蓝大块）；附件 chip 必须支持 `tone: "onPrimary" | "brand"` 双档（`frontend/src/components/daemon/attachment-chips.tsx:27-31`），缺省 `onPrimary` 必须与旧行为逐像素等价。

测试绑定：`frontend/src/components/daemon/__tests__/attachment-chips.test.tsx`（3 例，覆盖 chips 渲染 / 预览弹窗 / 拉取失败降级零回归）；气泡与 chip 的底色数值不适用：纯 token 类名组合、无 DOM 语义可断言，验收靠 dev 路由目视（`tasks.md` task-05 记录截图）。

### FR-08: 左栏 chip 统一 9px、轮数右贴
覆盖决策：D-016@v1（⑤左栏扫描困难）
Given 会话列表行（`frontend/src/components/sessions/session-list-panel.tsx`）
When 渲染引擎 / 档案 / 轮数 chip 与行时间
Then chip 必须统一 `h-[14px]` + `text-[9px]`（`session-list-panel.tsx:3773`），轮数必须右贴（`ml-auto`，`:3821`），行时间必须 9.5px（`:3594`），行纵向内边距必须按新密度微收（`:3460`）；禁止出现同级同字号 chip 与时间争位。

测试绑定：不适用：纯 Tailwind 字号/内边距类，jsdom 不做级联样式求值；回归面 `frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`（119 例全绿，保证行结构 / 多选 / 导出 / 筛选零改变）。

### FR-09: 三主题只走语义 token
覆盖决策：D-015@v2（取代 D-015@v1）、D-013@v1
Given ai-native / blue / dark 三套主题（`frontend/src/app/globals.css:8-9` 与 `:152`、`:240` 的三个主题块）
When 切换 `html[data-theme]`
Then 本变更的全部视觉改动必须只用语义 token（`hsl(var(--…))`、`--color-*` 或 token 派生类名，含 `/80`、`/60` 这类透明度档），禁止写死色值；主题切换禁止改变布局与信息层级；每套主题的正文与 muted 对比度 SHOULD 满足 ≥ 4.5:1 / ≥ 3:1（D-015@v2 登记的故障面）。

测试绑定：不适用：CSS 自定义属性无法在 jsdom 求值；替代证据 = `turn-segment-views.test.tsx` 的「旧值 14.5px 不回流」断言 + dev 路由三主题目视（`tasks.md` task-08 记录）。

### FR-10: 轨迹装配器必须是纯函数且覆盖全部边界
覆盖决策：D-022@v1
Given 真实会话导出的 `logs` + `runs`
When 调用 `buildTrajectory(logs, runs, opts?)`（`frontend/src/components/daemon/trajectory/build-trajectory.ts` 的 `export function buildTrajectory(` 签名，`:354`）
Then 必须按 `runs` 顺序分组，零日志 run 必须不产轮且不占轮号；轮内必须按事件时间排序（同毫秒用 `agent_event.seq` 稳定，无 seq 的行仍按时间落位）；`tool_use` 必须与同 `call_id` 的 `tool_result` 合成一行（时长跨两条日志），无结果的 `tool_use` 在 run 正常结束时必须 `running`、在 failed/killed/interrupted/cancelled 时必须 `interrupted`；`depth` / `parentCallId` 必须从日志透传；`inputText` / `outputText` 必须默认截到 800 字并置 `truncated`；stdout 文本协议前缀（`[THINKING]` / `[TOOL_RESULT]` / `[ASSISTANT]` / `[REPLY]` 等）必须剥除但正文原文禁止改写；单测必须 ≥ 12 例。

测试绑定：`frontend/src/components/daemon/trajectory/__tests__/build-trajectory.test.ts`（31 例，覆盖：tool_use/tool_result 配对、Exit code 非 0 → error、Exit code 0 含 error 字样仍 ok、无结果 running、killed → interrupted、嵌套 depth/parentCallId、thinking 前缀剥除 + inlineTokens、text → assistant、user_input → user、TASK_STARTED → system、零日志 run 不占号、乱序重排 stepIndex、同毫秒按 seq、maxTextLen 截断、默认 800、run 时间优先、时间缺失回退、窗口覆盖早于 run 的 user_input、孤儿 tool_result、旧轨 tool_call envelope，以及 D-024/D-026 的 lanes / coverage / model 空档口径）。

### FR-11: 轨迹视图是第三个入口，不是替换
覆盖决策：D-022@v1、D-024@v1（主视图＝泳道时间轴）、D-026@v1（缩放/平移/窗口与轴对齐）
Given 已装配的 `Trajectory`
When 渲染 `TrajectoryView`（`frontend/src/components/daemon/trajectory/trajectory-view.tsx`）
Then 必须只做展示（无 fetch / 无 store / 无 context，数据由 props 注入）；必须是三段结构：泳道时间轴（输入 / 模型 / 工具三泳道共享同一绝对时间轴，D-024）+ 账本 `role="grid"`（降为「调用」档）+ 右侧 320px 检查器；时间轴必须支持滚轮缩放（锚点稳定）/ 拖拽平移（两端钳制）/ 双击与按钮重置 / 总览刷子，且时间轴右缘必须与账本盒右缘对齐（Δ≤2px，实测 0.00px；改前时间轴横跨整页，右缘偏离账本 308px）；模型条必须标注为近似（整段非工具空档，无 TTFT 采样），并显示 `模型 x% · 工具 y% · 空档 z%`，禁止把覆盖率读成真实模型活动；必须作为**第三个**能力入口存在，禁止替换现有「进度」视图（`SessionViewMode` 二态不动）；行级必须 `content-visibility: auto`，禁止引入虚拟化库。

测试绑定：`frontend/src/components/daemon/trajectory/__tests__/trajectory-timeline.test.tsx`（7 例：三泳道渲染 / 共享轴比例 / 选中回调 / 视野刻度）+ `zoom.test.ts`（18 例：缩放锚点、平移钳制、命中带裁决、刻度文案）；纯展示组件无状态机可断言，替代证据 = `GET /proto/session-trajectory` 200 且首屏 SSR 含 `role="grid"` 1 + 实测轴/账本右缘均为 1280px（1600×1000，Δ=0.00）。

### FR-12: 轨迹数据面由 SSR 读盘注入，禁止回到 public/
覆盖决策：D-010@v1、D-022@v1、D-018@v1
Given dev server 在跑
When `GET /proto/session-trajectory`
Then 必须返回 200，且首屏 SSR HTML 必须已含完整账本（不依赖浏览器 JS 才出现）；真实导出必须由 Server Component 从 `frontend/.proto-staging/session-export.json` 读盘注入（`frontend/src/app/proto/session-trajectory/page.tsx:24` `dynamic = "force-dynamic"`）；真实会话数据禁止放进 `public/`（该目录是免鉴权静态服务面）；文件缺失时必须显示占位提示，禁止白屏。

测试绑定：不适用：路由/SSR 集成面无单测；证据 = 实测状态码与计数（200 / 20 turn rows / 856 ledger rows）+ `git check-ignore -v frontend/.proto-staging/session-export.json` 命中 `frontend/.gitignore:11`。

### FR-13: 文件变更卡 1b——daemon 每轮工作区快照
覆盖决策：D-023@v1（①粒度、③采集口径）
Given daemon 侧一轮开始与结束
When 轮首与轮尾
Then 轮首必须记录 HEAD 作为 baseline；轮尾必须执行 `git status --porcelain -z --untracked-files=normal` + `git diff --numstat <baseline>`；ignored 目录必须只按本轮工具调用的路径前缀做 mtime 探测；逐文件 +/− 必须以 git 快照为准，`edit_patch` 只允许用于归因；必须同时产出 **turn 级**卡片数据与**会话级**汇总；禁止把 `edit_patch` 当作改动来源（它只覆盖 Edit/Write：真实导出 1271 条日志中 91 条带 patch，bash 178 条与 sillyspec 30 条无 patch）。

测试绑定：不适用：实现未开始（落点与验收见 `tasks.md` task-13；会话级汇总在 task-17）；判据来源 = `decisions.md` D-023@v1 记录的真实导出实测口径（`edit_patch` 91/1271、`runs[].diff_summary` 0/21）。

### FR-14: 文件变更卡归因与老版本降级
覆盖决策：D-023@v1（②归因、④降级）
Given 一轮结束且快照显示有文件改动
When 前端渲染该轮的变更卡
Then 每个文件必须标注归因：有 `edit_patch` 的指向具体编辑（点开看哪次编辑）；有改动但无 patch 的必须标「命令行/脚本改动」；daemon 版本过老（无快照字段）时必须降级为「仅工具编辑」并显式提示，禁止静默显示成「无改动」。

测试绑定：不适用：实现未开始（`tasks.md` task-18 / task-19）；判据来源 = D-023@v1 ②④。

### FR-15: 文件变更卡的性能红线与降级
覆盖决策：D-023@v1（③性能红线）
Given 一轮结束时的采集
When 在高轮次会话（21 轮 / 1271 条日志为基线语料）上重复执行
Then 每轮 git 子进程必须 ≤ 3 条；复杂度必须 O(改动数 + 工具调用数)；必须禁 rename 检测、必须带 `core.preloadIndex` 与 `--no-optional-locks`；必须设 1500ms 硬超时并降级为 partial（禁止阻塞轮结束）；单工作区必须走串行队列；漂移观测必须报警：p50 > 300ms 或降级率 > 5%。

测试绑定：不适用：实现未开始，且性能红线无现成测试面；验收方式 = `tasks.md` task-20 的计时夹具 + 遥测字段（p50 / 降级率 / 子进程数）。

### FR-16: 并行会话隔离＝显式标注，不引入每会话 worktree
覆盖决策：D-023@v1（隔离段）
Given 一个共享工作区被多个会话同时使用
When turn 级卡片列出改动文件
Then 卡片必须注明「可能含并行会话改动」；本变更禁止为此强制引入每会话独立 worktree（留作后续根治项）；ignored 目录的探测结果必须标明来源是 mtime 探测而非 git 差异。

测试绑定：不适用：实现未开始（`tasks.md` task-17 验收项之一）；判据来源 = D-023@v1 隔离段。

### FR-17: 定稿原型必须由真实组件 + 水合后 DOM 产出
覆盖决策：D-010@v1、D-017@v1、D-014@v1、D-011@v1（否决静态复刻，作反向约束）
Given 需要给用户看「可双击的真实稿」
When 产出定稿原型
Then 定稿原型必须由 `/proto/*` dev 路由渲染真实生产组件产生，再对**水合后 DOM** 序列化导出（内联 CSS、剥 `<script>` / `<link>`）；禁止手绘 HTML 作为定稿或验收基线；禁止抓 SSR HTML 当静态稿（实测 SSR 稿含 138 个 CSR `<template>` 占位、真实 `.wmde-markdown` 为 0）。

测试绑定：不适用：形态约束无断言面；证据 = 导出件计数（正文块 138 / `turn-meta-detail` 20 / `<template>` 0 / `<script data-export-shim="vanilla">` 1 / `<link>` 0 / `<style>` 1；该稿为 `--with-js` 产出）与 D-018@v1 的对照实测。

### FR-18: 导出脚本自带机械校验，不达标不产出
覆盖决策：D-018@v1
Given 运行 `frontend/scripts/export-hydrated.mjs`
When 水合未达标或产物不合格
Then 脚本必须以非 0 退出且**不落盘**（`export-hydrated.mjs:953-957`：`problems` 非空即 `fail()`，落盘 `writeFile` 在其后；顶层 catch `:1170-1175` 收尾 `process.exit(1)`）；校验必须覆盖：`.wmde-markdown` 元素 ≥ 50、`turn-meta-detail` ≥ 15、`</title>` / `</style>` / `</head>` / `<body>` / `</body>` 各恰好 1、无含 markdown 的 `<template>`、`<script>` 计数按模式断言（纯静态模式 **0** 段；`--with-js` 模式 **恰好 1** 段且必须带 `data-export-shim`——期望值见 `:864-870` 的 `expectedScriptCount`，不符即由 `:934-938` 报错）、无 `<link>`、`turn-block` 不带线且都带 `pb-7`（校验块 `:909-951`）。**本变更留档的两稿（`prototype-session-final.html` / `prototype-session-trajectory.html`）均为 `--with-js` 产出，实测各含 1 段 `<script data-export-shim="vanilla">`；「`<script>` 0」只对纯静态模式成立，不得套到这两稿上。 `--with-js` 产物的「可交互」由 **vanilla shim 段**（`:178-277` 的 `SHIM_SCRIPT`：卡头开合 / 文件行点击写日志 / 主题按钮 / 100 文件显隐）承担，该段**不是** React 水合，不得作为功能完整性证据。

测试绑定：不适用：脚本自带的机械校验即验收面（`frontend/scripts/export-hydrated.mjs:915-951` 的 `problems` 断言块 + `:953-957` 先失败后落盘 + `:1170-1175` 退出码 1）；其中 `<script>` 计数按模式断言（`:864-870` 期望值：`--with-react` = 脚本块数 / `--with-js` = 1 / 纯静态 = 0；`:934-938` 不符即失败）；`--with-js` 的 vanilla shim 段（`:178-277` 的 `SHIM_SCRIPT`）无断言面，靠 `--verify` 的 file:// 实跑（`:1000-1007`）兜住

### FR-19: `/proto/*` 与真实数据面的 dev-only 边界
覆盖决策：D-010@v1、D-018@v1、D-014@v1
Given `/proto/*` 路由与 `frontend/.proto-staging/`
When 生产构建、导航与鉴权
Then 这些路由必须 dev-only：禁止进导航、禁止被生产页面引用（实测 `frontend/src` 下非 `proto` 文件零引用）、且不在 middleware matcher 内（`frontend/src/middleware.ts:97` 只匹配 `/ppm/:path*`、`/workspaces/:path*`、`/login`、`/account/:path*`）；真实会话数据禁止留在 `public/`；静态稿与 dev 路由必须同源——改源码后必须重跑导出，禁止手改产物 HTML。

测试绑定：不适用：目录/配置边界无断言面；证据 = middleware matcher 实测 + 生产引用零命中 grep + `frontend/.gitignore:11`（`/.proto-staging/`）。

### FR-20: 折叠只作候选能力，禁止接线成默认行为
覆盖决策：D-012@v1、D-004@v1、D-009@v1
Given `frontend/src/components/daemon/turn-fold.ts` 与 `TurnTimeline.detailLevel`
When 调用方未传 `detailLevel`
Then 必须与现行为等价（零渲染变化）；只有传入非 `detailed` 档且轮状态为 `completed` 时才可折；运行中 / 失败 / 被打断的轮禁止折叠；本变更禁止把折叠接线成任何页面的默认行为（实测当前无任何调用方传 `detailLevel`，仅 `turn-timeline.tsx` 内部 `detailLevel={detailLevel}` 透传，`:1737`）。

测试绑定：`frontend/src/components/daemon/__tests__/turn-fold.test.ts`（22 例：`isTurnFoldable` 仅 completed 可折 / 未知状态保守不可折、`processStepCount` 段与回退口径、`formatFoldDuration` 三档与不伪造、`foldHeaderText` 档位只改信息量、`textOnlySegments` 只留正文）；接线面不适用：无任何页面传 `detailLevel`，无页面级行为可断言。

### FR-21: 技术栈边界——禁止客户端插件化架构
覆盖决策：D-001@v1
Given 本仓客户端技术栈（Next.js 14 + React 18 + TanStack Query + antd）
When 引入任何新依赖或新装配机制
Then 禁止引入 Cordis、slot 注册表或客户端插件加载机制；对 DSH 的借鉴必须限于交互模型、数据投影口径与视觉细节；本变更禁止改动 `frontend/package.json` 的依赖面。

测试绑定：不适用：架构边界无代码可测；证据 = `frontend/package.json` 未被本变更修改（`git status` 无该文件）、依赖面零新增。

### FR-22: 性能线出界，禁止顺手优化
覆盖决策：D-006@v1、D-007@v1
Given 本变更已改动默认渲染形态（去 hairline、字阶、间距、折叠候选）
When 评估首屏 / 翻页 / 滚动 / 流式四项性能
Then 本变更禁止把性能优化纳入交付（四项症状归性能变更承接）；若某项改动显著改变性能画像，必须由性能变更复测基线，禁止在本变更内顺手优化；本变更禁止改动会话取数与分页代码（实测 `git status` 无 `frontend/src/components/daemon/session-panel` 改动）。

测试绑定：不适用：范围约束无断言面；证据 = `git status` 无 `session-panel` 目录改动 + 208 例 / 9 文件相关回归全绿（明细见 `design.md` 自审第 8 条）。

### FR-23: 会话 × 模型用量明细只读端点（工作树已落盘的范围内交付）
覆盖决策：无对应 D 条目——该端点随工作树落盘、经独立评审 P1-b 判定「文档零声明＝三方对齐失败」后补登记为范围内交付；端点只读、复用既有鉴权闸门，不产生新决策面（登记理由见文末「剩余风险」）
Given 一个属于当前用户的会话（`session_id`）
When `GET /api/daemon/sessions/{session_id}/model-usage`
Then 必须返回 `{ session_id, items[], truncated }`，`items[]` 逐条直映 `agent_run_model_usage` 的真实列（`run_id` / `model` / `input_tokens` / `output_tokens` / `cache_read_tokens` / `cache_creation_tokens`）加所属 `AgentRun` 的 `started_at` / `finished_at`（缺失如实为 `null`，禁止编造 duration）；禁止输出日志正文、`system_prompt` 或 `agent_profile_snapshot`；排序必须轮次序优先（`agent_runs.created_at asc, id asc`）、轮内 `started_at` 兜底、`model` 作最终 tiebreaker；归属闸门必须复用 `get_agent_session`（不存在 / 跨用户 / 软删一律 404，不泄露存在性）；硬上限 `_SESSION_MODEL_USAGE_MAX=2000` 行，溢出裁剪并置 `truncated=true`（不分页）；该端点必须同步进 `backend/openapi.json` 与两侧生成物（`frontend/src/lib/api-types.ts`、`sillyhub-daemon/src/api-types.ts`），且不改变任何既有端点的响应形状。

测试绑定：`backend/app/modules/daemon/tests/test_session_model_usage.py::TestSessionModelUsage`（`:119`，4 例）——`test_rows_two_runs_two_models_ordered_by_run_then_started_at`（2 run × 2 model：明细行直映真实列（含 cache 两维），按轮次序升序）、`test_404_cross_user_and_unknown_session`（他人会话 / 不存在的会话 → 同 404，resource-hiding 不泄露存在性）、`test_empty_session_and_run_without_usage_rows`（空会话与「有 run 但无明细行」均返回 200 + 空 `items`）、`test_truncated_flag_when_over_hard_cap`（明细行超硬上限：裁剪到上限并置 `truncated=true`）。

## 非功能需求

- **兼容性**：必须跨 Windows / Linux / macOS——导出脚本与 proto 取数一律用 `node:path`（`frontend/src/app/proto/session-redesign/staged-session-export.ts:38`）与 node API，禁止 shell 专用命令；换行差异不得影响断言。
- **可回退**：`detailLevel` 不传即零影响（FR-20）；`/proto/*` 与 `frontend/.proto-staging/` 必须可整块删除而不影响生产（FR-19）；导出产物必须可重跑覆盖，禁止手改（FR-18）。
- **可测试**：业务逻辑必须先落纯函数（`build-trajectory.ts` / `turn-fold.ts`），UI 只渲染（D-022）；视觉参数必须由单测锁死，防止静默回流（FR-02 / FR-03 / FR-06）。
- **安全**：真实会话数据禁止进入 `public/`（免鉴权静态面）与 JS bundle；`session-export.json` 实测 3,370,986 字节只经 RSC 载荷进首屏。
- **性能**：1b 的每轮采集开销见 FR-15；本变更其余部分 SHOULD 不引入额外请求（轨迹只消费已取到的 logs/runs）。

## 决策覆盖矩阵（如存在 decisions.md）

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-21 | 技术栈边界＝不移植 Cordis/slot，只借交互模型与数据口径 |
| D-002@v1 | FR-01, FR-02, FR-03, FR-08 | 三个痛点（正文可直达 / 细节层级 / 视觉 craft）落到视觉六条；审批与时间概览未选，见 proposal「不在范围内」 |
| D-003@v1 | FR-01, FR-02, FR-08, FR-09 | 三类场景（主力工作台 / 演示 / DSH 对标）决定密度与留白的取舍口径 |
| D-004@v1 | FR-20 | 「视图模型先出原型再定」→ 折叠只作候选能力，不改 `SessionViewMode` |
| D-005@v1 | FR-17 | 原型单页双形态对比的要求已被 D-009/D-010 升级为 dev 路由，形态约束合并进 FR-17 |
| D-006@v1 | FR-22 | 性能另立变更，本变更不承接 |
| D-007@v1 | FR-22 | 四项性能症状属性能变更输入，明确出界 |
| D-008@v1 | FR-01, FR-02, FR-06 | 成功标准随原型确认轮定稿 → 定稿结果为 proposal SC-01…SC-09 |
| D-009@v1 | FR-17, FR-20 | 方案定稿推迟到原型确认轮；折叠方向由用户在看过真实组件后否决（见 D-012） |
| D-010@v1 | FR-12, FR-17, FR-19 | 原型形态＝dev 预览路由渲染真实组件；dev-only 边界 |
| D-012@v1 | FR-20 | 整轮折叠方向被否决，主线改为视觉层重做 |
| D-013@v1 | FR-02, FR-03, FR-09 | v2 三层判据（正文权重 / 过程降噪 / 轮间节奏）+ 只用 token |
| D-014@v1 | FR-17, FR-18, FR-19 | 静态交付＝SSR 快照 + 内联 CSS（并被 D-018 升级为水合后 DOM） |
| D-015@v1 | FR-09 | 已被 D-015@v2 取代（深色基线作废）；保留引用以免旧结论被当依据 |
| D-015@v2 | FR-09 | 基线＝真实页面结构，三主题并存，颜色一律语义 token |
| D-016@v1 | FR-01, FR-02, FR-03, FR-04, FR-06, FR-07, FR-08 | 截图可指认的五处层次问题与逐条改法 |
| D-017@v1 | FR-17 | 定稿原型必须由真实组件产出，手绘 HTML 只作参考 |
| D-018@v1 | FR-12, FR-18, FR-19 | 静态导出必须水合后序列化 DOM，自带正文块断言 |
| D-019@v1 | FR-17, FR-18 | 三次否定结论基于缺正文的残缺稿；修复稿必须可机械核验 |
| D-020@v1 | FR-06 | 删除轮间 1px hairline，只保留留白 |
| D-021@v1 | FR-01, FR-02, FR-03, FR-04, FR-05 | 对比加强的四组参数即验收基线 |
| D-022@v1 | FR-10, FR-11, FR-12 | 轨迹档 1（事件账本 + inspector + 时间轴跨度），不做 TTFT/decode、不做区间缩放 |
| D-023@v1 | FR-13, FR-14, FR-15, FR-16 | 文件变更卡走 1b（daemon 每轮快照），含性能红线、归因与老版本降级 |
| D-024@v1 | FR-10, FR-11 | 轨迹主视图＝三泳道共享绝对时间轴；账本降为「调用」档；模型条＝思考/答复空档近似（必须在 UI 标注近似） |
| D-025@v1 | FR-03 | 过程行固定语义标签词表（思考 / 运行命令 / 读写文件 / 搜索 / 回复 / 失败 / 其它）；纯展示映射，工具名原样保留，词表外工具回退「其它」不丢行；错误状态优先判「失败」 |
| D-026@v1 | FR-10, FR-11 | 轨迹档 1 扩入缩放 / 平移 / 窗口 / 刷子 / 6px 命中带；时间轴右缘与账本盒右缘对齐 Δ≤2px；模型口径＝整段非工具空档（含思考/答复）并显示覆盖率；D-022「不做区间聚焦与滚轮缩放」子句作废 |

## 剩余风险（决策未覆盖项）

- D-011@v1（状态 `rejected`）不产生需求条目，其否决结论已作为反向约束并入 FR-17；该决策不需要 FR 归属。
- **FR-23（会话 × 模型用量明细端点）无对应 D 条目**：它是工作树已落盘的只读端点，独立评审 P1-b 判定「文档零声明即三方对齐失败」，故在本变更补登记为范围内交付；补登记不新增决策面（无需用户裁决）。若后续要改其口径（改成分页 / 改聚合 / 增列），必须另立决策条目再动。

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）
> 2026-10-21 按独立评审 P1-a 从正文内联 `测试绑定：` 行回填；FR-13…FR-16（1b）实现未开始，按「不适用：理由」写并给出待新建测试落点。

FR-01: `frontend/src/components/daemon/__tests__/turn-time-display.test.tsx`「完成轮双锚点：轮号/状态/结束/历时 全在同一条元信息行内（对话视图；悬浮对话共用内核）」与「进度视图（all）同样只有一条元信息行：状态徽章 + 右对齐时间细节」
FR-02: `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`「正文/过程字阶分离（2026-10-20 / 2026-10-21 对比加强）：正文 15px / 1.8 / 段距 0.65em 由 globals.css 的 .seg-text-body 元素级规则承担」（含 `expect(css).not.toContain("font-size: 14.5px !important")`）
FR-03: `frontend/src/components/daemon/__tests__/process-labels.test.ts`（18 例：七类标签 / 词表外工具回退「其它」/ 空工具名 / error·deny·failed 压过类别 / 大小写不敏感 / mcp 前缀末段匹配）+ `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`「D-025 语义标签：Bash 行渲染「运行命令」，Read 行渲染「读写文件」，工具名仍原样显示」「D-025：工具行标签后必须用「·」连接摘要（icon + 中文标签 + · + 一行摘要）」「过程行退档（2026-10-21 对比加强）」两例
FR-04: `frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`「去外框形态（2026-10-20 / D-016③）：无满宽描边与卡底，改 2px 左规线 + hover 转 brand，行尾动作默认 45% 透明」（其中断言 `border-border/60`）
FR-05: `frontend/src/components/daemon/__tests__/turn-time-display.test.tsx`「助手列分区：过程行间距 gap-[7px]，答复块额外上留 7px（两区实际间隔 14px）」
FR-06: `frontend/src/components/daemon/__tests__/turn-time-display.test.tsx`「轮间只有留白：turn-block 无 border-b（含 last:border-b-0 已移除），保留 pb-7 的 28px」与「globals.css 无残留轮间画线规则（轮间分节只由组件留白承担）」；导出侧机械核验 `frontend/scripts/export-hydrated.mjs:909-950`（带线 > 0 或缺 `pb-7` > 0 即失败），实测 `prototype-session-final.html` 20/20 合规
FR-07: `frontend/src/components/daemon/__tests__/attachment-chips.test.tsx`（3 例：chips 渲染 / 预览弹窗 / 拉取失败降级零回归）；用户气泡与 chip 底色部分不适用：纯 token 类名组合、无 DOM 语义可断言，验收靠 dev 路由目视（`tasks.md` task-05 的 `proto-final-2026-10-21.png`）
FR-08: 不适用：`h-[14px]` / `text-[9px]` / `ml-auto` / 9.5px 均为纯 Tailwind 类，jsdom 不做级联样式求值；回归面 = `frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`（119 例全绿，保证行结构 / 多选 / 导出 / 筛选零改变）
FR-09: 不适用：主题 token 是 CSS 自定义属性，jsdom 无法求值，三主题对比度无自动量测；替代证据 = `turn-segment-views.test.tsx`「旧值 14.5px 不回流」断言 + dev 路由三主题目视（`tasks.md` task-08 / task-22）
FR-10: `frontend/src/components/daemon/trajectory/__tests__/build-trajectory.test.ts`（31 例，`≥12` 为下限；2026-10-21 13:58 本轮实跑 31/31 绿）
FR-11: `frontend/src/components/daemon/trajectory/__tests__/trajectory-timeline.test.tsx`（7 例：三泳道渲染 / 共享轴比例 / 选中回调 / 视野刻度）+ `frontend/src/components/daemon/trajectory/__tests__/zoom.test.ts`（18 例：缩放锚点、平移钳制、命中带裁决、刻度文案）；纯展示组件无状态机可断言，替代证据 = `GET /proto/session-trajectory` 200 且首屏 SSR 含 `role="grid"` 1 + 实测轴/账本右缘均为 1280px（1600×1000，Δ=0.00）
FR-12: 不适用：路由/SSR 集成面无单测；证据 = 实测状态码与计数（200 / 20 turn rows / 856 ledger rows）+ `git check-ignore -v frontend/.proto-staging/session-export.json` 命中 `frontend/.gitignore:11`
FR-13: 不适用（实现未开始）：采集落点 `NEW:sillyhub-daemon/src/interactive/turn-file-changes.ts`，测试面待新建 `sillyhub-daemon/tests/interactive/turn-file-changes.test.ts`（六类夹具）；见 design「线 C / 1b 落点」与 `tasks.md` task-13；判据来源 D-023@v1（`edit_patch` 91/1271、`runs[].diff_summary` 0/21）
FR-14: 不适用（实现未开始）：归因/降级的前端映射落点 `NEW:frontend/src/components/daemon/file-changes/turn-file-changes.ts`，测试面待新建 `frontend/src/components/daemon/file-changes/__tests__/turn-file-changes.test.ts`；见 `tasks.md` task-16 / task-18；判据来源 D-023@v1 ②④
FR-15: 不适用（实现未开始，且性能红线无现成测试面）：验收方式 = `tasks.md` task-14 的计时夹具 + 遥测字段（p50 / 降级率 / 子进程数）；daemon 测试面待新建 `sillyhub-daemon/tests/interactive/turn-file-changes.test.ts` 的超时 `partial` 与串行队列分支
FR-16: 不适用（实现未开始）：会话级汇总卡落点 `NEW:frontend/src/components/daemon/file-changes/file-changes-summary.tsx`，测试面待新建 `frontend/src/components/daemon/file-changes/__tests__/file-changes-summary.test.tsx`；见 `tasks.md` task-17；判据来源 D-023@v1 隔离段
FR-17: 不适用：形态约束无断言面；证据 = 导出件计数（正文块 138 / `turn-meta-detail` 20 / `<template>` 0 / `<script data-export-shim="vanilla">` 1 / `<link>` 0 / `<style>` 1；`--with-js` 产出）与 D-018@v1 的对照实测
FR-18: 不适用：脚本自带的机械校验即验收面（`frontend/scripts/export-hydrated.mjs:915-951` 的 `problems` 断言块 + `:953-957` 先失败后落盘 + `:1170-1175` 退出码 1）
FR-19: 不适用：目录/配置边界无断言面；证据 = middleware matcher 实测 + 生产引用零命中 grep + `frontend/.gitignore:11`（`/.proto-staging/`）
FR-20: `frontend/src/components/daemon/__tests__/turn-fold.test.ts`（22 例：`isTurnFoldable` 仅 completed 可折 / 未知状态保守不可折、`processStepCount` 段与回退口径、`formatFoldDuration` 三档与不伪造、`foldHeaderText` 档位只改信息量、`textOnlySegments` 只留正文）；接线面不适用：无任何页面传 `detailLevel`
FR-21: 不适用：架构边界无代码可测；证据 = `frontend/package.json` 未被本变更修改（`git status` 无该文件）、依赖面零新增
FR-22: 不适用：范围约束无断言面；证据 = `git status` 无 `frontend/src/components/daemon/session-panel/` 改动 + 208 例 / 9 文件相关回归全绿（明细见 `design.md` 自审第 8 条）
FR-23: `backend/app/modules/daemon/tests/test_session_model_usage.py::TestSessionModelUsage` 的 4 个测试函数逐字命名：`test_rows_two_runs_two_models_ordered_by_run_then_started_at`（2 run × 2 model：明细行直映真实列（含 cache 两维），按轮次序升序）、`test_404_cross_user_and_unknown_session`（他人会话 / 不存在的会话 → 同 404，resource-hiding）、`test_empty_session_and_run_without_usage_rows`（空会话与「有 run 但无明细行」均返回 200 + 空 items）、`test_truncated_flag_when_over_hard_cap`（明细行超硬上限：裁剪到上限并置 truncated=true）（4 例；本轮未复跑，execute 前由本变更补跑）
