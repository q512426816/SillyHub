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

## FR-auto-frontend-141 thin 出身变更（isThinLineageChange 判定）详情页不再渲染「步骤时间线」卡，含归档补种 steps 场景
变更：2026-10-09-thin-hide-step-timeline
状态：active
摘要：归档 thin 补种 steps；在途 thin
全文：.sillyspec/changes/archive/2026-10-09-thin-hide-step-timeline/requirements.md#FR-01
最近确认：bb504f72b29ed001ef798b89b79e99bc8ce9b830

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-thin-hide-step-timeline:flow:测试绑定FR-01
  tests: frontend/src/components/mobile/mobile-change-detail.test.tsx「归档 thin（stage=archived + steps 无标准四阶段痕迹）→ 轻量说明卡而非「无可审批」
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
  source_change: 2026-10-09-thin-hide-step-timeline
  status: active

## FR-auto-frontend-142 非 thin 厚变更步骤时间线卡行为不变，仍正常渲染 steps 明细
变更：2026-10-09-thin-hide-step-timeline
状态：active
摘要：厚变更带 steps
全文：.sillyspec/changes/archive/2026-10-09-thin-hide-step-timeline/requirements.md#FR-02
最近确认：bb504f72b29ed001ef798b89b79e99bc8ce9b830

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-thin-hide-step-timeline:flow:测试绑定FR-02
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx「共存（厚变更）：steps 含标准阶段痕迹 + 观测数据 → 步骤时间线卡与真实留痕时间线卡双卡渲染」
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
  source_change: 2026-10-09-thin-hide-step-timeline
  status: active

## FR-auto-frontend-143 真实留痕时间线卡恒挂载行为不变（2026-09-27-timeline-coexist 共存语义保留）
变更：2026-10-09-thin-hide-step-timeline
状态：active
摘要：厚变更归档双卡共存
全文：.sillyspec/changes/archive/2026-10-09-thin-hide-step-timeline/requirements.md#FR-03
最近确认：bb504f72b29ed001ef798b89b79e99bc8ce9b830

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-thin-hide-step-timeline:flow:测试绑定FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx「FR-03（2026-09-26-change-real-timeline）：steps 为空时主线挂载真实留痕时间线卡」
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
  source_change: 2026-10-09-thin-hide-step-timeline
  status: active

## FR-auto-frontend-144 相关前端测试更新并通过（仅跑改动相关测试，不跑全量）
变更：2026-10-09-thin-hide-step-timeline
状态：active
摘要：定向测试
全文：.sillyspec/changes/archive/2026-10-09-thin-hide-step-timeline/requirements.md#FR-04
最近确认：bb504f72b29ed001ef798b89b79e99bc8ce9b830

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-thin-hide-step-timeline:flow:测试绑定FR-04
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx「本文件全部用例（vitest run 定向）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-pending-attachment-preview
  source_change: 2026-10-09-thin-hide-step-timeline
  status: active

## FR-auto-frontend-145 右击待发附件在正文末尾插入引用标签
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-006@v3
场景正文：
- 场景：默认场景 — Given 会话输入区存在至少一个已上传未发送的附件 chip；When 用户右击（contextmenu）该 chip；Then 插入位置=**失焦前记住的光标位**（右击附件必先使输入框失焦，onBlur 记忆 selectionStart；输入框仍聚焦时用当前光标位；从未聚焦过才插正文
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-01
最近确认：4050ee624

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-attachment-inline-reference:task-03:acc-0-5e531a62
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-03:acc-1-efb19665
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-05:acc-0-7fd44e56
  tests: frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active

## FR-auto-frontend-146 同名附件引用唯一化
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 已存在引用标签的附件名与本次右击的附件同名；When 插入新引用；Then 新引用自动加序号后缀（`【文件名·2】`、`【文件名·3】`…），保证正文内每个引用标签文本指代唯一附件；删除任一附件不改变其它（同名）附件已插入引用的文本
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-02
最近确认：4050ee624

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-attachment-inline-reference:task-01:acc-0-befb68d6
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx | frontend/src/components/daemon/__tests__/attachment-refs.test.ts | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-01:acc-1-87bcb059
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx | frontend/src/components/daemon/__tests__/attachment-refs.test.ts | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active

