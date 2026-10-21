---
author: qinyi
created_at: 2026-10-20 15:24:52
generated_by: sillyspec-fourpiece-init
change: 2026-10-20-session-page-dsh-alignment
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 参考粒度＝交互模型与数据口径，不移植 DSH 插件化客户端架构
- type: architecture
- priority: P0
- status: accepted
- source: docs
- question: 本变更「参考 deepseek-harness 的会话页效果」，参考粒度到哪一层——只抄交互与口径，还是连它的 Cordis + Slots 插件化客户端架构一起移植？
- answer: 沿用既有裁决，不重新论证（我的判断：继承）。2026-08-19-session-stream-ux 在 A 渐进增强 / B 全量移植 deepseek-harness 架构 / C 共享装配器 三条路线中选定 C——「参考 deepseek-harness 设计思想但不移植其插件化架构」。本仓客户端是 Next.js 14 + React 18 + TanStack Query + antd 的单一应用；DSH 客户端是 Cordis 插件图 + 58 个 `packages/client/*` 包 + slot 注册表。移植成本与回归面远超收益，且本仓已用「单一装配器 + 段模型」达到同一目标（事件 → 结构化轮次模型 → 对话/进度多视图消费）。
- normalized_requirement: 本变更只在既有 Next.js/React/TanStack Query/antd 技术栈内改造；不得引入 Cordis、slot 注册表或客户端插件加载机制；对 DSH 的借鉴限于交互模型、数据投影口径与视觉细节。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: .sillyspec/changes/archive/2026-08-19-session-stream-ux/decisions.md:23-24；.sillyspec/changes/archive/2026-08-19-session-stream-ux/design.md:23
- 故障面: 若后续出现「按工具/按视图独立演化」的强需求，集中式渲染（frontend/src/components/agent-log/tool-renderers.tsx，731 行 switch）会先成为瓶颈——届时按需抽轻量注册表，而不是回退到插件化架构。
- 退役判据: 出现 ≥3 个需要独立加载、独立版本的客户端扩展方（第三方插件生态）时重议本边界。

## D-002@v1: 本次锚定三个痛点——过程呈现模型 / 长会话打开与翻页性能 / 视觉 craft
- type: scope
- priority: P0
- status: confirmed
- source: user
- question: 「参考 DSH 的会话页效果」落到使用现场，具体要解决哪些痛点？
- answer: 用户多选四项具体场景（原话摘要）：①过程太长，找不到答复正文；②细节层级固定、不能按需收放；③长会话打开与翻页仍慢；④纯观感差距（视觉/排版/动效）。用户**未选**两项候选：工具审批在会话页看不到、看不出耗时/速度/时间分布——按未选处理（不排除后续改口，届时另立新版本条目）。
- normalized_requirement: 本次范围必须覆盖 ①答复正文可直达（过程不得挤占正文可读性）②过程细节层级可按需收放 ③长会话打开与翻页性能 ④视觉 craft；不得以「会话页工具审批可见性」或「交互式时间概览」作为本次交付目标（未选；且前者落在权限/状态链路，与在途变更 2026-10-20-session-status-live-sync 领域相邻）。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: 用户本轮 AskUserQuestion 多选回答（2026-10-20 15:44 采样）；DSH 对照结论见本文件 D-001
- 故障面: 三个痛点跨三条技术线（轮次呈现模型 / 数据传输与渲染性能 / 视觉 token 与排版），挤在一个变更里做会让回归面覆盖成本显著上升，且 2026-09-27-session-fast-replay 已在性能线上做过一轮——性能项若未收敛需先定位残余瓶颈，不能重复上一轮的处置。
- 退役判据: 若范围步骤确认三条线无法在一个变更内安全交付，按「呈现模型优先、性能与观感随批」拆分，本条目降级为范围输入。

## D-003@v1: 动机＝日常主力工作台 + 对外演示可用 + 与 DSH 直接对标（非「会话规模爆炸」驱动）
- type: definition
- priority: P1
- status: confirmed
- source: user
- question: 为什么是现在做？不做会怎样？
- answer: 用户多选三项动机：①与手边在用的 DSH 直接对比，差距刺眼；②想把它当主力工作台，日常别扭感累积到临界；③要给别人用/演示，观感与可读性要能打。**未选**「会话规模变了（几十轮 + 子代理/团队会话撑不住）」——即本次不是为极端长会话/多并发现场做容量设计。
- normalized_requirement: 方案取舍须服务三类场景：日常高频使用（键盘与密度、零多余点击、首屏即可读）、对外演示（一次开的观感/排版/动效必须站得住，不能靠"再多点两下就对了"）、DSH 对标（凡差距来自交互模型而非数据能力，以对齐 DSH 形态为首选）。不得以"为未来更多子代理/团队会话预留结构"为理由扩大范围（该动机未被选中）。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: 用户本轮 AskUserQuestion 多选回答（2026-10-20 15:55 采样）；未选项与 D-002 的未选项并列，构成「本次不做」清单
- 故障面: 「主力工作台」与「演示可用」对同一处有相反要求——前者要高密度、后者要留白与呼吸感；若不分场景一刀切排版，会牺牲其中一侧。
- 退役判据: 若后续出现真实的规模压力证据（单会话轮次/日志量级或并发会话数成为瓶颈实测），重新评估容量线是否入范围。

## D-004@v1: 视图模型不在对话里拍板——先出 HTML 原型看效果再定（用户选 C）
- type: process
- priority: P0
- status: confirmed
- source: user
- question: 是否允许把现有「对话 / 进度」二选一视图模型改成单视图可伸缩（整轮折叠 → 过程分组 → 单条展开）？
- answer: 用户选 C——先出 HTML 原型看效果再定视图模型；本轮**不**承诺 A（允许重构）也不承诺 B（保守增强）。
- normalized_requirement: 原型经用户确认前，不得改动 frontend/src/components/daemon/turn-timeline.tsx 的视图模型（SessionViewMode 二态）；原型必须同时呈现 A（单视图可伸缩）与 B（两视图保留 + 细节档位）两形态以支持对比；原型落盘到本变更目录。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: 用户本轮 AskUserQuestion 单选回答（2026-10-20 15:58 采样）；落点为 brainstorm Step 5「分段展示设计（含原型）」
- 故障面: 原型先行把"设计定稿"推迟到原型确认之后；若原型用理想化假数据（无超长轮/大 diff/失败轮），确认结论会落空——原型语料必须覆盖真实形态。
- 退役判据: 用户看过原型并明确选定形态后，本条目由对应的视图模型决策条目取代。

