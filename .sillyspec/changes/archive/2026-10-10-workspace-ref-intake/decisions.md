---
author: qinyi
created_at: 2026-10-10 11:53:45
generated_by: sillyspec-fourpiece-init
change: 2026-10-10-workspace-ref-intake
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 引用标签类型图标采用 B 角标悬浮
- type: term
- priority: P2
- status: accepted
- source: user
- question: 标签图标 A（emoji 内嵌 token 文本）还是 B（lucide 角标悬浮）？
- answer: 用户在原型 A/B 切换对比后选 B（2026-10-10 AskUserQuestion）。
- normalized_requirement: 镜像高亮层 token 背景块左上角挂 lucide 类型角标（文件 FileText / 目录 Folder / 代码块 Braces / 附件 Paperclip），角标不进文本流；token 文本保持纯文本【名称】形态。
- impacts: [FR-03]
- evidence: .sillyspec/explore/prototype-ws-ref-intake.html（A/B 切换演示）；frontend/src/components/daemon/input-ref-overlay.tsx:153（× 角标同款视觉语言）
- 故障面: 角标 absolute 定位若引入 stacking context 会使 z-20 失效（同 × 角标既有约束，注释已警示）
- 退役判据: 若后续标签升级为富文本内联组件，角标机制随 overlay 方案一并退役

## D-002@v1: 选区引用本期只覆盖代码/纯文本预览分支
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: .md 预览走 MarkdownText 富文本渲染、无行号概念，选区引用是否覆盖？
- answer: 用户确认本期只做代码（SyntaxHighlighter）与纯文本（pre）分支；.md 富文本态不做选区引用，后续需要再补「源码视角」。
- normalized_requirement: FilePreview 仅代码/纯文本分支加行号与选区右键；.md/图片/PDF/二进制分支无选区入口（树右键引用整个 .md 文件不受影响）。
- impacts: [FR-04, FR-05]
- evidence: frontend/src/components/explorer/file-preview.tsx:418-454（按类型分发：md→MarkdownText、代码→SyntaxHighlighter、兜底 pre）；用户回答轮 2026-10-10
- 故障面: 用户在 .md 预览选中文字右键无菜单，可能误以为功能失效（tooltip/引导文案缓解）

## D-003@v1: 引用为「指向」语义——只存路径+行号，不嵌选中文本快照
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 代码块引用发送时是否把选中文本一并嵌入正文？
- answer: 不嵌入。token 置换为 [代码引用:wid|path|L起-L止]，智能体按路径+行号自读最新内容（原型确认轮）。
- normalized_requirement: 发送正文只含路径+行号引用标记；文件被删/改后引用可能失效，由智能体读取时自然报错（显式接受）。
- impacts: [FR-06]
- evidence: .sillyspec/changes/archive/2026-10-09-attachment-inline-reference/design.md:67（同构文本协议先例）；.sillyspec/explore/prototype-ws-ref-intake.html（发送置换演示）
- 故障面: 发送后文件内容变化，智能体读到的是新内容而非用户选择时的内容（接受：引用语义即指向）
- 退役判据: 若用户反馈需要快照语义，再评估嵌入文本或版本号锚定

## D-004@v1: 正式引用文本协议三类标记，后端零改动
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 工作区文件引用的正式文本格式与后端改动面？
- answer: 复用附件引用的正文透传机制，扩展三类标记：[文件引用:wid|path] / [目录引用:wid|path] / [代码引用:wid|path|L起-L止]；wid=工作区 id，path=相对工作区根 POSIX 路径；后端/API/schema 零改动。
- normalized_requirement: 三类标记随消息正文原样透传；前端历史渲染解析三类标记为可点击标签。
- impacts: [FR-06, FR-07]
- evidence: frontend/src/lib/attachment-refs.ts:59-93（substituteAttRefsForSend 同构）；frontend/src/lib/explorer.ts:45-61（wid+path 既有寻址坐标）
- 故障面: 协议字面被用户手改正文破坏 → 解析不命中降级为纯文本显示（与附件引用孤儿降级同口径）
- 退役判据: 若未来引用升级为结构化消息块（非文本协议），三类标记整体退役