## FR-auto-frontend-147 编辑态引用标签的渲染与删除
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v2
场景正文：
- 场景：默认场景 — Given 正文含引用标签；Then 输入框镜像高亮层将其渲染为标签样式（品牌色底、圆角、右上角 × 角标）；点 × 角标删除该处一次出现；退格键在光标贴标签尾部且无选区时**一次删除整个标签**（
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-03
最近确认：4050ee624

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-attachment-inline-reference:task-02:acc-0-1dfd89f5
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-02:acc-1-3b4a90ee
  tests: frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active

## FR-auto-frontend-148 发送置换为 uuid 锚定正式引用
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 正文含引用标签且用户发送消息；When 发送组装 prompt；Then 每个可解析的编辑态 token 置换为 `[附件引用:<uuid>|<文件名>]`（uuid 与随消息附件、头部标记行对齐，同名附件可精确区分）；无法解析的孤儿
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-04
最近确认：4050ee624

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-attachment-inline-reference:task-04:acc-0-d7ea3659
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-04:acc-1-af4a2ac5
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active

## FR-auto-frontend-149 删除附件联动清空正文引用
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-004@v2
场景正文：
- 场景：默认场景 — Given 正文含某附件的引用标签；When 用户点该附件 chip 的 X 删除；Then 正文内该附件的全部引用标签同步移除，其它附件的引用不受影响
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-05
最近确认：4050ee624

## FR-auto-frontend-150 历史消息引用标签渲染与点击预览
变更：2026-10-09-attachment-inline-reference
状态：active
摘要：默认场景
依据决策：D-005@v2
场景正文：
- 场景：默认场景 — Given 历史消息正文含 `[附件引用:<uuid>|<文件名>]`；When 气泡正文渲染；Then 引用渲染为标签节点（蓝色主气泡内用白色半透明色调保证可读，D-005@v2），点击打开 FilePreviewModal 按 uuid 在线预览附件内容（与已发
全文：.sillyspec/changes/archive/2026-10-09-attachment-inline-reference/requirements.md#FR-06
最近确认：4050ee624

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-attachment-inline-reference:task-06:acc-0-297e9c56
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active
- row: 2026-10-09-attachment-inline-reference:task-06:acc-1-c1496481
  tests: frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-attachment-inline-reference
  status: active

## FR-auto-frontend-151 输入框内引用标签的×角标默认隐藏，鼠标移动到该标签上时才淡入显示（单聊+群聊）
变更：2026-10-10-att-ref-badge-hover
状态：active
摘要：悬停显示
全文：.sillyspec/changes/archive/2026-10-10-att-ref-badge-hover/requirements.md#FR-01
最近确认：b9b67aa80c9a306c4bfeeee1f03eaab6a192f7f0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-att-ref-badge-hover:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「角标默认隐藏、visibleBadgeIndex 命中才显示」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-att-ref-badge-hover
  status: active

## FR-auto-frontend-152 隐藏态不拦截点击（标签区域下方 textarea 的光标定位/选字不受影响），显示态可正常点击删除
变更：2026-10-10-att-ref-badge-hover
状态：active
摘要：隐藏态点击穿透
全文：.sillyspec/changes/archive/2026-10-10-att-ref-badge-hover/requirements.md#FR-02
最近确认：b9b67aa80c9a306c4bfeeee1f03eaab6a192f7f0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-att-ref-badge-hover:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「角标默认隐藏（opacity-0 + pointer-events-none），visibleBadgeIndex 命中才显示」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-att-ref-badge-hover
  status: active

