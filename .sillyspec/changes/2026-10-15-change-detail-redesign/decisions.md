---
author: qinyi
created_at: 2026-10-15 23:40:00
change: 2026-10-15-change-detail-redesign
---

# 决策记录（Decisions）

> 本变更 = 变更详情页（桌面）信息架构重设计。用户原始诉求原话：「我想重新设计下变更详情页面，现在显示太乱，而且感觉不够直观清晰」。
> 决策来源：brainstorm 阶段两轮 AskUserQuestion（第 1 轮 4 问 / 第 2 轮 4 问）+ 方案选择 1 轮 3 问，全部由用户亲手作答。

## D-001@v1: 首屏信息动线 = 分阶段自适应（在途看进度+待办 / 归档看成果）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 打开变更详情页时，第一眼应该看到什么？
- answer: 用户选「分阶段自适应」：在途变更首屏讲「进度 + 现在该做什么」，归档变更首屏讲「最终产出了什么」；同一页面按变更状态切换重点，避免两套空态互相打架。（落选：待办优先 / 进度优先 / 成果优先三个单一取向。）
- normalized_requirement: 详情页首屏内容按变更状态（在途 vs 归档）分叉渲染；归档态不得出现「执行中」类在途空态文案，在途态不得出现「归档留档」类占位。
- impacts: [FR-01, task-01]
- evidence: 用户第 1 轮回答；现状乱源取证——page.tsx:405 起的网格与全部卡片挂载点无状态分叉，归档页与在途页渲染同一套卡（change-assets-card.tsx:248-261 同时在途空态与归档空态两套文案）。
- 故障面: 状态判定用 isTerminalChange(status=archived 或 location=archive) 双条件，若后端新增第三态（如 failed）则分叉漏判退化为在途态展示。
- 退役判据: 若详情页拆分为两个独立路由（在途页/归档页），本「同页自适应」决策退役为路由分叉。
- 模块域: frontend

## D-002@v1: 页面骨架 = 顶部四 Tab 分区（概览 / 产出 / 过程 / 文件与对账）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 布局形态选哪种（顶部 Tab 分区 / 单列纵向流 / 保留左主右辅精简侧栏 / 双栏+手风琴）？
- answer: 用户选「顶部 Tab 分区」，并以第 2 轮追问确定为**四 tab**：概览 / 产出 / 过程 / 文件与对账；首屏只留概览，其余点进去看。tab 组件复用项目现成 primer `UnderlineNav`（变更列表页已同款使用）。
- normalized_requirement: 详情页主体为四个 tab；首屏默认「概览」；tab 结构随变更状态自适应（见 D-007）。
- impacts: [FR-02, task-02]
- evidence: 用户第 1 轮 + 第 2 轮回答；primer UnderlineNav 现成件 frontend/src/components/primer/underline-nav.tsx:1-35；列表页同款用法 frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx:904。
- 故障面: tab 隐藏内容后，用户可能找不到某些信息（发现性下降）——以概览页放「各 tab 摘要 + 计数入口」缓解（已计入 D-006/D-007）。
- 退役判据: 若内容量回落到单屏可承载（如卡片数 ≤3），可退回单列布局。
- 模块域: frontend
- 决策链: 本条**取代**历史决策——变更 2026-08-11-change-detail-layout-rework 的 D-001@v1「布局形态 = 左主右辅右栏侧栏」（当时问句为「次线区（文件/会话/历史/任务）用侧栏还是顶部 Tab？」，答案选侧栏）。取代理由：该决策落地后页面继续叠加沉淀资产卡（861 行）、知识图谱分区、范围对账卡（778 行）、真实留痕时间线等，侧栏 296px 已无法承载增量，且「左主右辅」把不同性质内容混排在同一条滚动流里——本次用户明确改选 tab 分区。