## D-005@v1: 附件 token 与工作区引用 token 序号池合并
- type: compatibility
- priority: P1
- status: accepted
- source: code
- question: 附件引用 token【name】与工作区文件引用 token【name】同形态，同名如何唯一化？
- answer: 唯一化分配池合并两类 token（附件 id 映射 + 工作区引用映射共用 existingTokens 并集）；序号按「完整显示基名」分配——显示文本不同（如文件 design.md vs 代码块 design.md:10-16）不加序号，完全相同才 ·2 起。
- normalized_requirement: allocate 接口接收「正文已出现 token 并集」（跨附件/工作区两类），显示基名=名称+(行号段)；原型已实测同名不同路径 design.md → ·2 正确。
- impacts: [FR-02]
- evidence: frontend/src/lib/attachment-refs.ts:34-43（allocateAttRefToken 既有池）；.sillyspec/explore/prototype-ws-ref-intake.html allocSeq/baseOf（实测 ·2 与免序号两种路径）
- 故障面: 两池若漏合并，同名附件+同名文件引用 token 文本撞车，置换时错绑
- 退役判据: 两类 token 若改为不同括号形态（如工作区引用用『』），池分离后本决策退役

## D-006@v1: 预览区无选区右键不拦截；非文本分支无选区功能
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 预览区右键菜单的触发边界？
- answer: 仅当预览内容区存在非折叠选区且落在行元素内才拦截右键弹自定义菜单；无选区/选区在行号槽外不拦截（浏览器默认菜单）；图片/PDF/二进制分支永不拦截。
- normalized_requirement: contextmenu 处理器先验 selectionLineRange()，null 即放行默认行为。
- impacts: [FR-05]
- evidence: .sillyspec/explore/prototype-ws-ref-intake.html selectionLineRange（原型实测无选区右键为浏览器默认菜单）
- 故障面: 用户期望无选区也能右键添加整个文件——本期预览区菜单只有选区项（整文件入口在文件树右键），引导文案说明

## D-007@v1: 预览区行号为本变更前置改动（纳入本变更范围）
- type: premise
- priority: P1
- status: accepted
- source: code
- question: 行号是选区引用的前置（行号换算+用户可见行范围），是否独立变更先做？
- answer: 纳入本变更：FilePreview 代码分支开 showLineNumbers、纯文本分支加行号槽；行号列 user-select:none 保证选区锚点落在内容区。
- normalized_requirement: 代码/纯文本两分支行号可见且不可选中；行号换算按选区起止行元素 data-line 实际文档位置（非文本匹配，防文件内重复内容歧义）。
- impacts: [FR-04, FR-05]
- evidence: frontend/src/components/explorer/file-preview.tsx:418-454（现无 showLineNumbers/无行号）
- 故障面: SyntaxHighlighter 行号渲染与既有样式（oneDark、fontSize 12）冲突需实测校准
- 退役判据: 行号成为通用诉求时升级为 FilePreview 常驻能力（本就是），无退役场景

## D-008@v1: 接入范围为单聊+预会话+群聊三输入区（与附件引用同范围）
- type: boundary
- priority: P1
- status: superseded
- source: user
- question: 三类输入区（单聊 session-input-bar / 群聊 group-chat-panel / 预会话）是否都接入？
- answer: 全接入，与 2026-10-09-attachment-inline-reference 同范围（群会话同样能进左栏文件树，预会话有 workspaceId 即可用）；发送置换接线沿用其 R-04 盘点的 8 处组装位。
- normalized_requirement: 三输入区右键插入/镜像层/退格/置换行为一致；8 处组装位（含定时发送/团队直发）全量接线。
- impacts: [FR-01, FR-02, FR-06]
- evidence: .sillyspec/changes/archive/2026-10-09-attachment-inline-reference/design.md:144（R-04 组装位清单）；frontend/src/components/sessions/sessions-portal.tsx:729-747（文件树入口对群/单聊均可达）
- 故障面: 组装位旁路遗漏导致 token 未置换直发（沿用 R-04 风险，plan 按清单逐点位落任务）
- 复潮条件: 无（范围决策，三输入区不一致即回归）