## D-005@v1: 原型出「A/B 双形态对比」单页（我的判断）
- type: process
- priority: P2
- status: accepted
- source: docs
- question: 原型页做几个形态、怎么组织？
- answer: 我的判断：一份单文件 HTML，可切换地并排呈现 A（单视图可伸缩：整轮折叠 → 过程分组 → 单条 disclosure）与 B（两视图保留 + 细节档位），共用同一份真实形态语料（超长轮、连续工具调用、失败轮、子代理轮），并把 D-003 登记的「高密度 vs 呼吸感」张力做成两套排版参数同页对比。依据：仓内既有 AI-Native 视觉方向与既有原型留档形态。
- normalized_requirement: 原型为单文件 HTML（内联 CSS/JS，浏览器直开）、风格与 token 对齐既有 AI-Native 视觉方向、落盘到 `.sillyspec/changes/2026-10-20-session-page-dsh-alignment/` 下、仅本地交互（不做成假应用）。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: docs/ui-redesign-ai-native-prototype-2026-08-20.html（第 05 节「智能体会话（AI 原生体验）」）；.sillyspec/docs/frontend/modules/components-daemon.md:261-265
- 故障面: 两形态同页使状态维度上升（形态 × 展开层 × 档位），需以静态语料 + 少量本地交互实现，避免体积与状态管理失控。
- 退役判据: 用户选定形态后原型仅作留档，不再迭代。

## D-006@v1: 交付边界＝本变更做「过程呈现 + 视觉 craft」，长会话性能另立变更
- type: scope
- priority: P0
- status: confirmed
- source: user
- question: 三条线（过程呈现 / 长会话性能 / 视觉 craft）本次一次做完，还是拆？
- answer: 用户选 B——呈现 + 观感一批（本变更），性能另立变更。理由（双方一致）：观感是呈现模型的副产品（间距/层次/动效随模型一起改，拆开是双份工）；性能是独立工程轴，且 2026-09-27-session-fast-replay 已动过一轮。
- normalized_requirement: 本变更范围＝会话页过程呈现模型与随之而来的视觉 craft；**不得**把长会话性能优化（首屏/翻页/滚动/流式期间流畅度）纳入本变更的交付目标，性能线另立变更承接（见 D-007）。若实现过程中发现某项改动会显著改变性能画像，须在性能变更里复测基线而非在本变更内顺手优化。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: 用户本轮 AskUserQuestion 单选回答（2026-10-20 16:12 采样）；D-002 三条线划分
- 故障面: 拆分后本变更改动的默认折叠策略会改变渲染与请求画像，性能变更若不同步复测基线，会拿旧基线误判。
- 退役判据: 性能变更落地并复测基线后，本条目仅作范围留档。

## D-007@v1: 性能痛点四项全中，另立变更的输入已登记
- type: scope
- priority: P1
- status: confirmed
- source: user
- question: ③「打开与翻页仍慢」具体卡在哪一步？
- answer: 用户四项全选：①打开会话首屏慢 ②触顶翻历史卡/空白墙/回弹 ③流式输出期间页面发涩 ④长会话滚动与跳转卡顿。（用户未提供样例会话 id，实测定位需在性能变更里补语料。）
- normalized_requirement: 性能变更的范围输入＝上述四项；不得只按 2026-09-27-session-fast-replay 的"首屏取数"口径处置（该轮只覆盖了分页单位/载荷/大纲投影，滚动与流式渲染侧未系统处理）。本变更（D-006）不承接该项。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: 用户本轮 AskUserQuestion 多选回答（2026-10-20 16:12 采样）；.sillyspec/changes/archive/2026-09-27-session-fast-replay/design.md:15-17
- 故障面: 四项症状可能同源（渲染成本）也可能异源（取数/序列化/重渲染），未实测前不得预设单根因。
- 退役判据: 性能变更完成基线实测并给出根因分解后，本条目由该变更的设计文档取代。

## D-008@v1: 成功标准延后到原型确认后定稿（草案 SC-01..SC-05 随原型呈现）
- type: process
- priority: P1
- status: confirmed
- source: user
- question: 成功标准草案（SC-01 正文直达 / SC-02 细节可收放 / SC-03 长会话可用 / SC-04 观感达标 / SC-05 零回归）是否按草案定稿？
- answer: 用户选「先看原型再定」——成功标准（尤其 SC-01/SC-02/SC-04 的尺度）在看过原型后一并定稿。
- normalized_requirement: 原型确认轮必须同时收口成功标准定稿；在 SC 定稿前，requirements.md 的成功标准章节保留草案并标注"待原型确认轮定稿"，不得当作已确认基线进入 tasks。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: 用户本轮 AskUserQuestion 单选回答（2026-10-20 16:12 采样）；SC-03 已随 D-006 出局（性能另立），定稿时按剩余 SC 收敛
- 故障面: 若原型轮只确认形态而漏确认 SC，后续 tasks 与 verify 探针会缺少判据锚点。
- 退役判据: SC 定稿写入 requirements.md 后本条目仅作过程留档。

## D-009@v1: 方案定稿推迟到原型确认轮；原型出 A/C 双形态（修订 D-005 的 A/B 组合）
- type: process
- priority: P0
- status: confirmed
- source: user
- question: Step 4 的方案倾向选哪个——A 单视图可伸缩 / B 保守增强只加档位 / C 合并 + 旧视图保底并存？
- answer: 用户选「先出双形态原型，看完再定」——本轮不承诺 A 或 C；原型按 **A/C 双形态**出（C ＝ A 的全部呈现 + 旧「进度」视图保留为可切回的入口），看完效果再定稿。Step 4 的三方案对比表与推荐（推荐 A）已被接受为讨论基础，但不构成选择。
- normalized_requirement: 原型必须同时呈现 A（单视图可伸缩、旧「进度」视图退役）与 C（同 A，但旧「进度」视图保留为可切回入口）两形态，且两者差异**只在"旧视图是否保留"一处**，其余呈现与观感完全一致，便于直接比较；方案定稿与成功标准定稿同在原型确认轮收口。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: 用户本轮 AskUserQuestion 单选回答（2026-10-20 16:13 采样）；本文件 D-004（原型先行）、D-005（双形态对比，本条目修订其 A/B 组合为 A/C）、D-008（SC 延后）
- 故障面: 若把 A/C 做成两页独立实现，对比成本上升且会掩盖真实差异（C 多出的只有回退入口）；须同页可切换、共用同一份语料与同一套排版参数。
- 退役判据: 方案定稿后本条目由对应的视图模型决策条目取代。

## D-010@v1: 原型形态升级为 dev 预览路由（直接渲染真实会话组件）
- type: process
- priority: P0
- status: confirmed
- source: user
- question: 用户质疑「这是真实代码转换的吗？我感觉还缺很多功能呢」——原型形态怎么走？
- answer: 用户选 ①「dev 预览路由」+ 改动边界「允许改生产链路」。已落地：新增 dev-only 路由 `frontend/src/app/proto/session-fold/page.tsx`，直接 `import` 真实 `TurnTimeline`，喂 fixture 轮次（`segments` 含 thinking / Grep / Read / Edit(structuredPatch) / Bash）。验证：`tsc --noEmit` 0 错；`next dev` 实测 `GET /proto/session-fold 200`，HTML 98KB 内命中真实组件标记（「思考过程」×2、`Grep` ×2、`turn-timeline.tsx` ×10）——即为真实组件树渲染，非复刻。
- normalized_requirement: 定稿原型一律走 dev 预览路由引用真实生产组件；静态 `prototype:build` 管线仅保留给不依赖浏览器运行时的页面类原型。本变更的 design.md 须登记该入口（PROTOTYPE.md 里「dev 预览路由」原为后续演进项，由此落地），并声明其 dev-only 边界：不进导航、不被生产页面引用、不受 middleware 守卫。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: frontend/src/app/proto/session-fold/page.tsx；.sillyspec/docs/SillyHub/scan/PROTOTYPE.md:30-31（完整交互原型走 dev 预览路由）
- 故障面: dev 路由需起 `next dev`（本机 spawn 受限，需完整权限跑），且因不受 middleware 守卫而存在未授权访问面——必须保持 dev-only 且不进导航，否则等于新开一个匿名入口。
- 退役判据: 折叠模型正式落到生产组件后，本路由降级为回归对照页或删除。

