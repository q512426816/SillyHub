---
author: sillyspec-fr-index
created_at: 2026-10-08T03:33:17.438Z
---

# FR 索引 — auto-frontend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-frontend-123 悬停窄轨刻度展开浮层后，浮层内当前指向的轮次行有可见指向标记（与 activeTurnKey 当前轮高亮视觉区分）
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：悬停刻度看浮层标记；指向行与当前轮同行
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-01
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「悬停刻度展开浮层后浮层内指向行有可见指向标记（与 active 高亮区分）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-124 指向标记随鼠标在刻度间/浮层行间移动实时跟随更新
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：刻度滑动跟随；浮层行同步
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-02
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「指向标记随刻度滑动与浮层行 hover 实时跟随」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-125 浮层内指向行超出可视区时自动滚入（block:nearest，不抢既有 active 联动语义之外的新滚动）
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：长会话指向滚入
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-03
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「指向行滚入可视区（scrollIntoView block:nearest，指向优先回落 active）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-126 鼠标移开组件后指向标记清除，既有展开/收起/pin/跳转/aria 行为零回归
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：移开清除
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-04
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-04
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「移开组件防抖到点清指向；收起点同步清除；既有行为零回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-127 turn-nav-list 组件单测覆盖上述新行为且既有用例全绿
变更：2026-10-08-turn-nav-hover-mark
状态：active
摘要：测试全绿
全文：.sillyspec/changes/archive/2026-10-08-turn-nav-hover-mark/requirements.md#FR-05
最近确认：001bcc6c693cc7947ce9318ca0c016410ed8a916

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-turn-nav-hover-mark:flow:测试绑定FR-05
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「turn-nav-list 既有用例全绿（vitest run 全文件）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-turn-nav-hover-mark
  status: active

## FR-auto-frontend-128 卡片正文 markdown 渲染
变更：2026-09-23-md-card-render
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given scan-docs 或 knowledge 页选中一份含表格/列表/加粗/行内代码的 md 文档；When 切换到「卡片」视图；Then 每张小节卡/单卡的正文按 markdown 正常渲染（表格 th/td、列表、加粗、行内 code 生效），且渲染**必须**经统一 rehype-saniti
全文：.sillyspec/changes/archive/2026-09-23-md-card-render/requirements.md#FR-01
最近确认：322c55edd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-23-md-card-render:task-01:acc-0-5268d069
  tests: frontend/src/components/knowledge/__tests__/card-markdown.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-01:acc-1-b237c25a
  tests: frontend/src/components/knowledge/__tests__/card-markdown.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-01:acc-2-c1042aed
  tests: frontend/src/components/knowledge/__tests__/card-markdown.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-01:acc-3-ef076ca2
  tests: frontend/src/components/knowledge/__tests__/card-markdown.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-02:acc-0-42de4f98
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-02:acc-1-2e486057
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-02:acc-2-f1575d52
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-02:acc-3-45b95137
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active
- row: 2026-09-23-md-card-render:task-02:acc-4-539d3b5a
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-23-md-card-render
  status: active

## FR-auto-frontend-129 卡片头视觉重构（manual 小节卡与 SingleCard）
变更：2026-09-23-md-card-render
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 卡片视图渲染一张小节卡或整文件单卡；When 卡片展示；Then 卡片左侧**必须**有 3px 品牌色条（brand-600 语义阶）、头部为 brand-50 底色带、小节标题 brand-700 加粗、右侧**必须**有
全文：.sillyspec/changes/archive/2026-09-23-md-card-render/requirements.md#FR-02
最近确认：322c55edd

## FR-auto-frontend-130 frontmatter 元信息条（含降级）
变更：2026-09-23-md-card-render
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 文档含 frontmatter（author / created_at 字段）；When 卡片头渲染；Then 头部下方显示一行小字元信息（✍ 作者 · 收录时间）；frontmatter 缺失或字段缺失时该行**必须**整体隐藏，**禁止**渲染空行、**禁止**抛错；
全文：.sillyspec/changes/archive/2026-09-23-md-card-render/requirements.md#FR-03
最近确认：322c55edd

## FR-auto-frontend-131 既有交互零回归
变更：2026-09-23-md-card-render
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 卡片模式完成改造；When ① 从知识库 INDEX 路由行点击跳转目标条目锚点；② 顶栏切换 blue / ai-native 主题；Then ① 页面**必须**滚动定位到目标卡片（data-entry-anchor + scrollIntoView 保留有效）；② 品牌色条/表头色/头底色**必须*
全文：.sillyspec/changes/archive/2026-09-23-md-card-render/requirements.md#FR-04
最近确认：322c55edd

## FR-auto-frontend-132 力场收敛后停止 stepForceLayout 步进（连续帧守卫防转折点误判）
变更：2026-10-09-graph-raf-settle
状态：active
摘要：页面开着不再恒耗 CPU
全文：.sillyspec/changes/archive/2026-10-09-graph-raf-settle/requirements.md#FR-01
最近确认：e39d596092c4282b08b7d04a889b7a0ae1282d34

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-raf-settle:flow:测试绑定FR-01
  tests: test/frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「收敛帧数守卫常量：连续帧数 ≥30（转折点零速误判防线）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-raf-settle
  status: active

## FR-auto-frontend-133 收敛定格终局 fitView + tick 语义承接
变更：2026-10-09-graph-raf-settle
状态：active
摘要：未交互的收敛定格
全文：.sillyspec/changes/archive/2026-10-09-graph-raf-settle/requirements.md#FR-02
最近确认：e39d596092c4282b08b7d04a889b7a0ae1282d34

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-raf-settle:flow:测试绑定FR-02
  tests: test/frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「全节点位移为零（x==px）判静止；单节点位移超阈值判未静止」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-raf-settle
  status: active