## D-008@v2: 组装位以 grep 实测现状为准（7 处，非 R-04 旧记 8 处）
- type: compatibility
- priority: P1
- status: accepted
- supersedes: D-008@v1
- source: design-grill
- question: D-008@v1 引用的「8 处组装位」与当前代码不符？
- answer: 2026-10-10 独立审查（review-2026-10-10-131956 UB-1）grep 实测 substituteAttRefsForSend 调用点 7 处：session-panel-dialog.tsx:312/392/1343、session-panel-page.tsx:835/2748/3258、group-chat-panel.tsx:1969（2026-10-09 R-04 记 8 处已漂移）。
- normalized_requirement: 接线锚定规则=在每个 substituteAttRefsForSend 调用点同点位串联 substituteWsRefsForSend；plan 落卡前必须 grep 重盘核对（代码演进防漂移）。
- impacts: [FR-06, task-09]
- evidence: frontend/src/components/daemon/session-panel/session-panel-dialog.tsx:312（grep 2026-10-10）；.runtime/stage-reviews/review-2026-10-10-131956/review.json（UB-1）
- 故障面: 照抄旧清单漏接新点位（如 dialog:1343）导致该路径 token 直发
- 退役判据: 无（与 D-008@v1 同生命周期）

## D-009@v1: 实现架构=扩展附件引用库（方案 A）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 工作区文件/选区引用的实现架构（A 扩展 attachment-refs 库复用镜像层 / B 独立两套 / C 独立 chips 通道）？
- answer: 用户选 A（2026-10-10 方案选择轮）：扩展 frontend/src/lib/attachment-refs.ts 纯函数库 + 复用 InputRefOverlay——附件与工作区引用共用同一 token 机制/退格/角标；序号池合并（D-005）在同库自然落地；原型即此方案已实测。
- normalized_requirement: 工作区引用 token 的构建/分配/剥离/置换/解析函数落在 attachment-refs.ts（或其同族新文件但共享池与镜像层组件）；InputRefOverlay 扩展类型角标（D-001）而不复制。
- impacts: [FR-02, FR-03, FR-06, FR-07]
- evidence: .sillyspec/explore/prototype-ws-ref-intake.html（方案 A 全链路实测）；frontend/src/lib/attachment-refs.ts（扩展基座）
- 故障面: 函数签名需同时容纳 uuid 锚（附件）与 wid+path 锚（工作区），泛化不当会复杂化既有附件路径（设计时统一为「引用描述符」结构化解耦）
- 退役判据: 若附件与工作区引用未来分化为不同编辑器体系，再评估拆库

## D-010@v1: 方案 B（独立两套库+Overlay）——落选
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: 同 D-009。
- answer: 否决理由：镜像层版式对齐/退格整删/×角标机制全部重复实现两份，同名序号池（D-005）要跨库协调反而更难，改动面与维护成本双升。
- normalized_requirement: 不采用独立 workspace-refs.ts + WorkspaceRefOverlay 并行两套的架构。
- impacts: []
- evidence: 2026-10-10 方案选择轮对比表
- 复潮条件: 附件引用与工作区引用的编辑行为出现实质分化（如一方升级富文本另一方保持纯文本），共用机制成为耦合负担时

## D-011@v1: 方案 C（独立 chips 通道，不走正文 token）——落选
- type: architecture
- priority: P0
- status: rejected
- source: user
- question: 同 D-009。
- answer: 否决理由：引用脱离正文流，无法在正文中标记「这句话说的是哪个文件」（指代位置感丢失）；与用户确认的原型形态（正文内标签）和附件引用先例割裂。
- normalized_requirement: 不采用输入框上方独立 chips 行承载工作区引用的架构。
- impacts: []
- evidence: 2026-10-10 方案选择轮对比表
- 复潮条件: 正文内 token 机制被证不可维护（如错位问题无法收敛）且用户接受指代位置感降级时


