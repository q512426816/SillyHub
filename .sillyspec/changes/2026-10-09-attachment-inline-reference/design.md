---
author: WhaleFall
created_at: 2026-10-09 13:38:42
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-10-09-attachment-inline-reference

## 背景

会话输入区支持上传附件（选文件即传，chips 展示、随消息发送），但用户无法在正文文字中标记"这句话说的是哪个附件"——附件与正文是两条平行通道，传递"第一张图怎样、第二张图怎样"这类指代信息只能靠口头描述（"第一张图"），当两个附件同名时智能体完全无法区分。用户需要在编辑未发送消息时，把附件以引用标签的形式插入正文，并在发送后让智能体拿到 uuid 级精确关联。

前置事实（代码依据）：附件上传后即持有服务端唯一 id（`frontend/src/lib/api/session-attachments.ts` AttachmentRead）；backend inject 在消息头部写入 `[附件:<uuid>|<kind>|<name>]` 标记行（`frontend/src/components/daemon/runtime-session-helpers.tsx:672` parseAttachmentMarkers 解析）；正文原样透传给智能体。

## 设计目标

1. 右击待发附件 chip → 正文**末尾**插入该附件的引用标签（编辑态 token），插入后光标落末尾，可继续输入。
2. 编辑态 token 显示真实文件名；同名附件自动加序号（`【文件名·2】`），指代唯一。
3. 输入框内标签有视觉样式（品牌色底、圆角、右上角 × 角标）：× 点击删该处引用；退格贴标签尾部时一次整删整个标签（D-004@v2 用户反馈，非逐字），标签中部/普通文本退格仍逐字。
4. 点 chip X 删除附件 → 正文该附件的全部引用同步移除；不影响其它（同名）附件的引用。
5. 发送时编辑态 token 自动置换为 `[附件引用:<uuid>|<name>]` 正式引用，随正文透传；智能体凭 uuid 与头部附件标记行精确对齐（同名不混）。后端零改动。
6. 历史消息正文里的 `[附件引用:...]` 渲染为标签节点，点击打开 FilePreviewModal 按 uuid 在线预览。
7. 单聊与群聊行为一致；输入区既有全部行为零回归。

## 非目标

- 不换富文本编辑器（contenteditable 方案已否决，D-001）。
- 不做移动端长按插入（右击为桌面交互；触屏替代记为剩余边界，D-006）。
- 不改后端 API/存储/schema；不改动附件上传/删除/发送的既有参数通道（attachment_ids 照旧）。
- 不做引用标签的嵌套/拖拽重排等富编辑能力。
- 历史消息引用标签不做行内图片缩略图（点击预览已覆盖查看诉求）。

## 拆分判断

单一功能闭环（引用 token 全生命周期：生成→编辑→删除联动→发送置换→历史渲染），跨两个输入区组件 + 三处发送组装位 + 两处历史渲染位，但共享同一纯函数库与两组渲染组件——作为一个变更顺序交付（Wave 1 纯函数+单测 → Wave 2 单聊链路 → Wave 3 群聊链路 → Wave 4 历史渲染），不拆多变更（功能不独立可用性差，拆开会产生中间态半成品）。

## 总体方案

**Wave 1 纯函数库（`frontend/src/lib/attachment-refs.ts`）**：token 构建（`【name】`/`【name·2】`，序号按"当前正文已有 token + 已分配映射"唯一化分配，不随删除重排）、按 token 剥离（删附件联动）、发送置换（token → `[附件引用:uuid|name]`，映射里找不到的孤儿 token 原样保留）、历史解析（正则拆分 text/ref 段）。

**Wave 2 单聊输入区（session-input-bar.tsx）**：
- 组件持 `attTokenMap: Record<attId, token>` 状态；chip `onContextMenu`（preventDefault）→ 分配/复用 token → `onChange(value + token)` 追加末尾 → 光标延迟置末尾（复用 pendingCaretRef 机制）。
- 镜像高亮层（`input-ref-overlay.tsx`）：textarea 版式同参数（同 class 字体/行高/padding/宽度/高度），层内渲染 token 位置的品牌色背景块（层在 textarea 之下、pointer-events:none），× 角标小元素独立浮于上层（pointer-events:auto，点击 → 从 value 中移除该 token 一次出现）。
- `handleRemove`（删附件）：`stripAttRefTokens(value, [该附件 token])` 后 `onChange` 回传，并清理映射。

**Wave 3 发送置换 + 群聊（page/dialog/group）**：三处发送组装位（session-panel-page.tsx 两处、session-panel-dialog.tsx 两处、group-chat-panel.tsx handleSend）在组装 displayPrompt 前对草稿调 `substituteAttRefsForSend`；置换输入 = 草稿 value + 组件回传的 tokenMap（经 onAttachmentsChange 同款受控回调通道 `onAttTokenMapChange` 注入父级，或父级持引用——采用受控回调，与现有 onMentionsChange 模式一致）。群聊输入区挂同款右击/映射/镜像层。