## FR-auto-frontend-153 指针离开标签/输入区后角标隐藏；原×删除、退格整删、删附件联动行为零回归
变更：2026-10-10-att-ref-badge-hover
状态：active
摘要：移出隐藏
全文：.sillyspec/changes/archive/2026-10-10-att-ref-badge-hover/requirements.md#FR-03
最近确认：b9b67aa80c9a306c4bfeeee1f03eaab6a192f7f0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-att-ref-badge-hover:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「既有×删除回调行为不变」 | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx「× 角标删除该处一次出现；点 X 删附件联动剥离全部引用」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-att-ref-badge-hover
  status: active

## FR-auto-frontend-154 相关测试全绿+tsc 零错
变更：2026-10-10-att-ref-badge-hover
状态：active
摘要：验证通过
全文：.sillyspec/changes/archive/2026-10-10-att-ref-badge-hover/requirements.md#FR-04
最近确认：b9b67aa80c9a306c4bfeeee1f03eaab6a192f7f0

## FR-auto-frontend-155 enrichDisplayTurns 的 apiDurationMs 回填语义必须有行为测试锁定（上变更评审 P3）
变更：2026-10-10-turn-speed-enrich-backfill-test
状态：active
摘要：历史轮回填；实时值优先
全文：.sillyspec/changes/archive/2026-10-10-turn-speed-enrich-backfill-test/requirements.md#FR-01
最近确认：196c2280aeaf47428b5197da25e21c9224a890fc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-turn-speed-enrich-backfill-test:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/page-helpers-enrich-api-duration.test.ts「全部用例（回填/优先/缺失/null/未命中/引用稳定/新对象）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-turn-speed-enrich-backfill-test
  status: active

## FR-auto-frontend-156 测试全绿（不跑全量）
变更：2026-10-10-turn-speed-enrich-backfill-test
状态：active
摘要：相关测试绿
全文：.sillyspec/changes/archive/2026-10-10-turn-speed-enrich-backfill-test/requirements.md#FR-02
最近确认：196c2280aeaf47428b5197da25e21c9224a890fc

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-turn-speed-enrich-backfill-test:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/page-helpers-enrich-api-duration.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-turn-speed-enrich-backfill-test
  status: active

## FR-auto-frontend-157 单轮会话（1 条轮目）左侧轮次导航可见，显示该轮并可点击定位
变更：2026-10-10-single-turn-nav-and-jump-head
状态：active
摘要：单轮会话导航可见；空轮次仍不渲染
全文：.sillyspec/changes/archive/2026-10-10-single-turn-nav-and-jump-head/requirements.md#FR-01
最近确认：d36f637fb53b872facafe40761c637f9b5acd6b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-single-turn-nav-and-jump-head:flow:测试绑定FR-01
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「单轮（1 条）entries 渲染导航并可点击跳转」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-single-turn-nav-and-jump-head
  status: active

## FR-auto-frontend-158 桌面 TurnNavList 与移动端 Drawer 轮次导航行为一致（空态文案不回归）
变更：2026-10-10-single-turn-nav-and-jump-head
状态：active
摘要：移动端一致性
全文：.sillyspec/changes/archive/2026-10-10-single-turn-nav-and-jump-head/requirements.md#FR-02
最近确认：d36f637fb53b872facafe40761c637f9b5acd6b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-single-turn-nav-and-jump-head:flow:测试绑定FR-02
  tests: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「0 条 entries 不渲染导航（空态语义保持）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-single-turn-nav-and-jump-head
  status: active

## FR-auto-frontend-159 时间线顶部在还有更早历史时提供「回到会话开头」入口，点击后程序化连续翻页直至游标到头，并定位到最早内容
变更：2026-10-10-single-turn-nav-and-jump-head
状态：active
摘要：点击直达开头；页上限兜底
全文：.sillyspec/changes/archive/2026-10-10-single-turn-nav-and-jump-head/requirements.md#FR-03
最近确认：d36f637fb53b872facafe40761c637f9b5acd6b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-single-turn-nav-and-jump-head:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「点击回到会话开头：连续 before 翻页到头并定位顶部」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-single-turn-nav-and-jump-head
  status: active