## D-003@v1: 知识图谱 = 脱离沉淀资产卡内嵌，作为「产出」tab 内独立分区
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 现在内嵌在沉淀资产卡里的知识图谱怎么处理？
- answer: 用户选「知识图谱独立」：图谱从资产卡内嵌分区改为「产出」tab 内的独立分区（自带画布 + 右侧节点详情），不再与资产清单抢同一张卡；卡内固定高度（280px）的挤压约束随之解除。
- normalized_requirement: 知识图谱渲染位置不再位于资产卡网格内；图谱区可独立占据「产出」tab 的完整版面。
- impacts: [FR-03, task-03]
- evidence: 用户第 1 轮回答（多选）与第 2 轮 tab 划分确认；现状取证 change-assets-card.tsx:242-246（图谱分区挂资产卡双列网格顶、md:col-span-2）、change-assets-graph.tsx:1-247（图谱子组件，画布 h-[280px] + 250px 详情栏）。
- 故障面: 图谱查询失败/不可用时的隐藏策略改变——原为「整区静默隐藏」（资产卡内局部塌陷），独立成区后隐藏会造成 tab 内大片空白，需为空态提供显式说明或整 tab 空态（已列入 design 待办）。
- 退役判据: 若知识图谱页（/knowledge/graph）能承接该视图，可改为深链跳转而非内嵌。
- 模块域: frontend

## D-004@v1: 范围对账 = 从侧栏常驻下沉至「文件与对账」tab
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 778 行的「范围对账」卡（侧栏常驻）怎么处理？
- answer: 用户选「范围对账下沉」：不再侧栏常驻，收进「文件与对账」tab（与变更文件同区）；卡内三态计数、明细弹窗、命令折叠等既有能力保留。
- normalized_requirement: ScopeAuditCommandCard 不再挂载于侧栏；挂载点在「文件与对账」tab。
- impacts: [FR-04, task-06]
- evidence: 用户第 1 轮回答（多选）；现状取证 frontend/src/components/changes/scope-audit-command-card.tsx:671（卡头「⚖️ 范围对账（scope-audit）」）、:676-678（摘要区）、page.tsx:512-519（aside 挂载点）。
- 故障面: 下沉后用户不再被「有差异」自动提示——若差异化提示缺失，对账价值降为「主动去看」，需在概览保留差异计数入口（已计入 D-006）。
- 退役判据: 若对账能力并入「归档留档」数据面（同一批文件差异），本卡可整体退役。
- 模块域: frontend

## D-005@v1: 两条时间线合并为一条统一时间线
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 「步骤时间线」（change.steps）与「真实留痕时间线」（GET /timeline 的事件轴+任务清单）信息重叠，怎么处理？
- answer: 用户选「合并两条时间线」：合并为一条统一的过程时间线（时间/任务/状态/提交记录合到一行看），消除同一时点、同一任务在两处重复出现的现象。
- normalized_requirement: 详情页只渲染一条时间线；每个逻辑事件只出现一次；两源的独有信息（步骤侧：阶段分组、7 值状态、等待原因、输出全文、负责人变更事件；留痕侧：提交哈希+标题、诞生锚、文件变更/配置变更类事件、墙钟统计）在合并后均不得丢字段。
- impacts: [FR-05, task-04]
- evidence: 用户第 1 轮回答（多选）；重叠取证——change-step-timeline.tsx:189-220（步骤行：名称/状态点/时间/output）与 change-timeline-card.tsx:107-115,257-287（事件行：时间+kind 图标+label；任务行：☑+时间+task id+desc+commit_sha）双源同示时间戳与任务名；page.tsx:435-475 与 :484 两处并挂。
- 故障面: 合并去重规则误判把两个真实不同的动作并成一行（如某步骤的 --done 与同名 task-done 事件）——需以「源+稳定键」复合键去重而非按名称/时间近似匹配，且保留可展开查看原始两源明细的兜底。
- 退役判据: 若后端提供单一权威时间线端点（服务端合并），前端合并算法退役。
- 模块域: frontend