## D-011@v1 「继续用静态 prototype:build 复刻会话页」被否决
- type: feasibility
- priority: P1
- status: rejected
- source: user
- question: 是否继续用静态 `prototype:build` 管线复刻会话页并逐项补细节？
- answer: 否决（用户选择 dev 预览路由）。静态管线是 `tsc + react-dom/server`，无浏览器运行时，无法承载 `turn-timeline` 的 antd / zustand `useSession` / `thinking-translate` 依赖；复刻只能逼近观感，功能面永远补不完（用户实测判断「缺很多功能」）。
- normalized_requirement: 定稿原型不得使用静态复刻形态；静态产物最多用于离线观感稿或配图素材。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: frontend/scripts/prototype-build.mjs:40-61（tsc + react-dom/server 静态渲染）；frontend/src/components/daemon/turn-timeline.tsx 的 import 面（antd / @/stores/session / thinking-translate）
- 否决理由: 静态产物只能「像」，无法证明真实组件在折叠模型下的行为，且复刻成本无上限。
- 复潮条件: 需要完全无运行时的离线观感稿（对外文档配图）时可临时用静态管线生成素材，但不得作为定稿原型。

## D-012@v1: 「整轮折叠」方向被否决，主线改为视觉层重做
- type: scope
- priority: P0
- status: confirmed
- source: user
- question: 整轮折叠是否继续作为本期主线？
- answer: 否。用户在 dev 路由看过真实组件效果后反馈（原话）：「我没看出来有什么区别，而且效果都不行」，并明确勾选「折叠没用，方向错了」「观感差，要整体视觉重做」「信息密度/层次不对」。
- normalized_requirement: 本期主线改为**视觉层重做**（字号阶 / 行高 / 垂直节奏 / 层次与对比 / 信息密度），**不改 DOM 契约、不改数据链路、不改渲染分支**；整轮折叠不作为交付目标。已落盘的 `turn-fold.ts` 与 `TurnTimeline.detailLevel`（可选 prop，默认零影响）转为待裁决候选能力，设计定稿时必须显式写「采纳为可选能力」或「回退」，不得悬空。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: 用户 2026-10-20 20:43 反馈；frontend/src/components/daemon/turn-fold.ts（已存在但不再作主线）；frontend/src/app/proto/session-redesign/（新主线原型）
- 故障面: 「折叠没用」的根因判断若不成立（例如长会话确实是过程挤占正文），纯视觉重做会治标不治本——但该判断已由用户当面否决，按用户裁决执行，并把反例留在风险登记。
- 退役判据: 若后续实测长会话仍「找不到正文」，再重议是否需要结构性折叠（届时以真实长会话数据为依据，而不是 DSH 形态）。

## D-013@v1: v2 视觉重做的三层判据（正文权重 / 过程降噪 / 轮间节奏）
- type: definition
- priority: P1
- status: proposed
- source: docs
- question: 视觉重做具体改哪几层，判据是什么？
- answer: 我的判断（三层，均为可量化参数）：①**正文权重**——答复正文 13px→14.5px、行高 1.8、段距 0.55em，等宽元信息压到 10.5px；②**过程降噪**——工具/思考行去掉外框，只留左规线与等宽摘要，色退到 muted 阶；③**轮间节奏**——轮与轮用 1px hairline + 28px 留白分隔，替代每个块各画一圈边框；配套 rail 40px、composer 42px 的固定节奏。依据：现状 `globals.css:838-847` 正文字号偏小、过程行与正文同权重，导致「层次不清、密度错位」。
- normalized_requirement: v2 skin 必须只用 token（`hsl(var(--…))` / `--color-*`）与作用域选择器实现，零字面色、不污染生产样式；且必须能一键切回现状做对照（对照入口即 dev 路由）。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: frontend/src/app/proto/session-redesign/session-redesign.module.css；frontend/src/app/globals.css:838-847
- 故障面: 纯 CSS 作用域能改字号/行高/间距/颜色，但改不了 DOM 结构（例如工具卡外框若来自组件内联 class，需组件侧配合）——若实测发现某些"框"改不掉，说明需要组件级改动，届时要重新评估是否仍在"只改视觉层"的边界内。

## D-014@v1: 静态交付形态＝真实组件树的 SSR 快照 + 内联 CSS（交互仍走 dev 路由）
- type: process
- priority: P1
- status: confirmed
- source: user
- question: 用户问「不能转 HTML 吗？为什么非要启动渲染」——如何既给「可双击的真码」，又给「真实组件」？
- answer: 采用「dev server 的 SSR 输出 → 内联 CSS → 剥 &lt;script&gt;」导出：`export-proto.ps1` 抓 `/proto/session-redesign`（v2）与 `/proto/session-current`（现状）两份快照，产出 `prototype-session-v2.html` / `prototype-session-current.html`（各 ~295KB，零依赖双击可看）。它是**真实组件树的静态投影**，不是手绘复刻。
- normalized_requirement: 观感评审用静态 HTML（离线、零依赖、可传阅）；交互评审（v2/现状切换、视图切换）仍走 dev 路由；两者必须同源，改源码后须重跑导出脚本，禁止手改产物 HTML。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: .sillyspec/changes/2026-10-20-session-page-dsh-alignment/export-proto.ps1；frontend/src/app/proto/session-redesign/{view,page}.tsx 与 frontend/src/app/proto/session-current/page.tsx
- 故障面: 快照剥掉了 `<script>`（无 hydrate），任何依赖 JS 的交互或懒渲染内容不会出现——拿静态稿当"功能完整性"证据会误判；CSS 已内联但字体等 url() 资源离线可能缺失（回落系统字体）。
- 退役判据: 若 Next 侧启用 `output: 'export'` 能直接产出静态站，本脚本由官方导出替代。

## D-015@v1: 视觉基线＝用户提供的真实截图（深色高密度），此前浅色稿作废
- type: consistency
- priority: P0
- status: confirmed
- source: user
- question: 视觉重做以什么为基线？
- answer: 用户提供真实 `/sessions` 截图（2560×1440）。真实页面是**深色高密度**：近黑底、工具调用为满宽深色卡、轮头两行元信息、正文 13px、左栏两行会话行 + 引擎/档案/轮数 chip。此前基于 `themes.ts` 浅色 ai-native 皮肤做的 v2 稿与此完全不符，**作废**。
- normalized_requirement: 后续一切视觉结论以该截图基线为准，稿与实现都用深色主题；浅色 ai-native 不再作为会话页基线（其他页面不受影响）。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: 用户 2026-10-20 21:17 提供的 /sessions 截图；.sillyspec/changes/2026-10-20-session-page-dsh-alignment/prototype-session-v3.html（现状栏按该截图复刻）
- 故障面: 截图是单个会话、单主题、单分屏状态；其他状态（空态、失败态、移动端、浅色主题若仍支持）未覆盖，按图改可能在这些状态回归。
- 退役判据: 若平台确定只保留深色主题，则本条的"主题"部分转为规范常量。