## FR-auto-frontend-160 连续加载期间有可见 loading 状态；到头后入口消失
变更：2026-10-10-single-turn-nav-and-jump-head
状态：active
摘要：loading 可见与消失
全文：.sillyspec/changes/archive/2026-10-10-single-turn-nav-and-jump-head/requirements.md#FR-04
最近确认：d36f637fb53b872facafe40761c637f9b5acd6b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-single-turn-nav-and-jump-head:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx「回到会话开头 loading 态与到头后入口消失」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-single-turn-nav-and-jump-head
  status: active

## FR-auto-frontend-161 既有触顶翻页/跳转/贴底跟随相关测试全部保持通过
变更：2026-10-10-single-turn-nav-and-jump-head
状态：active
摘要：回归
全文：.sillyspec/changes/archive/2026-10-10-single-turn-nav-and-jump-head/requirements.md#FR-05
最近确认：d36f637fb53b872facafe40761c637f9b5acd6b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-single-turn-nav-and-jump-head:flow:测试绑定FR-05
  tests: frontend/src/components/sessions/__tests__/turn-catalog.test.tsx「隐藏阈值改写：0 条隐藏 / 1 条起出现」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-single-turn-nav-and-jump-head
  status: active

## FR-auto-frontend-162 ScopeAuditView 渲染 repos[]（非空数组时）：每仓一段=仓标识（key==='main' 显示「主仓」brand 色）+锚点 chip（anchor.label 文案+base 前 7 位短哈希，degraded 显示降级锚）+三态 chips（计划内/计划外/计划未动计数取 repos[].totals 单一源）+该仓 files/+−；degraded 仓段不渲染 chips，整段 ⚠️ degradedReason
变更：2026-10-10-change-patch-cross-repo-view
状态：active
摘要：跨仓冻结件按仓分段；降级仓整段警示
全文：.sillyspec/changes/archive/2026-10-10-change-patch-cross-repo-view/requirements.md#FR-01
最近确认：1f4ea92e5df86e3be6149b1f19d5fa046a8ee1ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-change-patch-cross-repo-view:flow:测试绑定FR-01
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-change-patch-cross-repo-view
  status: active

## FR-auto-frontend-163 rows 表 crossRepo 字段非空的行在路径后加仓标徽章（brand 色小标签，对齐 scope-audit-command-card 形态）
变更：2026-10-10-change-patch-cross-repo-view
状态：active
摘要：跨仓行与主仓行混排
全文：.sillyspec/changes/archive/2026-10-10-change-patch-cross-repo-view/requirements.md#FR-02
最近确认：1f4ea92e5df86e3be6149b1f19d5fa046a8ee1ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-change-patch-cross-repo-view:flow:测试绑定FR-02
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx「rows 跨仓行路径后仓标徽章」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-change-patch-cross-repo-view
  status: active

## FR-auto-frontend-164 repos[].patch 键在场（'patch' in 条目）时：非空 string 可折叠展开 DiffView 正文+patchSha256 短哈希（title 全量）；null 诚实显示「patch 未采集（采集失败或空窗）」；键缺省（旧形态/未开采集）零渲染——additive 契约旧读方零感知
变更：2026-10-10-change-patch-cross-repo-view
状态：active
摘要：patch 正文在场可展开；patch 采集失败诚实留痕；旧形态无 patch 键零渲染
全文：.sillyspec/changes/archive/2026-10-10-change-patch-cross-repo-view/requirements.md#FR-03
最近确认：1f4ea92e5df86e3be6149b1f19d5fa046a8ee1ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-change-patch-cross-repo-view:flow:测试绑定FR-03
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx「repos[].patch 折叠正文+sha/null 未采集/缺键零渲染」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-change-patch-cross-repo-view
  status: active