**Wave 4 历史渲染（turn-segment-views.tsx + 群聊气泡）**：正文文本节点包一层 `InlineAttRefText` 组件——`parseInlineAttRefs` 拆段，text 段原样、ref 段渲染为标签（点击 → 宿主开 FilePreviewModal，target.fetch = fetchAttachmentBlob(uuid)，与已发送附件 chips 同链路）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:frontend/src/lib/attachment-refs.ts | 纯函数库：buildAttRefToken/allocateAttRefToken/stripAttRefTokens/substituteAttRefsForSend/parseInlineAttRefs（接口定义见下节） |
| 新增 | NEW:frontend/src/components/daemon/input-ref-overlay.tsx | 输入区镜像高亮层（token 背景块 + × 角标，版式对齐 textarea） |
| 新增 | NEW:frontend/src/components/daemon/attachment-ref-tag.tsx | InlineAttRefText 历史正文解析渲染组件（ref 段标签 + 点击回调） |
| 修改 | frontend/src/components/daemon/session-input-bar.tsx | chip onContextMenu 插入、attTokenMap 状态与受控回传 onAttTokenMapChange、handleRemove 联动剥离、镜像层挂载（props 契约新增一个可选回调查看接口定义） |
| 修改 | frontend/src/components/group-chat/group-chat-panel.tsx | 同款右击/映射/镜像层/联动；handleSend 组装前置换 |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 两处发送组装前 substituteAttRefsForSend（tokenMap 来自输入区回传状态） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 两处发送组装前置换 |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | 单聊历史正文段接 InlineAttRefText（点击开预览） |
| 新增 | NEW:frontend/src/components/daemon/__tests__/attachment-refs.test.ts | 纯函数单测（唯一化/剥离/置换/解析/孤儿降级） |
| 修改 | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | 右击插入、×角标删除、退格删除、删附件联动清引用用例 |
| 修改 | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx | 群聊右击插入 + 发送置换 + 历史标签渲染用例 |

**文本协议数据流（D-003）**：编辑态 token（producer：session-input-bar / group-chat-panel 的 attTokenMap）→ 发送组装位调 substituteAttRefsForSend 置换为 `[附件引用:<uuid>|<name>]` → backend inject 落库/透传（零改动，正文原样）→ consumer：智能体读取（uuid 与头部 `[附件:uuid|kind|name]` 标记行对齐）+ 前端历史渲染 parseInlineAttRefs → 标签点击预览（fetchAttachmentBlob(uuid)）。

## 接口定义

本变更接口面：0 端点（无后端接口变更）。前端新增纯函数与组件契约：

```ts
// frontend/src/lib/attachment-refs.ts
/** 附件 id → 编辑态 token 文本（【name】/【name·2】）映射。 */
export type AttRefTokenMap = Record<string, string>;

/** 构建编辑态 token：seq=1 无后缀，seq>1 加 ·seq。 */
export function buildAttRefToken(name: string, seq: number): string;

/** 唯一化分配：在 existingTokens（正文已出现 + 已分配）中找最小可用序号。 */
export function allocateAttRefToken(name: string, existingTokens: string[]): string;

/** 从 value 中移除 tokens 的全部出现（删附件联动；逐 token 全量替换）。 */
export function stripAttRefTokens(value: string, tokens: string[]): string;

/** 发送置换：tokenMap 命中的 token → [附件引用:uuid|name]；孤儿 token 原样保留。 */
export function substituteAttRefsForSend(
  value: string,
  tokenMap: AttRefTokenMap,
  attachments: { id: string; name: string }[],
): string;

/** 历史解析：拆 text/ref 段（uuid 锚定，口径对齐 parseAttachmentMarkers 的 36 位 hex）。 */
export interface InlineAttRefPart {
  type: "text" | "ref";
  value: string;            // text 段原文 / ref 段 name
  ref?: { id: string; name: string }; // ref 段携带
}
export function parseInlineAttRefs(text: string): InlineAttRefPart[];
```

```tsx
// input-ref-overlay.tsx：镜像层（挂在 textarea 同容器，版式参数透传）
export function InputRefOverlay(props: {
  value: string;
  tokens: string[];                       // 需高亮的编辑态 token
  onRemoveToken: (token: string) => void; // × 角标点击
  overlayClassName: string;               // 与 textarea 同版式的字体/行高/padding/宽度 class
  overlayStyle?: React.CSSProperties;     // 高度拖拽同步
}): null | JSX.Element;

// attachment-ref-tag.tsx：历史正文解析渲染
export function InlineAttRefText(props: {
  text: string;
  onOpenRef?: (ref: { id: string; name: string }) => void; // 缺省不渲染可点击
}): JSX.Element;
```

`SessionInputBarProps` 新增可选 prop：`onAttTokenMapChange?: (next: AttRefTokenMap) => void`（受控回传，父级发送组装消费；缺省不回传，单组件内行为自洽）。