## D-006@v1: 执行用量与会话入口 = 概览右侧信息栏（MetaPanel 式压缩展示）
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 「执行用量」（耗时/token/轮次/按模型明细）与「会话入口」放在哪？（第 1 轮未勾选下沉，第 2 轮专项追问）
- answer: 用户选「概览右侧信息栏」：概览页右侧一条窄信息栏（类 GitHub PR 右栏 / primer MetaPanel），承载变更 key、类型、负责人、创建时间、任务进度、用量数字、会话入口、范围对账差异计数等元信息，压缩成数行；用量明细仍可按需展开。
- normalized_requirement: 概览 tab 为「主区 + 右侧信息栏」两栏；执行用量与会话不经由「过程」tab。
- impacts: [FR-06, task-05]
- evidence: 用户第 2 轮回答；现成件 primer MetaPanel/MetaPanelSection（frontend/src/components/primer/index.ts 桶导出）；承接活需求 FR-auto-frontend-038（变更详情右侧为单块 MetaPanel 分组）——本条把该需求的承载面从「页面右侧整栏」收敛为「概览 tab 右侧信息栏」，其余分组项（负责人/消耗/变更文件/关联会话/快速任务）按其归属 tab 重新归位。
- 故障面: 信息栏窄（≤300px）时长文本（变更标题、会话名、模型名）溢出——需统一 truncate + title 悬浮全文的既有约定。
- 退役判据: 无（信息栏为概览的结构组成）。
- 模块域: frontend

## D-007@v1: 归档态 tab 集自适应收窄
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 已归档的变更怎么展示（tab 随状态自适应 / 结构固定不变 / 归档后重排顺序）？
- answer: 用户选「tab 随状态自适应（收窄）」：归档后保留概览（转为「成果总结」语义）+ 产出 + 过程，隐藏「文件与对账」（归档时其内容与「沉淀资产 · 归档留档」重复）。在途变更则概览突出进度与待办。
- normalized_requirement: 归档态（isTerminalChange 为真）不渲染「文件与对账」tab；归档态概览首屏为成果语义（资产计数/改动规模/墙钟），不得出现执行中类文案。
- impacts: [FR-07, task-07]
- evidence: 用户第 2 轮回答；现状取证——scope-audit-command-card.tsx 的 archived 降级指路文案已自认「真实改动面见『沉淀资产 · 归档留档』」（page.tsx:510-511 注释与组件内 archived 分支），证明两者在归档态语义重复。
- 故障面: 归档态隐藏 tab 后，用户若仍需对账明细将无入口——降级路径为「产出」tab 的归档留档区（patch/delta + 单文件 diff）。
- 退役判据: 若对账与归档留档两数据面合并，本收窄规则随 D-004 一并复核。
- 模块域: frontend