## D-016@v1: 从截图可指认的五处层次问题与 v3 对应改法
- type: definition
- priority: P1
- status: proposed
- source: docs
- question: 真实页面上哪些具体位置导致「层次不清 / 观感不行」？
- answer: 五处（均可指到截图位置）：①**轮元信息重复**——顶部「开始 · 结束 · 耗时」+「第 N 轮 · 已完成 · tok · t/s」，底部又重复一遍；②**正文与过程同权重**——工具卡满宽带框、与答复正文同为深色卡、同为 13px 量级，主角不突出；③**框线成灾**——思考行/工具卡/气泡各画一圈边框，缺留白节奏；④**用户气泡最亮**——纯蓝大块成为整屏第一视觉焦点，抢走正文；⑤**左栏扫描困难**——引擎 chip / 档案 chip / 轮数同级同字号，状态点与右侧时间争位。
- normalized_requirement: v3 必须逐条对应：元信息合并为一行（轮号+状态+耗时+tok+t/s，右对齐、等宽、faint）；正文 14.5px/1.78 sans、过程 12px mono；工具卡去边框改 2px 左规线、动作按钮默认 45% 透明 hover 复原；用户气泡改深蓝(--blue 基底压暗)+细边；轮间 28px + 1px hairline；左栏 chip 统一 9px、轮数右贴。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: .sillyspec/changes/2026-10-20-session-page-dsh-alignment/prototype-session-v3.html（样式块「v3：只改这四层」段，含每条的可量化参数）
- 故障面: 五处里①②③属于"信息架构级"改动（DOM 结构要调整：把重复元信息删掉、正文与过程分层），纯 CSS 只能做出近似；真正落地时需组件级改动，届时可能超出"只改视觉层"的边界。

## D-015@v2: 视觉基线＝真实页面的**结构**（三主题并存，不把深色当基线）〔取代 D-015@v1〕
- type: consistency
- priority: P0
- status: confirmed
- source: user
- question: 视觉重做以什么为基线？主题怎么算？
- answer: 用户更正（原话）：「不是颜色问题 平台就是有三套主题，我给你de截图是深色而已」。故 @v1 的「浅色稿作废、以深色为基线」判断错误，本版取代：**基线是真实页面的结构与信息组织**（布局、信息项、行式、chip、轮头/轮尾、工具卡形态）；**主题是三个并存维度**（ai-native / blue / dark），三套都必须成立。
- normalized_requirement: 视觉稿与实现必须①结构按真实截图对齐；②颜色一律走语义 token（`--bg/--panel/--card/--line/--fg/--muted/--brand/--ok/--warn/--bad` 等），三主题各给一套取值；③稿内必须可切三主题验证，禁止只为深色写死色值；④不因主题差异改变布局与信息层级。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: 用户 2026-10-20 21:22 更正；.sillyspec/changes/2026-10-20-session-page-dsh-alignment/prototype-session-v3.html（`html[data-theme=ai-native|blue|dark]` 三套 token + `data-skin=now|v3` 两轴）
- 故障面: 三主题共用一套语义 token 时，某些混色（如 brand 边框 + card 底）在浅色主题下对比度不足——每套主题需各自校验对比度（正文与 muted 至少 4.5:1 / 3:1）。
- 退役判据: 平台若收敛到单主题，则本条的"三主题"要求降为单主题规范。

## D-017@v1: 视觉稿必须由真实组件产出（手绘 HTML 只作参考，不作定稿）
- type: process
- priority: P0
- status: confirmed
- source: user
- question: 视觉稿可以用手写 HTML 交付吗？
- answer: 不可以。用户指出（原话）：「这个是不是 直接改的 html 而不是 转换的？ 你这样直接改 html 后面代码实现会有偏差的呀」。该判断与仓规一致——`PROTOTYPE.md` 铁律：手绘定稿后每条意见都要反向翻译回真实代码。故 `prototype-session-v3.html` 降级为**视觉参考稿**，不定稿；定稿原型必须是对真实组件（Tailwind + token + 现有 `.sh-*` 类）改造后、由 dev 路由渲染、再由导出脚本固化的 HTML。
- normalized_requirement: 定稿原型＝真实组件渲染产物。每处视觉改动必须落在 `frontend/src/components/**` 的 React/Tailwind/token 代码里，且能被 `/proto/*` 路由复现；手绘 HTML 仅用于一次性方向讨论，禁止作为验收基线或后续"照图实现"的依据。
- impacts: [requirements FR（Step 8 生成规范文件后回填编号）]
- evidence: .sillyspec/docs/SillyHub/scan/PROTOTYPE.md:41（手绘单文件仅限一次性粗选对比，不得作为定稿原型）；用户 2026-10-20 21:26 反馈
- 故障面: 真实组件改动面大（`turn-timeline` / `turn-segment-views` / `globals.css` / `session-list-panel`），且会话页无 E2E——落地时须逐条配单测断言用户可见行为，否则"稿=实现"只能靠肉眼保证。

## D-018@v1: 静态原型导出必须「浏览器水合后序列化 DOM」，禁止抓 SSR HTML
- type: feasibility
- priority: P0
- status: confirmed
- source: code
- question: 静态稿如何保证包含真实正文？
- answer: 实测证明 SSR HTML 不可用：`prototype-session-fullpage.html` 含 **138 处 CSR bailout `<template>` 占位、0 个 `.wmde-markdown`**（助手答复正文全缺）。改为 `frontend/scripts/export-hydrated.mjs`：playwright 打开路由 → `networkidle` → `waitForFunction(.wmde-markdown ≥ 50, 120s)` → 逐片收集 `cssRules` → `outerHTML` → 剥 `<script>/<link>/原 style` → 合并单 `<style>` → 落盘，并机械校验各闭合标签恰好一次。
- normalized_requirement: 一切静态原型产物必须由水合后 DOM 导出；导出脚本自带「正文块数量」断言，不达标即失败退出，不得产出文件；禁止再以 SSR HTML 作为静态稿来源。
- evidence: frontend/scripts/export-hydrated.mjs；prototype-session-final.html（`.wmde-markdown` 138、`turn-meta-block`/`turn-meta-detail` 20、`<template>` 0、`<script>` 0）
- 故障面: 导出耗时上升（需起浏览器 + 等水合），且依赖 dev server 在跑。
- 退役判据: Next 启用 `output:'export'` 且能正确产出 CSR 子树时，可改用官方导出。

## D-019@v1: 此前三次「效果不咋地 / 看不出区别」的判定，基于缺正文的残缺稿，需在修复稿上重判
- type: process
- priority: P0
- status: confirmed
- source: code
- question: 用户此前的不满结论还成立吗？
- answer: 部分不成立。三次判定所看的静态稿缺全部答复正文（见 D-018），等于在"没有回答文字的页面"上评判。修复稿（`prototype-session-final.html`）已含 138 个正文块，需在该稿上重判。
- normalized_requirement: 凡基于残缺稿得出的否定结论，不得作为设计依据写入 design.md；重判前不追加新改动。
- evidence: prototype-session-final.html vs prototype-session-fullpage.html 的 `.wmde-markdown` 计数（138 vs 0）
- 故障面: 若重判仍不满意，说明问题不在正文缺失，须回到 D-016 的层次问题继续定位。