## 生命周期契约表

不涉及生命周期契约（纯前端输入/渲染交互变更，无 session/lease/daemon 状态迁移事件；消息发送仍走既有 inject 通道不变）。

## 数据模型

无 schema 变更（token 与正式引用均为消息正文内文本协议；附件元数据沿用 AttachmentRead）。

## 兼容策略（brownfield 必填）

- 未插入任何引用时：tokenMap 空、镜像层不渲染（零视觉/行为差异）、substituteAttRefsForSend 原样返回——完全回退到现状。
- 历史消息（本变更前）：正文无 `[附件引用:...]` 模式，InlineAttRefText 解析出单 text 段，渲染与现状逐字一致。
- 用户手改坏 token（删半个/复制粘贴）：置换时映射不命中 → 原样保留文本（降级为纯文本语义，显式接受）；历史解析失败的 `[附件引用:...]` 片段原样显示。
- 不改变的 API/表结构：附件上传/删除/发送端点、attachment_ids 参数、头部标记行机制全部不动。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 镜像层与 textarea 版式对齐偏差（字体/行高/padding/换行/宽度/高度拖拽不同步）导致背景块错位 | P1 | 镜像层复用 textarea 同一套 class 与 style（高度拖拽 inputHeight 同值透传）；white-space:pre-wrap + word-break 同参数；关键路径测试 + 实测门截图验收 |
| R-02 | ×角标点击与 textarea 焦点/输入冲突 | P2 | 角标 pointer-events:auto 独立小元素且 stopPropagation+preventDefault；其余区域 pointer-events:none 不拦截 |
| R-03 | 用户手动改坏 token 文本 → 引用降级为纯文本（同名歧义复活） | P2 | 接受：显式边界（D-003 孤儿降级）；置换/解析容错不崩 |
| R-04 | 发送组装旁路遗漏导致 token 未置换直发 | P1 | Grill 实测盘点（2026-10-09）：无公共必经单点，须按 8 点位逐一应用 substituteAttRefsForSend——组装位 5 处（session-panel-page.tsx:2773/2909、session-panel-dialog.tsx:1068/1220、group-chat-panel.tsx handleSend）+ 定时发送 2 处（page.tsx:830 / dialog.tsx:307 createScheduledMessage 直取草稿）+ 团队触发 1 处（page.tsx:3067 /team 直发）；plan 按此清单落任务卡，测试覆盖定时与团队路径 |
| R-05 | 移动端触屏无右键，无法插入引用 | P2 | 本期明确不做（D-006 剩余边界）；后续可加长按菜单 |
| R-06 | 长正文历史解析正则开销 | P3 | 单次线性扫描、消息级缓存渲染结果（React.memo），量级可忽略 |
| R-07 | UI 原型跳过：纯交互组件增强，无新页面/布局变体 | P3 | 接受：标签视觉沿用现有 chips 设计语言（品牌色阶/圆角/×角标先例），无增量布局决策；实测门以截图验收 |
| 无长驻进程/外部资源，生命周期面不适用 | — | — | 镜像层随组件卸载销毁，无监听器/定时器/子进程残留（角标点击监听为组件内声明式绑定） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案 Wave 2（镜像层）；FR-01/FR-03；文件清单 input-ref-overlay.tsx | 已覆盖 |
| D-002@v1 | 接口定义 buildAttRefToken/allocateAttRefToken；FR-02；兼容策略（同名不重排） | 已覆盖 |
| D-003@v1 | 总体方案 Wave 3（发送置换）；接口定义 substituteAttRefsForSend；文件清单数据流标注；FR-04 | 已覆盖 |
| D-004@v1 | 总体方案 Wave 2（handleRemove 联动 + ×角标）；FR-03/FR-05 | 已覆盖 |
| D-005@v1 | 总体方案 Wave 4；InlineAttRefText；FR-06 | 已覆盖 |
| D-006@v1 | 总体方案 Wave 2（onContextMenu）；非目标（移动端）；FR-01；R-05 | 已覆盖 |

剩余风险：R-05（移动端触屏边界，本期显式不做）。多裁定组合：无组合约束（D-002 唯一化与 D-004 联动删除作用于同一 tokenMap 但无状态互锁——删除联动按映射精确匹配，不依赖序号重排）。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期豁免/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large——多文件跨三块链路，需 Wave 编排走 plan）
- [x] 引用所有当前版本 D-001@v1..D-006@v1，覆盖点逐行落实
- [x] 生命周期关键词（会话/session 出现于正文）→ 已写紧邻豁免短语「不涉及生命周期契约」
- [x] UI 原型分级：跳过原因记入风险登记 R-07（纯交互组件、无新页面布局变体）
- [x] 无「自审存疑」未闭合项（R-04 旁路盘点为 plan 阶段必做动作，已列 P1 风险而非存疑——有明确应对路径）