## FR-auto-frontend-134 数据重建与节点拖拽重启力场
变更：2026-10-09-graph-raf-settle
状态：active
摘要：拖放节点后重收敛
全文：.sillyspec/changes/archive/2026-10-09-graph-raf-settle/requirements.md#FR-03
最近确认：e39d596092c4282b08b7d04a889b7a0ae1282d34

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-raf-settle:flow:测试绑定FR-03
  tests: test/frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「阈值参数生效：位移恰在阈值内/外两态；NaN 坐标防御性判未静止」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-raf-settle
  status: active

## FR-auto-frontend-135 判定提取导出纯函数 forceSettled 供测试；恢复被冲掉的 shouldAutoRefit 用例
变更：2026-10-09-graph-raf-settle
状态：active
摘要：相关面全绿
全文：.sillyspec/changes/archive/2026-10-09-graph-raf-settle/requirements.md#FR-04
最近确认：e39d596092c4282b08b7d04a889b7a0ae1282d34

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-raf-settle:flow:测试绑定FR-04
  tests: test/frontend/src/components/knowledge/__tests__/graph-canvas.test.ts「shouldAutoRefit 两用例（恢复）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-raf-settle
  status: active

## FR-auto-frontend-136 neighbors/impact/path 查询执行后，若结果节点集中含锚点节点（id 精确或 CLI 模糊解析回填的 query.key/anchor），该节点自动为选中态（选中环+一跳邻域高亮+右栏切节点详情）
变更：2026-10-09-graph-query-ux
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-graph-query-ux/requirements.md#FR-01
最近确认：0c2a8bd2264230f90dbcfc4199d33c88a325750b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-query-ux:flow:测试绑定FR-01
  tests: frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx「锚点自动选中」用例
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-query-ux
  status: active

## FR-auto-frontend-137 锚点不在结果集中时不报错不高亮（如 node_not_found 降级提示沿既有）
变更：2026-10-09-graph-query-ux
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-graph-query-ux/requirements.md#FR-02
最近确认：0c2a8bd2264230f90dbcfc4199d33c88a325750b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-query-ux:flow:测试绑定FR-02
  tests: frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx「sub 人话说明」用例
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-query-ux
  status: active

## FR-auto-frontend-138 sub 下拉每个选项悬浮（title）显示人话说明（孤儿节点=没人引用的知识条目…七条）
变更：2026-10-09-graph-query-ux
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-graph-query-ux/requirements.md#FR-03
最近确认：0c2a8bd2264230f90dbcfc4199d33c88a325750b

## FR-auto-frontend-139 选中 sub 后下拉下方显示一行动态说明文案（同 tooltip 内容）
变更：2026-10-09-graph-query-ux
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-graph-query-ux/requirements.md#FR-04
最近确认：0c2a8bd2264230f90dbcfc4199d33c88a325750b

## FR-auto-frontend-140 既有 16 页面用例零回归+新增用例（自动选中断言+说明文案断言）；tsc/eslint 零错
变更：2026-10-09-graph-query-ux
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-graph-query-ux/requirements.md#FR-05
最近确认：0c2a8bd2264230f90dbcfc4199d33c88a325750b

## FR-auto-frontend-141 单聊输入栏（session-input-bar）待发附件 chip 点击文件名区打开 FilePreviewModal 在线预览（复用已发送附件的 fetchAttachmentBlob + officeSource 链路）
变更：2026-10-09-pending-attachment-preview
状态：active
摘要：上传后未发送点击预览
全文：.sillyspec/changes/archive/2026-10-09-pending-attachment-preview/requirements.md#FR-01
最近确认：2c168156b0f004d395095ee5e3739f8b3719d795

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-pending-attachment-preview:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx「点击文件名区打开 FilePreviewModal 在线预览」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-pending-attachment-preview
  status: active

## FR-auto-frontend-142 群聊面板（group-chat-panel）待发附件 chip 同样支持点击预览
变更：2026-10-09-pending-attachment-preview
状态：active
摘要：群聊待发附件点击预览
全文：.sillyspec/changes/archive/2026-10-09-pending-attachment-preview/requirements.md#FR-02
最近确认：2c168156b0f004d395095ee5e3739f8b3719d795

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-pending-attachment-preview:flow:测试绑定FR-02
  tests: frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx「待发附件 chip 点击在线预览（2026-10-09-pending-attachment-preview）：FilePreviewModal 打开」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-pending-attachment-preview
  status: active

## FR-auto-frontend-143 预览与移除互不干扰：点击 X 删除附件不触发预览，点击预览不影响删除
变更：2026-10-09-pending-attachment-preview
状态：active
摘要：点 X 删除不开预览
全文：.sillyspec/changes/archive/2026-10-09-pending-attachment-preview/requirements.md#FR-03
最近确认：2c168156b0f004d395095ee5e3739f8b3719d795

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-pending-attachment-preview:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx「点 X 删除附件不触发预览」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-pending-attachment-preview
  status: active

## FR-auto-frontend-144 既有上传/移除/发送行为零回归，相关测试全绿
变更：2026-10-09-pending-attachment-preview
状态：active
摘要：零回归验证
全文：.sillyspec/changes/archive/2026-10-09-pending-attachment-preview/requirements.md#FR-04
最近确认：2c168156b0f004d395095ee5e3739f8b3719d795

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-pending-attachment-preview:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx「一次选 12 个文件：toast 告知忽略多余的 2 个，只上传前 10 个」 | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-pending-attachment-preview
  status: active