## D-020@v1: 删除轮间 1px hairline，仅以留白分隔轮次（用户方向）
- type: boundary
- priority: P1
- status: confirmed
- source: user
- question: 轮间那根 1px 细线要不要留？
- answer: 用户原话「轮间 1px hairline 多余」→ 删除。`turn-block` 容器 `border-b border-border pb-7 last:border-b-0` → 仅 `pb-7`（28px 留白保留）；`globals.css` 全文核对无其它轮间画线规则（已用测试锁死）。
- normalized_requirement: 轮次分隔不得使用任何边框/分割线，只允许留白；后续新增轮容器需同一约束。
- evidence: frontend/src/components/daemon/turn-timeline.tsx（turn-block 容器）；frontend/src/components/daemon/__tests__/turn-time-display.test.tsx（新增 describe）
- 故障面: 长会话滚动时"分轮感"完全依赖留白，若留白被压缩会失去分段感。

## D-021@v1: 对比加强（答案压过过程）——四组参数定稿
- type: definition
- priority: P1
- status: confirmed
- source: user
- question: 「对比加强」具体到什么数值？
- answer: 用户原话「对比加强」→ 落地为四组：①正文 14.5px/1.78/段距 0.6em → **15px/1.8/0.65em**（标题 16.5/15.5、行内 code 13）②过程行（思考+工具）12px → **11.5px + `text-muted-foreground/80`**，并去掉思考摘要额外 `opacity-75`（叠乘后浅色主题 <3:1 不可读）③工具行左规线静息 `border-border` → **`border-border/60`**（hover 仍 brand）④过程块与答复块间距 6px → **14px**（列 gap 7px + 答复块 mt-7px，过程行彼此仍 7px）。
- normalized_requirement: 四组数值即为验收基线；后续改动若触碰这些值，须同步更新对应单测断言（现有断言已锁 15px/1.8/0.65em、11.5px、/80、/60、14px 与 7px）。
- evidence: frontend/src/app/globals.css:827-855；frontend/src/components/daemon/turn-segment-views.tsx:684/798；frontend/src/components/daemon/turn-timeline.tsx:2044
- 故障面: 11.5px + 80% 墨色在部分浅色主题下接近可读下限，再降即失效。

## D-022@v1: 轨迹视图（对标 DSH Trajectory）档 1 并入本变更
- type: scope
- priority: P1
- status: confirmed
- source: user
- question: 轨迹能力是否做、做到哪一档、放哪个变更？
- answer: 用户要求「类似 deepseek harness 轨迹的能力，想在平台页面上看到」；并入本变更。档 1 ＝ 事件账本（按 run/step、工具子树按 `parent_tool_use_id`+`depth`）+ 记录 inspector（tokens/时长/入参原文/输出，`{}` 切 JSON）+ 时间轴跨度（`log.timestamp` 与 `tool_use→tool_result` 配对）。**不做** TTFT/decode 切片（需引擎上报首 token）、不做区间聚焦与滚轮缩放（留档 2/档 3）。
- normalized_requirement: 业务逻辑必须落在纯函数 `build-trajectory.ts`（≥12 单测）；UI 只渲染；作为第三个视图接入，不替换现有「进度」视图；不改数据链路（复用 `logsToTurns` 与 `turn-outline`）。
- evidence: frontend/src/components/daemon/trajectory/（待落，见 D-022 实现）；.sillyspec/changes/2026-10-20-session-page-dsh-alignment/decisions.md 前序分析
- 故障面: 会话页已 6029 行且无 E2E，若把逻辑写进页面组件即成第二个巨石。

## D-023@v1: 文件变更卡走 1b（daemon 每轮快照），turn 级 + 会话汇总，接受并行会话标注
- type: scope
- priority: P1
- status: confirmed
- source: user
- question: 文件变更卡覆盖到什么程度、粒度、如何隔离并行会话？
- answer: 用户问「bash / sillyspec CLI 改的文件能否回显」→ 核实 `edit_patch` 仅覆盖 Edit/Write（真实导出 91 条；bash 178、sillyspec 30 条均无 patch），故选定 **1b**：daemon 每轮做工作区快照（轮首记 HEAD，轮尾 `git status --porcelain -z --untracked-files=normal` + `git diff --numstat <baseline>`；ignored 目录仅按本轮工具调用路径前缀做 mtime 探测）。**粒度**＝turn 级卡片 + 会话级汇总。**隔离**＝共享工作区接受标注（卡片注明「可能含并行会话改动」），不强制每会话独立 worktree（留作后续根治项）。
- normalized_requirement: ①逐文件 +/− 以 git 快照为准，`edit_patch` 仅用于归因（点开看哪次编辑）；②快照有改动但无 patch 的文件须标「命令行/脚本改动」；③性能红线：每轮 ≤3 条 git 子进程、O(改动数+工具调用数)、禁 rename 检测、`core.preloadIndex`、`--no-optional-locks`、硬超时 1500ms 降级 partial、单工作区串行队列、遥测 p50>300ms 或降级率>5% 报警；④daemon 老版本降级为「仅工具编辑」并显式提示。
- evidence: frontend/public/__proto/session-export.json 的 `edit_patch` 计数（91/1271）、`runs[].diff_summary` 为 0/21；本仓 `git check-ignore .sillyspec/changes` 返回未忽略
- 故障面: git 无法区分并行会话归属（已接受标注）；目标仓若 gitignore `.sillyspec/` 需 mtime 兜底；每轮 git 调用在超大仓可能触顶降级。

