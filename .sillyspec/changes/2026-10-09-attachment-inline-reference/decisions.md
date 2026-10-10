---
author: WhaleFall
created_at: 2026-10-09 13:47:10
---

# 决策台账 — 2026-10-09-attachment-inline-reference

> 本变更的决策记录（brainstorm 阶段落盘；Grill 修正时升版本 vN+1 并 supersedes）。

## D-001@v1

- type: 技术方案
- status: confirmed
- source: brainstorm Step 4（用户 AskUserQuestion 亲选）
- question: 输入框内引用标签的渲染实现方式？
- answer: 方案 A——textarea 保持纯文本持有 token，底层镜像高亮层渲染标签样式（品牌色底、圆角、右上角 × 角标）；不换 contenteditable 富文本编辑器、不做输入框下方独立引用条。
- normalized_requirement: 输入区所有既有行为（受控 value、Enter 发送、@ 联想光标数学、IME 组合保护、粘贴上传、高度拖拽、草稿持久化）零回归；标签渲染不得拦截正常文本输入。
- impacts: session-input-bar.tsx、group-chat-panel.tsx 输入区结构；新增镜像层组件。
- evidence: 用户 2026-10-09 对话：「A：标签高亮叠层（推荐）」；方案 B/C 否决理由（重做回归面大 / 引用脱离正文位置）。
- priority: P0
- 锚点: frontend/src/components/daemon/session-input-bar.tsx（镜像层挂载点）
- 模块域: frontend_components

## D-002@v1

- type: 交互契约
- status: confirmed
- source: 用户两轮需求澄清
- question: 占位符显示文本与同名文件区分？
- answer: 显示真实文件名（默认 `【文件名】`）；同附件名冲突时自动加序号后缀（`【文件名·2】`），序号分配记录在组件状态（附件 id → token 文本映射），不随删除重排。
- normalized_requirement: 正文里每个引用标签文本指代唯一附件；删除某附件不影响其它同名附件的已插入标签。
- impacts: token 生成/剥离纯函数；输入区组件状态。
- evidence: 用户 2026-10-09 AskUserQuestion 作答「真实文件名（推荐）」+「因为可以上传名称相同的文件，所以纯文本的表述可能不准确」。
- priority: P0
- 锚点: frontend/src/lib/attachment-refs.ts（规划）
- 模块域: frontend_lib

## D-003@v1

- type: 接口契约
- status: confirmed
- source: 用户需求澄清 + 方案设计
- question: 发送时正文里的引用以什么形式传给智能体？
- answer: 发送组装时把编辑态 token 置换为 uuid 锚定的正式引用 `[附件引用:<uuid>|<name>]`，随正文透传（后端零改动）；与 backend 既有头部标记行 `[附件:<uuid>|<kind>|<name>]` 的 uuid 对齐，智能体可精确关联（同名不混）。置换失败的孤儿 token 原样保留（降级为纯文本）。
- normalized_requirement: 后端 API/存储零变更；置换只发生在前端发送组装处（单聊 page/dialog 各 2 处 + 群聊 handleSend）。
- impacts: session-panel-page.tsx、session-panel-dialog.tsx、group-chat-panel.tsx 发送组装；agent 侧可读性。
- evidence: 用户作答「我想要的不只是纯文本，是要附件的引用……纯文本的表述可能不准确」；runtime-session-helpers.tsx 既有 parseAttachmentMarkers 机制（uuid 锚定先例）。
- priority: P0
- 锚点: frontend/src/lib/attachment-refs.ts（规划）
- 模块域: frontend_lib

## D-004@v1

- type: 交互契约
- status: confirmed
- source: 用户需求澄清
- question: 引用与附件删除的联动行为？
- answer: 点 chip 的 X 删除附件时，正文里该附件的全部引用标签同步移除（受控 value 经 onChange 回传父级）；删除单处引用 = 点标签右上角 × 角标（删该处一次出现）或正常退格逐字删除（标签是真实文本）。
- normalized_requirement: 删附件与删引用互不误伤（同名场景靠 D-002 唯一化保证）；退格删除天然支持（textarea 原生）。
- impacts: 输入区组件 handleRemove/token 状态；镜像层角标点击。
- evidence: 用户作答「引用附件删除了，会话框里对应的关联引用都要清空的」+「可以在右上角有个删除标志，可以点击删除或者直接正常的回退删除」。
- priority: P0
- 锚点: frontend/src/components/daemon/session-input-bar.tsx
- 模块域: frontend_components

## D-005@v1

- type: 交互契约
- status: confirmed
- source: 用户需求澄清
- question: 历史消息正文里的引用如何呈现？
- answer: 气泡正文解析 `[附件引用:<uuid>|<name>]` 渲染为标签样式节点，点击打开 FilePreviewModal 按 uuid 拉附件内容在线预览（与已发送附件 chips 同链路）；解析失败的引用原样显示文本。
- normalized_requirement: 单聊（TurnTimeline 正文段）与群聊（时间线气泡）一致；仅渲染层改动，不改消息存储。
- impacts: turn-segment-views.tsx（或单聊正文渲染位）、group-chat-panel.tsx 气泡渲染。
- evidence: 用户作答「历史消息里 引用 也显示为标签吧……历史消息里的引用最好是可以点击查看的」。
- priority: P0
- 锚点: frontend/src/components/daemon/turn-segment-views.tsx
- 模块域: frontend_components

## D-006@v1

- type: 边界裁决
- status: confirmed
- source: 用户需求澄清 + 方案设计
- question: 重复插入与触发方式的边界？
- answer: 同一附件右击多次允许插入多个引用（不做去重）；触发为右击 chip（桌面 contextmenu，preventDefault）；移动端触屏无右键，本期不做长按替代（记为剩余边界）。
- normalized_requirement: 重复插入行为可预测（右击一次插一个）；插入位置恒为输入框末尾（非光标处），插入后光标落末尾。
- impacts: 输入区 chip 事件绑定。
- evidence: 用户作答「允许重复插入（推荐）」+ 原始需求「右击已上传的附件……在输入框最后插入」。
- priority: P1
- 锚点: frontend/src/components/daemon/session-input-bar.tsx
- 模块域: frontend_components