## FR-auto-frontend-165 旧形态（无 repos 键/无跨仓行）渲染与现状一致，既有测试零回归
变更：2026-10-10-change-patch-cross-repo-view
状态：active
摘要：旧冻结件回退
全文：.sillyspec/changes/archive/2026-10-10-change-patch-cross-repo-view/requirements.md#FR-04
最近确认：1f4ea92e5df86e3be6149b1f19d5fa046a8ee1ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-change-patch-cross-repo-view:flow:测试绑定FR-04
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx「旧形态无 repos 回退现状（既有用例零回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-change-patch-cross-repo-view
  status: active

## FR-auto-frontend-166 测试覆盖：跨仓 repos 段渲染/降级段/patch 展开+sha/null 未采集/缺键不渲染/行仓标徽章
变更：2026-10-10-change-patch-cross-repo-view
状态：active
摘要：回归面全绿
全文：.sillyspec/changes/archive/2026-10-10-change-patch-cross-repo-view/requirements.md#FR-05
最近确认：1f4ea92e5df86e3be6149b1f19d5fa046a8ee1ff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-change-patch-cross-repo-view:flow:测试绑定FR-05
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx「跨仓展示用例组全绿」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-change-patch-cross-repo-view
  status: active

## FR-auto-frontend-167 session-panel-variant 回归锚用例断言随导航阈值放宽翻转（1 轮 fixture 导航列渲染）
变更：2026-10-10-variant-test-nav-flip
状态：active
摘要：断言翻转后全绿
全文：.sillyspec/changes/archive/2026-10-10-variant-test-nav-flip/requirements.md#FR-01
最近确认：589d2691b4a6dc32ae723617030bce6a58f4c339

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-variant-test-nav-flip:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx「不传 variant：根/头部 className 与改前字面量逐字一致，桌面 chrome 原位、无 ⋯ 菜单」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-variant-test-nav-flip
  status: active

## FR-auto-frontend-168 对话视图 ❓ 提问记录按时间戳穿插进对话流（不再整组前置轮头部）
变更：2026-10-10-dialog-qa-inplace
状态：active
摘要：一轮多问时序还原；仅有提问无对话段
全文：.sillyspec/changes/archive/2026-10-10-dialog-qa-inplace/requirements.md#FR-01
最近确认：21ea5d036cc57538deceda94ae85e4ff3ec9c6fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-dialog-qa-inplace:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx「两段之间的提问渲染在两段之间（created_at 落在段时刻中间）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-dialog-qa-inplace
  status: active

## FR-auto-frontend-169 问答块视觉样式逐字不变（复用同一标记），仅位置变化
变更：2026-10-10-dialog-qa-inplace
状态：active
摘要：回退路径不回归
全文：.sillyspec/changes/archive/2026-10-10-dialog-qa-inplace/requirements.md#FR-02
最近确认：21ea5d036cc57538deceda94ae85e4ff3ec9c6fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-dialog-qa-inplace:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx「旧回退路径（segments undefined）：❓ 块仍渲染，不回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-dialog-qa-inplace
  status: active

## FR-auto-frontend-170 全部视图穿插行为零改动
变更：2026-10-10-dialog-qa-inplace
状态：active
摘要：全部视图无双画
全文：.sillyspec/changes/archive/2026-10-10-dialog-qa-inplace/requirements.md#FR-03
最近确认：21ea5d036cc57538deceda94ae85e4ff3ec9c6fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-dialog-qa-inplace:flow:测试绑定FR-03
  tests: frontend/src/components/daemon/__tests__/turn-timeline-dialog-inplace.test.tsx「「全部」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-dialog-qa-inplace
  status: active

## FR-auto-frontend-171 既有对话/弹窗相关测试全部保持通过
变更：2026-10-10-dialog-qa-inplace
状态：active
摘要：回归
全文：.sillyspec/changes/archive/2026-10-10-dialog-qa-inplace/requirements.md#FR-04
最近确认：21ea5d036cc57538deceda94ae85e4ff3ec9c6fe

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-dialog-qa-inplace:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx「AC-10-01b 提问记录按 run_id 穿插到对应 turn（不堆顶）(ql-20260802-001)」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-dialog-qa-inplace
  status: active