## D-008@v1: 实现路径 = 原型驱动全量重写（走项目既有 prototype-as-code 管线）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 三种实现方案（A 原型驱动全量重写 / B 直接改正式页面 / C 双轨新路由并行）选哪个？
- answer: 用户选方案 A：先在 `frontend/src/components/prototype/` 写完整新版详情页视图（import 生产组件 + fixture 假数据），`pnpm prototype:build` 编译为可双击打开的独立 HTML 供用户批准；批准后按 PROTOTYPE.md「接线」规程把视图挪到正式页面（fixture 换真实 hooks），同变更内一次性完整交付（D-010）。
- normalized_requirement: 实现前必须产出并通过用户批准的原型产物（prototype-dist/*.html）+ 原型源码；批准时的产物与源码一起提交；此后源码改动必须重编译（git diff 为空为对账门）；原型源码与生产代码同质量门（tsc/eslint/禁硬编码色）。
- impacts: [FR-08, task-08]
- evidence: 用户第 3 轮回答；规约依据 .sillyspec/docs/SillyHub/scan/PROTOTYPE.md（页面类原型 = prototype/<名>-view.tsx → pnpm prototype:build → prototype-dist/<名>.html；管线明文支持「主题切换/tab 过滤」类轻交互，恰为本变更所需）；现有同页原型先例 frontend/src/components/prototype/change-detail-view.tsx（GitHub PR 式，PageHead+ChecksBar+Timeline+MetaPanel）。
- 故障面: fixture 假数据与真实数据形状偏差（尤其合并时间线 D-005 的去重输入）——以「原型只管版式、逻辑走纯函数+单测」分工隔离，接线阶段逐 tab 换真实 hooks。
- 退役判据: 若原型管线被废弃（改为 dev 预览路由），本路径退化为「dev 预览确认」。
- 模块域: frontend

### D-008-rejected-B@v1: 直接改正式页面（跳过原型）
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 三种实现方案（A 原型驱动全量重写 / B 直接改正式页面 / C 双轨新路由并行）选哪个？
- answer: 落选。用户未选方案 B。
- 否决理由: 当前无运行中的前后端实例，查看效果需先起全栈（backend+daemon+frontend），确认成本高；改版中途页面处于半成品态，用户不满意时返工面直接落在正式代码里。
- 复潮条件: 若引入可一键拉起全栈的 dev 预览（含 fixture 数据源），或用户明确要求以真实数据验收版式时，可重议。
- 模块域: frontend

### D-008-rejected-C@v1: 双轨新路由并行（/changes/[cid]/v2）
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 三种实现方案（A 原型驱动全量重写 / B 直接改正式页面 / C 双轨新路由并行）选哪个？
- answer: 落选。用户未选方案 C。
- 否决理由: 一个变更周期内需维护两套详情页与两套测试；页面深链（列表行、移动端、通知、知识库反链等）多处指向 /changes/{cid}，双路由接线成本额外增加；本项目规则 11 明示「未正式上线、允许重置、不要求历史兼容」，双轨的保险价值不成立。
- 复潮条件: 若详情页进入「已上线且不允许破坏性变更」阶段，需要灰度对比时，可重议。
- 模块域: frontend

## D-009@v1: 与本次冲突的活需求 = 显式取代并落盘
- type: consistency
- priority: P0
- status: accepted
- source: user
- question: 与本次冲突的 6 条活需求（左主右辅 / 两时间线共存 / 图谱内嵌等）怎么处理？
- answer: 用户选「显式取代并落盘」：在本变更 decisions.md + requirements.md 逐条写入取代记录（旧 FR 标 superseded + 指向新 FR），并同步知识库索引；不采用「只在新文档注明」的轻处理。
- normalized_requirement: 交付物必须包含取代清单：活需求 FR-unmapped-497（左主右辅）、FR-auto-frontend-056（两时间线共存）、FR-build-133（图谱内嵌资产卡）、FR-build-134（主栏顺序）、FR-auto-frontend-087（资产卡固定高度网格）、FR-styles-011（详情页重排）逐条标 superseded 并给出承接者；部分取代者（FR-unmapped-498 会话定位、FR-auto-frontend-038 MetaPanel 分组、FR-auto-frontend-012 三卡挂载）记录承接语义。
- impacts: [FR-09, task-09]
- evidence: 用户第 3 轮回答；活需求取证 .sillyspec/knowledge/fr/frontend.md:2728（FR-unmapped-497 状态 active）、:971（FR-auto-frontend-056 状态 active，测试绑定 page-restore-assets.test.tsx）、.sillyspec/knowledge/fr/build.md:1983（FR-build-133）、:2002（FR-build-134）、.sillyspec/knowledge/fr/styles.md:199（FR-styles-011 状态 active）。
- 故障面: 取代记录不全 → 旧需求保持 active 会在后续变更的知识注入中被当作真约束，造成改回旧版式的复潮。
- 退役判据: 无。
- 模块域: frontend

## D-010@v1: 交付节奏 = 一次性完整交付
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 交付节奏（一次性完整交付 / 分两批先骨架后细化）？
- answer: 用户选「一次性完整交付」：概览 + 产出 + 过程 + 文件与对账四 tab、合并时间线、图谱独立分区、口径自适应全部完成后统一验收，不留四不像的中间态。
- normalized_requirement: 本变更验收时四 tab 与自适应口径全部可用；不接受「骨架已改、内容仍为旧卡」的中间交付态。
- impacts: [FR-10, task-10]
- evidence: 用户第 3 轮回答。
- 故障面: 单次交付面大（page.tsx 重写 + 新组件族 + 合并算法 + 原型），风险集中——以 Wave 分批执行 + 每波测试绿门控缓解。
- 退役判据: 无。
- 模块域: frontend

## D-011@v1: 改造边界 = 桌面变更详情页；移动端不动但组件契约须兼容
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 本次改造的边界划在哪（仅桌面前端 / 桌面+移动端 / 允许改后端）？
- answer: 用户选「允许改后端」（若设计需要可新增接口或字段，同变更内同步生成前端类型）；同时未选「桌面+移动端」，故移动端 /m/ 详情页本轮不改。经源码核实：移动端直接 import 了桌面的 4 个组件（change-agent-run-log / change-stage-header(WORKFLOW_STAGES) / change-step-timeline / change-usage-card）与 scope-audit-command-card，故重构不得静默破坏这些导出与行为。
- normalized_requirement: 桌面详情页为唯一改造面；移动端 mobile-change-detail.tsx 的全部 import 契约（组件名/导出符号/关键渲染契约）在重构后保持可用；后端改动若发生，须同变更内跑前端与 daemon 双端 gen:types 并提交。
- impacts: [FR-11, task-11]
- evidence: 用户第 1 轮回答；移动端依赖取证 frontend/src/components/mobile/mobile-change-detail.tsx:73-77（4 个 detail 组件 + scope-audit）。
- 故障面: 合并时间线若决定在后端做（D-005 退役判据触发）会引入跨端改动，与「移动端不动」的边界冲突——已在 design 阶段以「前端合并、零后端改动」为默认路径规避（待 Design Grill 复核）。
- 退役判据: 移动端详情页改版立项时，本条边界失效。
- 模块域: frontend

## D-012@v1: 变更文件查看 = 「文件与对账」tab 内直接内嵌文件树
- type: architecture
- priority: P2
- status: accepted
- source: user
- question: 变更文件怎么看（标签页内直接内嵌 / 继续用弹窗）？
- answer: 用户选「标签页内直接内嵌」：文件树常驻于「文件与对账」tab，左侧点文件、右侧出内容/diff，不再只给一个「打开」按钮再套一层弹窗。
- normalized_requirement: 桌面详情页不再以 Dialog 作为文件树的唯一入口；文件树与预览在 tab 内同屏。
- impacts: [FR-12, task-06]
- evidence: 用户第 4 轮（原型确认轮）回答；现状取证 change-files-card.tsx:46-57（卡身仅标题+「打开」按钮，正文文件树在 Dialog 内、open 才 mount）。
- 故障面: 文件树常驻后首屏多一次取数（原为 open 才请求）——以 tab 懒挂载（切到该 tab 才挂载）抑制。
- 退役判据: 若文件树取数成本不可接受，退回弹窗按需加载。
- 模块域: frontend

## D-013@v1: tab 状态写入 URL query（?tab=）
- type: architecture
- priority: P2
- status: accepted
- source: user
- question: 标签页状态要不要写进网址？
- answer: 用户选「写进网址」：切换 tab 更新 `?tab=`，刷新、分享链接、从别处跳回都停在同一个 tab。
- normalized_requirement: 详情页 tab 为 URL 驱动（缺省概览）；非法/未知 tab 值回落概览；tab 切换不触发整页重载。
- impacts: [FR-13, task-02]
- evidence: 用户第 4 轮回答；先例 frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx（列表页既有 ?tab=quicklog 深链形态）、quicklog-linked-card.tsx:77-83（跳列表页带 ?tab=quicklog）。
- 故障面: URL 与内部 state 双源不同步（前进/后退与手改地址）——以 URL 为唯一源、state 从 URL 派生。
- 退役判据: 无。
- 模块域: frontend

## D-014@v1: 合并时间线的确定性口径（源内去重 + task-done 折叠 + 步骤行与任务行不合并）
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 两源（步骤 / 事件）合并时「每个动作只出现一次」如何实现而不依赖脆弱启发式？
- answer: 我的判断——读完后端合成时间线实现后确定三层口径：①**源内严格去重**：步骤用「阶段 + 序位」为键（StepTimelineEntry 有 stage/ordering 稳定字段，无 id），事件用「时间 + 类型 + 文本」为键（TimelineEvent 无 id）；②**task-done 事件不单独成行**：任务行的勾选时刻本就是由 task-done 事件序列推断出来的（backend/app/modules/change/timeline.py:96-122 `_infer_task_times`「checked N→M」游标衔接）——此为**数据来源上的确定重合，非近似匹配**，故 tasks 域的 task-done 事件折叠进「任务进度」清单，非 tasks 域（如 design.md 自审清单「design · checked 0→6」）的 checked 事件保留为普通事件行；③**步骤行与任务行不做合并**：二者粒度不同（阶段步骤 vs 计划任务）且映射非确定（步骤名常为「Wave 2 执行」而不含 task id），合并需名称/时间近似匹配 → 明确不做，转而在行内标来源（步骤/事件）并以独立「任务进度」清单承载任务面。
- normalized_requirement: 统一时间线只渲染 steps 与 events 两源合流；task-done（tasks 域）不作为时间线行出现；任务面由独立清单承载（勾选态 + 推断时刻 + 提交锚 + 进度比）；不得引入按名称相似度或时间窗口的跨源匹配。
- impacts: [FR-05, task-04]
- evidence: backend/app/modules/change/timeline.py:96-122（_infer_task_times 由 task-done 事件推断任务时刻）、:153-164（events 由 platform_change_events 直读）、backend/app/modules/change/schema.py:66（StepTimelineEntry.kind = "step" | "event"）、backend/app/modules/change/service.py:2341-2500（steps 侧已有 owner 事件注入的合并先例）。**与展示轮的差异**：分段展示第 4 段表述为「同一动作在两源各有一条时按源+稳定键去重合并为一行」——本决策将其精确化为「源内去重 + task-done 折叠 + 步骤/任务不合并」，未改变用户可见意图（消除两张重复时间线），但去掉了原表述中不可实现的跨源合并承诺。
- 故障面: 步骤行与任务行并存时，用户可能仍觉得「task-06 完成」与清单里的「task-06」重复——以两者形态明显区分（时间轴 vs 勾选清单、清单带进度比与提交锚）缓解；若实测仍觉重复，复潮路径见复潮条件。
- 退役判据: 若后端在 steps 与 tasks 之间建立显式外键（步骤记录引用 task id），跨源合并可由数据保证而重启。
- 模块域: frontend

## D-015@v1: tab 集只由「归档与否」两态决定；thin 不特判（修正展示轮表述）
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: 轻量变更（thin，无五阶段、steps 恒空）在新 tab 结构下如何收窄？
- answer: 我的判断——thin 不特判，在途态一律四 tab（概览/产出/过程/文件与对账），仅归档态收窄为三 tab（见 D-007）。依据：后端合成时间线文档明示 thin 的 steps 恒空、**主线叙事由观测事件流承担**（backend/app/modules/change/timeline.py:1-5 文档原文），若按展示轮所说把「过程」tab 从 thin 收窄掉，等于把 thin 唯一的叙事面藏起来；而 tab 级若再按「有无数据」动态收窄，会造成导航漂移（tab 随数据到达出现/消失）。
- normalized_requirement: tab 集的判定输入只有 isTerminalChange 一个布尔（归档 → 隐藏「文件与对账」）；thin 与完整流程在途态渲染同一套四 tab；面板内部仍按组级「有数据才渲染」控制密度。
- impacts: [FR-02, FR-07, task-02, task-07]
- evidence: backend/app/modules/change/timeline.py:1-5（thin 进度不落 sillyspec.db、steps 恒空、主线叙事由观测事件流承担）；frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:337-364（thin 出身当前已改渲染轻量流程条）+ :436-475（步骤时间线对 thin 整卡隐藏——即 thin 侧本来就没过程面可看，收窄「过程」会连带藏掉事件叙事）。**与展示轮的差异**：分段展示第 5 段「我替你做的决定」第 4 条原表述为「轻量变更标签页收窄为概览/产出/文件与对账」——本决策改为「thin 不特判、与在途完整流程同四 tab」。
- 故障面: thin 在途的「产出」tab 可能近乎空（无 FR/决策，仅知识触达）——由组级空态承载，不出现整 tab 白屏（设计已要求面板内空态文案）。
- 退役判据: 若 thin 的 steps 不再恒空（CLI 为轻量变更落 progress steps），thin 与完整流程的展示差异自然消失，本决策退化为无特殊处理。
- 模块域: frontend

## D-016@v1: Design Grill 首轮修订的契约补录（移动端页模块导出 / 合并边界输入类 / 错误分支与深链钳制）
- type: consistency
- priority: P0
- status: accepted
- source: code
- question: 独立设计审查（Design Grill，specVerdict=fail）指出的 1 项阻断与 5 项 P2，本设计如何处置？
- answer: 我的判断——逐条补录为可测契约（修订明细见 design.md「审查修订记录」表）：①**B-1（阻断，修正 D-011 枚举不全）**：移动端 `frontend/src/components/mobile/mobile-change-detail.tsx:66-67` 还从本变更要重写的 `[cid]/page.tsx:64` 导出里 import `isTerminalChange`（移动端注释自称「从桌面详情页 import 复用」），原兼容清单只列 7 个组件符号（`:71-77`）漏了页模块导出——补「逐符号 import 面表 + 页模块导出契约」，并在页面级测试加导出在场断言；②**B-2（细化 D-014 口径）**：三个未闭合输入类的显式取舍——非 ISO `completed_at` 残留原串（schema.py:58）排序前先做可解析判定、不可解析与无时间戳同置末尾；事件键同键碰撞保留去重并声明取舍（不用序号后缀）；task-done 推断断裂后任务行显示「时刻不可推断（观测断链）」而非裸 `?`；③**B-3（细化 D-001/D-003）**：资产卡主查询 `isError` 由「整卡 return null」改为分区级错误说明，归档态资产查询失败时「归档留档」MUST 保底渲染；④**B-4（D-009 承接补笔）**：`ChangeAgentRunLog` 维持桌面不挂载、仅移动端承载，并对 FR-styles-011 的该分句在承接表落笔；⑤**B-5（细化 D-013）**：`?tab=files` 不在 `visibleTabs` 时（归档态或切换变更残留）以 `router.replace` 钳回 `overview`；⑥**B-6**：原型↔design 三处双向差异一律以批准稿为准，R-02 的时间线限高折叠为唯一「实现严于原型」项。
- normalized_requirement: design.md 兼容策略 MUST 含逐符号 import 表（含页模块导出行）；Phase 3 MUST 含三输入类取舍表；Phase 2 MUST 含图谱/资产卡错误分支与归档保底渲染契约；兼容策略 MUST 含 `?tab=` 非法/收窄钳制规则；上述各项 MUST 各配单测断言。
- impacts: [FR-03, FR-04, FR-05, FR-09, FR-14]
- evidence: 独立审查子代理 review.json（`.sillyspec/.runtime/stage-reviews/brainstorm-review-2026-10-15-235209/review.json`）逐条 checklist 与 B-1~B-6 blocker；锚点 backend/app/modules/change/schema.py:58,951-957、backend/app/modules/change/timeline.py:113-117、frontend/src/components/mobile/mobile-change-detail.tsx:66-82、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx:64、frontend/src/components/changes/detail/change-assets-card.tsx:181。
- 故障面: 若「保底渲染归档留档」在资产主查询失败时仍依赖同一失败查询，则保底无效——实现 MUST 让归档留档走其自身的 patch 摘要取数路径。
- 退役判据: 无。
- 模块域: frontend