## D-024@v1: 轨迹视图形态＝泳道时间轴（共享绝对时间轴 × 输入/模型/工具），账本降为「调用」档
- type: definition
- priority: P0
- status: confirmed
- source: user
- question: 轨迹视图该长什么样？
- answer: 用户提供 DSH 轨迹截图作为目标：**三条泳道（输入/模型/工具）+ 一条共享绝对时间轴 + 顶部三档视图（时长/轮次/调用）+ 搜索 + 选中区间高亮**，主视图不是表格。此前实现的「每轮一行小刻度 + 856 行账本」判定为形态错误。
- normalized_requirement: 泳道为主视图；账本保留为「调用」档（读细节用）；模型条=思考/答复事件跨度的**近似**（无 TTFT/attempt 数据时必须标注），不得画成 TTFT/decode 双色切分；三泳道配色走语义 token（输入=success/模型=brand/工具=warning），三主题成立。
- evidence: 用户 2026-10-21 10:43 截图；frontend/src/components/daemon/trajectory/*（泳道重做中）
- 故障面: 共享绝对时间轴在 577 分钟窗口下短轮会挤成一小撮，必须有缩放/窗口，否则退化回"看不出哪步慢"。

## D-025@v1: 过程行采用 DSH 式语义标签（思考 / 运行命令 / 收到任务消息…），daemon 采集缓发
- type: definition
- priority: P1
- status: confirmed
- source: user
- question: 会话里的过程行该怎么呈现？（并更正一处误读）
- answer: 用户提供 DSH 截图：每一步是**紧凑单行**——图标 + 语义标签 + 「 · 」+ 一行摘要（如「思考 · The backend model-usage agent finished…」「运行命令 · Regenerate OpenAPI and generated types」），并有独立的 **「收到任务消息」卡片**（带时间、可展开）。**更正**：截图中那张「收到任务消息」实际是变更 `2026-10-21-task-wakeup-restore` 的任务消息**误投到本会话**；用户从未说「daemon 采集缓发」，D-023 的 TTFT/attempt 采集**仍在范围内、不缓**。
- normalized_requirement: ①过程行标签改为语义化固定词表：思考 / 运行命令 / 读写文件 / 搜索 / 回复 / 失败；②行内=图标+标签+一行摘要（截断），默认折叠、时间或耗时靠右；③沿用现有 `turn-segment-views` 组件与 token，不新增数据链路（日志 channel + `metadata.agent_event.event_type` 已足够映射）。**范围排除**：「收到任务消息」卡片属变更 `2026-10-21-task-wakeup-restore` 的能力，**不在本变更范围内**（用户 11:09 明确），本变更不实现、不引用、不为其设计卡片形态。
- evidence: 用户 2026-10-21 11:04 截图 + 11:07 更正（该卡为其它变更的误投消息）+ 11:09 明确排除；frontend/src/components/daemon/turn-segment-views.tsx（现状已有 💭思考过程 / 工具行，缺语义标签词表）
- 故障面: 标签是**展示层映射**，不得改写日志原文；未知 event_type 必须回退「其它」而不是丢弃（否则新工具上线即隐身）。

## D-026@v1: 轨迹档 1 扩入缩放/平移/窗口与口径修正〔取代 D-022 的「不做区间聚焦与滚轮缩放」子句〕
- type: scope
- priority: P0
- status: confirmed
- source: user
- question: 泳道时间轴在 577 分钟窗口下条太细（模型覆盖 1.3%、2px 条点不中），怎么办？
- answer: 用户选定「1→2→3」：①做缩放/平移/窗口；②轴与账本列对齐；③模型口径改为「整段非工具空档（含≥1 条思考/答复）」。已落地：`zoom.ts` 纯函数（`zoomAt/panView/clampView/tickTimes/pickSpanAt`，`MIN_VIEW_SPAN_MS=60s`、`ZOOM_STEP=1.15`、`HIT_BAND_PX=6`）+ 泳道组件（非 passive wheel、拖拽、双击/按钮重置、10px 总览刷子、视野派生刻度、6px 命中带最近中心裁决）；轴对齐 Δ=0.00px（改前 308px）；模型覆盖 7.4min(1.3%)→**53.3min(9.2%)**，条数 187→183。
- normalized_requirement: ①允许并实现滚轮缩放（锚点稳定，±1px）、拖拽平移（两端钳制）、双击/按钮复位、总览刷子；②时间轴右缘必须与账本盒子右缘对齐（Δ≤2px）；③模型条＝整段非工具空档且含思考/答复行，必须与工具区间零重叠，并在 UI 显示 `模型 x% · 工具 y% · 空档 z%`；④**D-022 中「不做轨迹区间聚焦与滚轮缩放」子句作废**，档 1 范围以本条为准。
- evidence: frontend/src/components/daemon/trajectory/{zoom.ts,trajectory-timeline.tsx,build-trajectory.ts}；tests 56 例（zoom 18 + timeline 7 + builder 31）；Playwright 21/21、console 0 错
- 故障面: **9.2% 读作「模型活动」偏高**——轮首等待/上下文拼装/工具后空闲均计入 gap，轮内口径为 模型 26% / 工具 62% / 空档 12%，整窗另有 370min 属轮间空闲；106 分钟的长条在 1 分钟视野下宽 129,578px（靠 overflow 裁，无虚拟化）；无键盘缩放/惯性/「缩放到选中条」；618 个 bar 仍是 tab 停留点。
- 退役判据: 若后续接入 TTFT/attempt 真实采样（D-023 的 daemon 采集落地），模型条应改回「真实 API 占用区间」，本条的空档口径随之作废。
- 文档同步待办（本条落地后必须做，否则 docs-check 拦）：design.md 线 B 段与 builder 片段、`.sillyspec/docs/frontend/modules/components-daemon.md` 会话页轨迹段、`.sillyspec/docs/SillyHub/scan/PROTOTYPE.md` 的 dev 路由条目。

## D-027@v1: 1b 快照落库点修正——interactive 轮走 `close_run_steps`，不走 `lease/service.complete_lease`〔2026-10-21 execute 期实证〕
- type: consistency
- priority: P0
- status: confirmed
- source: code
- question: design「落库点」写的 `lease/service.py` 与 `_upsert_batch_model_usage` 同事务，对 interactive 轮成立吗？
- answer: 不成立。实证：`_upsert_batch_model_usage` 唯一调用点是 `lease/service.py:457`（batch `complete_lease` 路径）；interactive 轮的终态是 `daemon/hub-client.notifyRunResult` → `POST /leases/{id}/runs/{run_id}/result` → `router/lease.py:233 close_interactive_run` → `run_sync/service/__init__.py:386-449` → `run_sync/service/close_run_steps.py:_close_apply_terminal`，`agent_run_model_usage` 的 upsert 在 `close_run_steps.py:379-417`。若按原写作落点实现，1b 快照对真实产品路径**永不落库**。
- normalized_requirement: ①侧表 `daemon_run_snapshots` 与 `_upsert_run_snapshot` helper 的实现位置不变（`model.py` / `lease/service.py` 供两路径共用），但**interactive 轮的实际调用点改为 `close_run_steps._close_apply_terminal`**（紧跟 model_usage upsert 之后，同一事务段，异常 best-effort 捕获不拖垮终态）；②请求面在 `InteractiveRunResultRequest` 增**可选**字段 `file_changes` / `timing` / `daemon_version`，经 `run_sync/service/__init__.py` 透传；③不改任何既有响应形状与必填性（老 daemon 不传 → `None` → `capability="tool_only"`）；④task-08 的 allowed_paths 相应扩 3 个文件（`router/lease.py`、`run_sync/service/__init__.py`、`run_sync/service/close_run_steps.py`），经用户 2026-10-21 16:1x 显式批准。
- evidence: `backend/app/modules/daemon/lease/service.py:457`（唯一调用点）、`router/lease.py:233`（close_interactive_run）、`run_sync/service/__init__.py:386-449`（透传签名）、`close_run_steps.py:379-417`（model_usage upsert 段）；design.md:「### 1b 承载面与读模型字段」落库点句、「## 文件变更清单」lease/service.py 行同步校正
- 故障面: 若未来新增第三条 run 终态写入路径（如离线补报），同样必须在 `_close_apply_terminal` 或新增的共用 helper 处调用，否则快照再次断链；design 的「落库点」表述应改为「`close_run_steps._close_apply_terminal`（interactive）/ `complete_lease`（batch）」两条。

## D-028@v1: daemon 上报出口同样落在 task-09 范围外——`daemon.ts` / `hub-client.ts` 最小扩字段〔2026-10-21 execute 期实证〕
- type: scope
- priority: P0
- status: confirmed
- source: code
- question: task-09 只改 `session-manager.ts` 能把快照发到后端吗？
- answer: 不能。`SessionManager._onResult` → `deps.onTurnResult` → `daemon.ts::notifyRunResult(leaseId, claimToken, runId, payload)`（payload 类型在 `daemon.ts:980-1010` 内联声明）→ `hub-client.ts::notifyRunResult` 请求体（`model_usage?` 附近，约 `:1200-1300`）。两个文件都不在 task-09 的 allowed_paths 内，不加字段则快照只在本进程内生成、永远不落库。
- normalized_requirement: ①`daemon.ts` 的 payload 类型与 body 组装加**可选** `file_changes`（字段存在才写，沿用 `model_usage` 惯例）；②`hub-client.ts` 请求体类型加同名可选字段并映射到 `body.file_changes`；③`interactive/types.ts` / `session-manager/types.ts` 若需同步 deps 签名，允许一并改；④只加字段、不改既有字段与必填性、不改事件协议；⑤task-10 的 `timing` 复用同一 payload 组装点（一次上报，不新建通道）。
- evidence: `sillyhub-daemon/src/daemon.ts:977-1010`（`notifyRunResult` payload 内联类型）、`:4040-4200`（payload 组装段）、`hub-client.ts:1200-1300`（请求体映射）；session-manager 侧只有 `onResult` 委托（`session-manager.ts:1593-1594`）
- 故障面: 上报体是**手写 snake_case 映射**（非生成物），新增字段必须在两处同步，漏一处即静默丢字段；建议 task-13 的版本门控实测里把「字段出现在 wire body」作为一条断言。

## D-029@v1: 1b 读模型落点＝`GET /sessions/{id}/runs`（SessionRunRead），`TurnOutlineItemRead` 不加字段〔2026-10-21 execute 期裁决〕
- type: boundary
- priority: P1
- status: confirmed
- source: code
- question: 轮次读模型有三个候选（`SessionRunRead` / `TurnOutlineItemRead` / session 详情），字段放哪个？
- answer: 放 `SessionRunRead`（`GET /sessions/{id}/runs`）——前端 `runsMeta`（`session-panel-page.tsx:805` 的 `Map<string, SessionRunRead>`）就是消费面，task-11 的轮级卡片与 task-12 的模型泳道都从它取；`TurnOutlineItemRead` 走进程内 LRU 指纹，指纹不含 `daemon_run_snapshots`，快照晚到时会产生**陈旧读**（读到旧快照却不自知），且当前无消费方。
- normalized_requirement: ①字段名固定为顶层 snake_case `file_changes` / `file_changes_capability` / `timing`，嵌套保持 daemon DTO 的 camelCase（与既有 `SessionRunRead` 风格一致）；②`/runs` 投影必须一次 IN 批量查（N+1 断言见 task-08 测试）；③若后续确有 turn-outline 消费需求，再单独立项补指纹，不在本变更内顺手加。
- evidence: `backend/app/modules/daemon/router/session_insights.py`（SessionRunRead 三字段 + 投影段）、`backend/app/modules/daemon/tests/test_session_file_changes.py`（N+1 断言：含 `daemon_run_snapshots` 的 SQL 语句数 == 1 且含 IN）
- 故障面: 前端若直接吃 turn-outline 缓存而非 `/runs`，会拿不到快照；task-11 必须以 `runsMeta` 为准（设计已如此要求）。

## D-030@v1: 后到快照必须在「run 已终态」的二次上报里补写侧表（否则 1b 对 interactive 全废）〔2026-10-21 execute 期实证〕
- type: consistency
- priority: P0
- status: confirmed
- source: code
- question: daemon 的采集必然晚于轮终态落库，而 `close_interactive_run` 对已终态 run 是 no-op——快照会不会被丢掉？
- answer: 会丢。实测：`close_run_steps.close_interactive_run` 的 terminal 分支（`agent_run.status in TERMINAL_TURN_STATUSES`）先 `rollback()` 再 `return`，**整条不写侧表**；而 daemon 侧 `_onResult` 是「`await onResult(...)`（含首报 close）→ 之后才 fire-and-forget 采集 → 二次上报 file_changes/timing」，因此带快照的那次上报**永远命中 no-op 分支**。若不修，interactive 会话的轮级卡一律退 `tool_only`，1b 数据链路等于没通（只有 batch 路径能出卡）。
- normalized_requirement: ①terminal no-op 分支在 `rollback()` 之后、`return` 之前，若 `file_changes`/`timing` 非空则补写侧表：`refresh(agent_run)`（rollback 已把属性置 expired，不先 refresh 会在 async 上下文触发同步懒加载 → `MissingGreenlet`）→ `_upsert_run_snapshot` → `commit()`（helper 只 flush，本分支无外层提交）→ 失败仅 `warn` + `rollback`；②**只动 `daemon_run_snapshots`，绝不改 run 终态字段**，幂等语义不变（终态 run 仍返回原行）；③补测试锁死：首报不带快照 → `tool_only`；同 run 二次上报带快照 → capability 变 `full`、侧表仍 1 行（覆盖写）、run 状态仍 `completed`、`daemon_version` 落库。
- evidence: `backend/app/modules/daemon/run_sync/service/close_run_steps.py`（terminal 分支补写块 + 注释）、`backend/app/modules/daemon/tests/test_session_file_changes.py::test_late_snapshot_after_terminal_close_still_persists`（2026-10-21 17:02 实测 7 passed）
- 故障面: 后到快照是一次**额外**的 result 上报（携带首报终态三字段复述）；若未来把 `notifyRunResult` 的幂等改成 409/抛错，这条补写路径会静默失效。批量补发（outbox）同理需保证只写侧表。

## D-031@v1: 前端降级判据以 capability 为准；`snapshot=null` 且 `capability` 也缺＝「未接线」，不出卡〔2026-10-21 execute 期裁决〕
- type: boundary
- priority: P1
- status: confirmed
- source: code
- question: `fileChanges=null` 时，什么时候出「仅工具编辑」降级卡、什么时候干脆不出卡？
- answer: 三分法（对齐 design E6/E8）：①`capability="tool_only"`（含 snapshot=null）→ 出「仅工具编辑」降级卡 + 说明行；②`status="failed"|"unavailable"` → 同样降级卡（快照不可信）；③`snapshot=null` **且** `capability` 为 `null/undefined` → **不出卡、不出占位**——这是「挂载方没接线」（dialog / 旧消费方），把它显示成「daemon 老版本」是另一种误导；④`status="ok"` 且 `files=[]` → 不出卡（快照确认零改动，且全树禁止出现「本轮无改动」字样）。
- normalized_requirement: ①前端**只看 capability，不用字段是否存在判断降级**（E6/E8 硬约束在实现上体现为「capability 缺失 ≠ tool_only」的特例，因为后端该字段 required 且缺省即 tool_only，真实会话页恒有值）；②降级卡必须含「仅工具编辑」文案 + 「daemon 未上报工作区快照，本卡只含 Edit/Write 工具编辑」说明；③轮级卡只挂「完整轮」分支（预览卡 / whoLine-only 紧凑行无轮尾状态行，不挂卡），会话级汇总仍计入这些轮的快照。
- evidence: `frontend/src/components/daemon/file-changes/turn-file-changes.ts`（三分法 + 降级态构造）、`__tests__/turn-file-changes.test.ts`（纯函数两态分支）+ 渲染侧三处 `queryByText(/无改动/)` 断言：`__tests__/file-changes-card.test.tsx`、`__tests__/file-changes-summary.test.tsx`、`frontend/src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx`、`turn-timeline.tsx`（`toFileChangesCardProps(...)==null` 时零占位）
- 故障面: 老 daemon 会话里「每轮一张仅工具编辑卡」会显得吵（20 轮 → 20 张）；这是 E8「显式提示不静默」的代价，收窄需另立设计条目（建议后续：仅末轮/首轮出卡 + 汇总卡统一提示）。

## D-032@v1: TTFT/attempt 实际只能 `basis="approx"`（三引擎均无「模型请求起点」事件）；attempt 沿用近似起点而非只记终点〔2026-10-21 execute 期实证〕
- type: feasibility
- priority: P1
- status: confirmed
- source: code
- question: plan 的 spike-02 要求「能稳定切出请求起点 → 首个 delta → 终点」，实际能切吗？
- answer: **不能**，三引擎在 daemon 事件边界都没有稳定的请求起点：①claude 的 SDK `message_start` 被归一化器吃掉（只用于算 `api_duration_ms`，不产 AgentEvent，`:973-1031`）；②codex 的 `turn/started` 只是**轮**起点，工具结果后无通知；③pi 的 `message_start` 当纯生命周期丢弃（`pi-events.ts:36`），`turn_start` 只产 status。故按 plan 降级口径：attempt 起点＝轮首（首段）/「本批工具全部 result 返回」之后；首 token＝首个 text/thinking delta；终点＝下一个 `tool_use` 或轮终态；`basis` 恒 `"approx"`。
- normalized_requirement: ①`"observed"` 只保留契约值（无 producer 不造假开关），待引擎上报请求起点再翻转；②design DTO 的 `attempts[].startedAt` 保留**近似起点**（而非 plan 字面「只记终点」）——否则前端按 `startedAt+endedAt` 画条会整条跳过 attempts，「真实区间」收益归零；该偏差写在 `turn-timing.ts` 模块注释；③`ttftMs` 只在取到首 token 时有值，禁填 0；④claude 的 TTFT 含 ≤500ms partial flush 偏差、`totalMs` 含 inject→起跑排队窗口——两条均属 approx 固有偏差，已在模块头披露。
- evidence: `sillyhub-daemon/src/interactive/turn-timing.ts`（392 行，`deriveTurnTiming` + `timingEventFromAgentEvent` + 模块头偏差披露）、`tests/interactive/turn-timing.test.ts`（19 例）、`session-manager.ts`（`_noteTurnTimingEvents` 内存累加 + `_buildTurnSnapshotReport` 合并 `timing`，同一次上报）
- 故障面: 前端会**长期**显示「近似（无 TTFT 采样）」而非「真实占用」——UI 的 observed 分支目前只有单测覆盖、生产不可达；若产品要求「真实占用」必须先在 driver 层补 `request_start` 事件（跨 daemon 驱动改造，不在本变更）。

## D-033@v1: 迁移链尾锚测试随新迁移一并前移（提交 hook 强制连带）〔2026-10-21 execute 期登记〕
- type: consistency
- priority: P1
- status: confirmed
- source: code
- question: 新增一条 alembic 迁移后，`backend/tests/test_align_platform_change_events_migration.py` 为什么必须改？
- answer: 仓内 pre-commit hook 的「迁移」钉子会校验迁移链尾锚测试——新增迁移后 `heads[0]` 不再是旧 head，hook **直接拒签**（实测：首次提交被拦，提示「迁移链尾锚测试 heads[0] 前移到新 head（注释链续写）」）。故把 `heads[0]` 由 `c3f8a1d6e2b4` 前移为 `20261021120000` 并在注释链续写一行是本变更的强制连带改动，不是新交付面。
- normalized_requirement: ①该测试只允许改 `heads[0]` 断言与注释链，不得放宽其它守护断言；②`pytest tests/test_align_platform_change_events_migration.py` 必须 7 passed；③design「文件变更清单」补该行（否则 worktree apply 的清单校验会拒）。
- evidence: `backend/tests/test_align_platform_change_events_migration.py`（`assert heads[0] == "20261021120000"`）、`uv run --frozen pytest -q --no-cov tests/test_align_platform_change_events_migration.py` → **7 passed**（2026-10-21 17:24）
- 故障面: 该锚点测试是「迁移双头」的守护，若把它改成不校验（例如 `assert len(heads) == 1` 以外全放行），未来并行迁移再出双头就无人拦。

## D-034@v1: `partial` 且无文件清单时出「一行提示卡」——不得静默成「本轮无改动」〔2026-10-21 execute 期独立审查阻断项修复〕
- type: boundary
- priority: P1
- status: confirmed
- source: code
- question: `status="partial"`（超时 / 队列溢出）时 daemon 只返回 `files=[]`，前端还该不该出卡？
- answer: **该出**。独立审查（execute stage review）实测：daemon 超时与队列溢出都返回 `files: []`（`turn-file-changes.ts:813-824`、`tests/interactive/turn-file-changes.test.ts:433-435`），而前端 `toFileChangesCardProps` 先把 partial→`truncated`，随后 `if (files.length === 0) return null` 整卡不渲染 → 用户看到「没有卡」，无法区分「采集没完成」与「本轮真的没改文件」，与 design「partial 卡片照出」相悖（E6/E8 立意）。修法取 A（实现意图，而非改口径）：partial 且无文件清单 → 渲染 28px 单行提示卡（`data-testid="file-changes-notice"`），文案「工作区快照未完成（超时或队列溢出），本轮改动未知」。
- normalized_requirement: ①`NOTICE_PARTIAL_NO_FILES` 常量承载文案，映射层返回 `{files:[], truncated:true, notice, capability:"full"}`；②卡片新增可选 `notice`：有 notice 时出提示卡（无文件行、无 +/−、头部不可展开），**仍不出现「无改动」字样**；③`status="ok"` 且 `files=[]` 仍是真空态（零渲染）——两者不得混淆；④补测试：映射 2 例（timeout / queue_overflow）+ 卡片 1 例（28px 单行、无行、无「无改动」）。
- evidence: `frontend/src/components/daemon/file-changes/turn-file-changes.ts`（`NOTICE_PARTIAL_NO_FILES` + partial 空清单分支）、`file-changes-card.tsx`（`notice` 提示形态）、`__tests__/turn-file-changes.test.ts`（+2 例 → 19）、`__tests__/file-changes-card.test.tsx`（+1 例 → 14）；`vitest run src/components/daemon/file-changes/__tests__/` → **42 passed**，`tsc --noEmit` exit 0（2026-10-21 20:38）
- 故障面: 提示卡与「仅工具编辑」降级卡是**两种**话术（前者「没拿到清单」、后者「没有这项能力」），未来若合并会再次丢语义；`reason` 细分（timeout vs queue_overflow）在快照里保留，但 UI 合并表述——若要区分需在 `notice` 上带 reason。
