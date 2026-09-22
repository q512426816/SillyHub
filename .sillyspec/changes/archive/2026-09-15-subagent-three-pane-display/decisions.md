---
author: qinyi
created_at: 2026-09-15 17:25:00
---

# Decisions — 2026-09-15-subagent-three-pane-display

## D-001@v1 子代理三分栏交互模型（用户原话确认）

- **type**: requirement
- **status**: confirmed
- **source**: user
- **question**: 子代理内容展示的布局与三栏互斥语义？
- **answer**: 三分栏——和工作区文件预览一个样：点击子代理把内容展开到最右侧栏；若此时打开了文件，文件覆盖最右侧栏（按最后触发的覆盖）。子代理内容与格式和主会话一致，只是不支持继续对话。中间会话栏子代理只展示是否运行中 + 运行时间。
- **normalized_requirement**: 右栏单槽位（文件预览/子代理详情互斥，后触发覆盖）；右栏=子代理完整时间线（无输入框）；中栏=紧凑卡片（状态+时长）。
- **impacts**: sessions-portal 槽位状态；session-panel-page 面板渲染；turn-segment-views 卡片化；turn-timeline 过滤放宽。
- **evidence**: 用户原始需求（brainstorm Step 3 输入原话逐条转写）。
- **priority**: P0
- 锚点: frontend/src/components/sessions/sessions-portal.tsx:filePreview
- 模块域: frontend

## D-002@v1 默认视图行为补全（AI 补全，验收可否决）

- **type**: requirement
- **status**: confirmed
- **source**: agent
- **question**: 对话视图（默认）里子代理如何出现？子代理目录点击行为？重复点击已激活卡片？
- **answer**: ①对话视图过滤放宽——子代理容器段以紧凑卡片进入对话流（原为整体过滤）；②进度视图同卡片，两视图一致；③子代理目录点击 = 直接开右栏（page 模式），不再切视图+DOM 定位，旧定位逻辑留 dialog 回退；④重复点击已激活卡片 = 关闭面板（toggle）。
- **normalized_requirement**: 两视图中栏子代理均为紧凑卡片无内联细节；目录联动右栏；toggle 关闭。
- **impacts**: turn-timeline.tsx 过滤条件；session-panel-page.tsx handleJumpToSubagent 双路径。
- **evidence**: brainstorm Step 5 设计确认轮，转写自用户"中间会话栏不需要展示细节"的语义延伸；design §8 风险表已列"对话视图混入非对话元素"取舍。
- **priority**: P1
- 锚点: frontend/src/components/daemon/turn-timeline.tsx:textSegments
- 模块域: frontend

## D-003@v1 方案 A：右栏单槽位复用文件预览三栏机制

- **type**: architecture
- **status**: confirmed
- **source**: user
- **question**: 子代理完整内容的展示载体用哪种方案？
- **answer**: 方案 A——右栏单槽位复用文件预览三分栏机制（portal 双向清零实现互斥：点文件清 subagentView / 点子代理清 filePreview）；子代理面板渲染归属 session-panel-page（活数据在 displayTurns），根 flex 行 + PanelResizer + 自有 usePanelWidth 读同一 LS 键。B Drawer 与 C 中栏就地展开均违反"和文件预览一个样"。
- **normalized_requirement**: 单槽位互斥不靠同一列二选一渲染，靠 portal 双向清零；面板随 SessionPanel 内部渲染（数据归属决定）。
- **impacts**: 新增 subagent-panel-context.ts/subagent-detail-panel.tsx；改 sessions-portal/session-panel(index+page)/turn-segment-views/turn-timeline ≈6 文件。
- **evidence**: 用户原始需求指定"和工作区文件预览一个样"（brainstorm Step 4）；Design Grill X-001/X-002 修正单槽位实现表述。
- **priority**: P0
- 锚点: frontend/src/components/daemon/session-panel/session-panel-page.tsx:handleJumpToSubagent
- 模块域: frontend
- 故障面: 面板随 SessionPanel 渲染——根 flex 改造可能破坏高度链（dialog/空态消费方）；缓解：仅 openSubagentId 非空时切换根布局，props 未传零变化。
- 退役判据: 若未来子代理有独立会话/端点（数据不再内嵌主 turnState），面板可上提 portal 右栏统一渲染，context 供数机制可删。
- 否决理由(被拒方案): B 独立 Drawer——与文件预览交互不一致且遮罩中栏；C 中栏就地展开——长内容撑爆时间线且无法满足覆盖语义。
- 复潮条件(被拒方案): 若右栏改造成多槽位（同时文件+子代理），C 的"就地展开"可在中栏作为辅助形态复潮。