## D-012@v1: 槽位透传经 SessionPanel 分发器（index.tsx）——plan allowed_paths 通道缺口补齐
- type: compatibility
- priority: P2
- status: accepted
- source: execute-field
- question: task-06（sessions-portal 下发槽位）与 task-07（page/dialog 面板透传槽位到 SessionInputBar）的 allowed_paths 均不含 session-panel/index.tsx（SessionPanel 分发器）与 page-helpers.tsx（SessionPanelPageProps 所在），但 portal → SessionPanel(mode=page) → SessionPanelPage → SessionInputBar 的 props 链必须经分发器透传——plan 遗漏通道文件。
- answer: 按 design 接口定义的 props 正路实现：index.tsx SessionPanelProps 增两个可选 prop（pendingWsRefInsert/onPendingWsRefInsertHandled）并在 page 分支显式透传（dialog 分支既有 {...props} spread 自动携带）；槽位类型 interface 定义在 session-panel-page.tsx（task-07 allowed_paths 内）随签名并入，page-helpers.tsx 不动。
- normalized_requirement: 允许 task-07 在 session-panel/index.tsx 增加 ≤6 行纯透传（零业务逻辑、可选 prop、未传零回归）；类型定义不落 page-helpers.tsx。
- impacts: [task-06, task-07]
- evidence: frontend/src/components/daemon/session-panel/index.tsx（SessionPanel 分发器 page 分支逐 prop 显式透传形态）；design.md 接口定义（SessionInputBar props 契约）
- 故障面: 透传遗漏会让 portal 下发的槽位在分发器层断链（输入区收不到）——sessions-portal 测试覆盖三分支断言兜底
- 复潮条件: SessionPanel 分发器改 context/重构时重新评估

## D-013@v1: 预览区右键菜单内联实现（不复用 floating-context-menu）
- type: architecture
- priority: P2
- status: accepted
- source: design-grill
- question: design 文件清单称通用菜单组件「树/预览两消费点」，实现中预览区自建 SelectionContextMenu？
- answer: execute 验收评审偏差 1（execute-review-2026-10-10-164613）：task-02 与 task-03 同 Wave 并行，预览区内联实现避免对并行新建组件的运行时依赖；同为看板 fixed div 同模式，行为等价。
- normalized_requirement: 两菜单组件并存；后续若统一收敛为 floating-context-menu 单一消费面，属独立重构变更。
- impacts: [task-02, task-03]
- evidence: frontend/src/components/explorer/file-preview.tsx（SelectionContextMenu 内联）；frontend/src/components/ui/floating-context-menu.tsx（树消费）
- 故障面: 两处菜单样式/行为漂移（接受：体量小，视觉走同一 token 体系）
- 退役判据: 第二个菜单需求出现时统一收敛

## D-014@v1: FR-07 历史渲染内聚至 InlineAttRefTextWithPreview（turn-segment-views 零改动）
- type: architecture
- priority: P2
- status: accepted
- source: design-grill
- question: design 计划修改 turn-segment-views.tsx 接 onOpenWsRef，实现零改动该文件？
- answer: execute 验收评审偏差 2：组件内部升级（InlineAttRefText 换 parseInlineRefs + WithPreview 按 kind 分流 fetchDownload/mime=null）使单聊+群聊全部既有消费点自动获得三类渲染，覆盖面优于逐点接线。
- normalized_requirement: 历史三类标签渲染能力以 InlineAttRefTextWithPreview 为单一出口；新增消费点直接复用。
- impacts: [task-09]
- evidence: frontend/src/components/daemon/attachment-ref-tag.tsx:112（parseInlineRefs/onOpenWsRef 分流）
- 故障面: 组件承担多职责（解析+预览分流）；可接受（与附件引用先例同构）
- 退役判据: 若预览分流逻辑复杂化再拆独立 hook
