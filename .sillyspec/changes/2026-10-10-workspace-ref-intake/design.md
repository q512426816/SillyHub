---
author: WhaleFall
created_at: 2026-10-10 13:16:20
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-10-10-workspace-ref-intake

## 背景

2026-10-09-attachment-inline-reference 让用户能把**已上传附件**以引用标签插入消息正文（编辑态 token `【name】` → 发送置换 `[附件引用:uuid|name]`，textarea + 镜像高亮层方案）。但会话中大量上下文在**工作区文件系统**里：用户经常想指代「某个文件 / 某个目录 / 某文件里的某几行」，目前只能口头描述路径；同名文件（如各变更目录下的 design.md）口头指代完全无法区分。

会话页已有工作区文件浏览链路（左栏文件树 sessions-portal.tsx:688-706 + 右侧预览列 sessions-portal.tsx:1029-1055），且引用标签机制（token 协议 / 镜像层 / 退格整删 / 发送置换 / 历史渲染）已验证可用。本变更为文件树与预览区加右键入口，把「工作区 id + 相对路径」锚定的三类引用接入同一套标签机制。

前置事实（代码依据）：文件树目前无任何右键菜单（file-explorer.tsx 全文无 onContextMenu）；FilePreview 无行号、无选区逻辑（file-preview.tsx:418-454 按类型分发，代码分支未开 showLineNumbers）；工作区文件寻址坐标 = workspaceId + 相对根 POSIX 路径（frontend/src/lib/explorer.ts:45-61）。

## 设计目标

1. **FR-01 文件树右键**：左栏文件树右键文件/目录节点 → 上下文菜单「添加文件/目录到会话输入框」→ 当前光标处插入引用标签（失焦时插失焦前光标位，复用 lastCaretRef）。
2. **FR-02 引用标签编辑**：标签显示名称（同名 `·2` 唯一化，附件与工作区两池合并）；悬停 tooltip 显示完整绑定（类型 + 工作区 id + 相对路径 + 行号）；× 角标删一处、退格贴尾整删；允许重复插入。
3. **FR-03 类型角标**：镜像层标签左上角 lucide 类型角标（文件 FileText / 目录 Folder / 代码块 Braces / 附件 Paperclip），不进文本流。
4. **FR-04 预览区行号（前置）**：代码/纯文本分支加行号；行号列不可选中。
5. **FR-05 选区右键**：预览区选中行右键 →「添加选中内容到会话输入框（名称:起-止）」；行号按选区起止行元素实际文档位置；无选区不拦截；非文本分支无此功能。
6. **FR-06 发送置换**：token → `[文件引用:wid|path]` / `[目录引用:wid|path]` / `[代码引用:wid|path|L起-L止]`，全部组装位接线（2026-10-10 grep 实测 7 处：session-panel-dialog.tsx:312/392/1343、session-panel-page.tsx:835/2748/3258、group-chat-panel.tsx:1969；plan/execute 前须 grep substituteAttRefsForSend 重盘核对现状）；孤儿 token 原样保留。
7. **FR-07 历史渲染**：三类标记解析为可点击标签（图标+名称+行号），点击打开 FilePreviewModal 预览（fetch=fetchDownload）。
8. **FR-08 范围一致**：单聊 + 预会话 + 群聊三输入区行为一致。

## 非目标

- .md 富文本态选区引用（D-002：MarkdownText 渲染无行号概念，本期不做，后续可补「源码视角」；树右键引用整个 .md 文件不受影响）。
- 代码引用历史标签点击后滚动定位到具体行（增强项二期；本期仅打开预览）。
- 不改后端 API / schema / 存储（引用为正文文本协议，随消息透传，D-004）。
- 不做引用嵌套 / 拖拽重排 / 富编辑；不做移动端长按入口（沿附件引用 R-05 边界）。
- 右键菜单本期各只有一项（用户明确「先加一个功能」）；重命名/删除等树操作后续扩展。
- 选中文本快照不进正文（指向语义，D-003）。

## 拆分判断

单一功能闭环（工作区引用全生命周期：入口右键 → 插入编辑 → 置换发送 → 历史渲染），与附件引用同构、共享 attachment-refs 纯函数库 / InputRefOverlay / InlineAttRefText（D-009），拆开会产出不可独立的半成品。非批量模式（无模板×数据形态）。Wave 划分：Wave 1 纯函数库+单测 → Wave 2 预览行号+选区与树右键入口 → Wave 3 输入区接入+组装位置换 → Wave 4 历史渲染+群聊（依赖 Wave 1-3 的契约稳定）。

## 总体方案

**Phase 0 · 预览区行号（FR-04，前置改动）**：file-preview.tsx 代码分支 SyntaxHighlighter 开 `showLineNumbers`（oneDark 自带行号样式，fontSize 12 对齐既有观感，customStyle 不变）；纯文本分支由裸 `pre` 重构为「行号槽 + 内容行」行结构（行号列 `user-select:none`，内容行挂 `data-line`），保留 `whitespace-pre` + 横向滚动语义。行号换算一律按选区起止**行元素实际文档位置**（data-line），不做文本匹配——文件内重复内容不歧义。

**Phase 1 · 纯函数库扩展（FR-02/06/07 数据面）**：attachment-refs.ts 统一「引用描述符」WsRefDesc（kind/锚/name/lines），新增 buildWsRefToken（基名=名称+行号段）、allocateWsRefToken（池=附件 token ∪ 工作区 token 并集，D-005；完全同名才 ·2）、stripWsRefTokens、substituteWsRefsForSend（三类置换标记）、parseInlineRefs（附件+三类统一解析；保留 parseInlineAttRefs 旧导出兼容既有消费）。

**Phase 2 · 两个右键入口（FR-01/05）**：新建通用右键菜单组件（看板 kanban-task-context-menu.tsx 同模式：fixed div + document click/contextmenu/scroll 关闭 + 视口 clamp）。FileExplorer 行级 onContextMenu →「添加文件/目录到会话输入框」，回调 onAddNodeRef(desc)；FilePreview 代码/纯文本分支 contextmenu 先算 selectionLineRange()（选区起止行元素，非空才拦截，D-006）→「添加选中内容到会话输入框（名称:起-止）」，回调 onAddSelectionRef(desc)。两回调经 portal-file-panels 两壳透传到 sessions-portal，落 `pendingWsRefInsert` 槽位（{desc, nonce}，nonce 保证同引用可重复触发）下发中栏四分支；空门户态无输入区时 toast 提示。

**Phase 3 · 输入区接入（FR-02/03/08）**：session-input-bar 与 group-chat-panel 增 wsRefTokens 状态（受控回传 onWsRefTokensChange，同 onAttTokenMapChange 模式）+ pendingWsRefInsert prop（effect 消费：分配/复用 token → 复用 lastCaretRef/pendingCaretRef 机制插入光标处）；InputRefOverlay props 扩展 tokenMetas（token → {kind, 路径, 行号}）渲染左上类型角标（D-001，与右上 × 角标同视觉语言、不进文本流）+ 悬停 tooltip（hitTestAttRefOverlay 命中处显示，沿用 2026-10-10-att-ref-badge-hover 淡入机制）；退格整删/× 角标对附件与工作区 token 一视同仁；删附件 chip 联动只剥附件类 token（stripAttRefTokens 精确匹配，不误删工作区 token）。

**Phase 4 · 发送置换 + 历史渲染（FR-06/07）**：组装位以 `substituteAttRefsForSend` 调用点为锚**同点位串联** `substituteWsRefsForSend`（两张 map 并查）——2026-10-10 独立审查 grep 实测 7 处（session-panel-dialog.tsx:312/392/1343、session-panel-page.tsx:835/2748/3258、group-chat-panel.tsx:1969；2026-10-09 归档 R-04 记 8 处已漂移，以现状 grep 为准，plan 落卡前重盘）；InlineAttRefText 内部换 parseInlineRefs，三类标记渲染标签（lucide 图标+名称+行号），新增 onOpenWsRef 回调；turn-segment-views.tsx 消费点接 onOpenWsRef → FilePreviewModal（target.fetch = fetchDownload(workspaceId, path)，meta.mime=null 靠扩展名分发，explorer 文件无平台 id 恒本地渲染——同 file-preview.tsx 全屏预览先例）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/lib/attachment-refs.ts | 新增 WsRefDesc 类型 + buildWsRefToken/allocateWsRefToken/stripWsRefTokens/substituteWsRefsForSend/parseInlineRefs（接口定义见下节）；既有附件函数不动 |
| 新增 | NEW:frontend/src/components/ui/floating-context-menu.tsx | 通用右键菜单组件（fixed div + document 关闭 + 视口 clamp，看板模式抽取；树/预览两消费点） |
| 修改 | frontend/src/components/explorer/file-explorer.tsx | 行级 onContextMenu → 菜单「添加文件/目录到会话输入框」；新增 onAddNodeRef 回调 prop |
| 修改 | frontend/src/components/explorer/file-preview.tsx | 代码分支开 showLineNumbers；纯文本分支行号槽+data-line 行结构；selectionLineRange() + contextmenu（非空选区才拦截）；新增 onAddSelectionRef 回调 prop |
| 修改 | frontend/src/components/sessions/portal-file-panels.tsx | PortalFileTreePanel/PortalFilePreviewPanel 透传 onAddNodeRef/onAddSelectionRef |
| 修改 | frontend/src/components/sessions/sessions-portal.tsx | 接两入口回调组装 WsRefDesc（workspaceId 取树快照）→ pendingWsRefInsert 槽位下发中栏四分支；空门户态 toast |
| 修改 | frontend/src/components/daemon/session-input-bar.tsx | wsRefTokens 状态 + onWsRefTokensChange 受控回传（producer=输入区，consumer=组装位经父级）+ pendingWsRefInsert prop 消费插入 + 删附件联动只剥附件 token |
| 修改 | frontend/src/components/daemon/input-ref-overlay.tsx | props 扩展 tokenMetas → 左上类型角标（D-001）+ 悬停 tooltip 元数据；背景块仍严禁 margin/padding |
| 修改 | frontend/src/components/daemon/attachment-ref-tag.tsx | InlineAttRefText 内部换 parseInlineRefs；三类标记标签渲染 + onOpenWsRef 回调 |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | 正文段消费点接 onOpenWsRef → FilePreviewModal（fetch=fetchDownload） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 透传 pendingWsRefInsert 槽位；定时/队列/handleSend 组装位接入 substituteWsRefsForSend |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | 透传槽位；两处组装位接入置换 |
| 修改 | frontend/src/components/group-chat/group-chat-panel.tsx | 群聊输入区同款接入（wsRefTokens/插入/置换/历史渲染）+ pendingWsRefInsert prop |
| 修改 | frontend/src/components/daemon/__tests__/attachment-refs.test.ts | 用例：并集分配（同名 ·2 / 异基名免序号）/三类置换/三类解析/孤儿降级 |
| 修改 | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | 用例：类型角标按 kind 渲染、tooltip 元数据 |
| 修改 | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | 用例：右键插入工作区引用/退格整删/删附件不误剥工作区 token/pendingWsRefInsert 消费 |
| 修改 | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx | 用例：群聊插入 + 发送置换 + 历史标签 |
| 修改 | frontend/src/components/explorer/__tests__/file-explorer.test.tsx | 用例：文件/目录右键菜单项触发回调 |
| 修改 | frontend/src/components/explorer/__tests__/file-preview.test.tsx | 用例：行号渲染 / 选中行右键回调（desc 行号正确）/ 无选区不拦截 |
| 修改 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | 用例：pendingWsRefInsert 槽位下发（真会话/预会话/群聊分支）、空门户 toast |

## 接口定义

本变更接口面：0 端点（无后端接口变更）。前端新增纯函数与组件契约：

```ts
// frontend/src/lib/attachment-refs.ts（扩展）
export type WsRefKind = "file" | "dir" | "code";
export interface WsRefDesc {
  kind: WsRefKind;
  workspaceId: string;
  path: string;             // 相对工作区根 POSIX 路径；目录引用根为 ""
  name: string;             // 显示名（路径末段；根="工作区根"）
  lines?: [number, number]; // kind=code 必填（1 起始，含端点）
}
/** 工作区引用条目：key = path（code 为 path:L起-L止）。 */
export type WsRefTokenEntry = { desc: WsRefDesc; token: string };
export type WsRefTokenMap = Record<string, WsRefTokenEntry>;

/** 编辑态 token：基名= name+(lines?":l0-l1":"")，seq>1 加 ·seq（纯文本，无 emoji，D-001）。 */
export function buildWsRefToken(name: string, lines: [number, number] | undefined, seq: number): string;
/** 唯一化分配：poolTokens=附件 token ∪ 工作区 token 并集（D-005），按完整显示基名找最小可用序号。 */
export function allocateWsRefToken(base: string, poolTokens: string[]): string;
/** 移除 value 中 tokens 全部出现（清引用/删附件联动各用各的 token 集）。 */
export function stripWsRefTokens(value: string, tokens: string[]): string;
/** 发送置换：命中 token → [文件引用:wid|path]/[目录引用:wid|path]/[代码引用:wid|path|L起-L止]；孤儿原样保留。 */
export function substituteWsRefsForSend(value: string, map: WsRefTokenMap): string;
/** 历史统一解析：附件 + 三类工作区标记拆 text/ref 段（parseInlineAttRefs 保留为兼容薄封装）。 */
export interface InlineRefPart { type: "text" | "ref"; value: string; ref?: { kind: "att" | WsRefKind; id?: string; workspaceId?: string; path?: string; lines?: [number, number]; name: string } }
export function parseInlineRefs(text: string): InlineRefPart[];
```

```tsx
// 组件 props 扩展
FileExplorer:      { onAddNodeRef?: (desc: WsRefDesc) => void }        // 树右键（portal 组装 workspaceId）
FilePreview:       { onAddSelectionRef?: (desc: WsRefDesc) => void }   // 选区右键（仅代码/纯文本分支）
SessionInputBar / GroupChatPanel:
  { pendingWsRefInsert?: { desc: WsRefDesc; nonce: number } | null;    // portal 槽位，effect 消费后上抛 onPendingWsRefInsertHandled(null)
    onWsRefTokensChange?: (map: WsRefTokenMap) => void }               // 受控回传，组装位消费
InputRefOverlay:   { tokenMetas?: Record<string, { kind: "att" | WsRefKind; title: string }> } // 类型角标 + tooltip
InlineAttRefText:  { onOpenWsRef?: (ref: { workspaceId: string; path: string; lines?: [number, number] }) => void }
```

`pendingWsRefInsert.nonce` 每次插入自增，保证同一引用连续添加可重复触发（effect 依赖 nonce 而非 desc 引用相等）。

## 生命周期契约表

不涉及生命周期契约（纯前端输入/渲染交互变更；消息发送仍走既有 inject 通道与 attachment_ids 参数，无 session/lease/daemon 状态迁移事件）。

## 数据模型

无 schema 变更。引用均为消息正文内文本协议（D-004）：编辑态 `【名称】`/`【名称:起-止】`（纯文本），发送态 `[文件引用:wid|path]` / `[目录引用:wid|path]` / `[代码引用:wid|path|L起-L止]`，后端原样透传落库。附件元数据沿用 AttachmentRead，工作区文件元数据沿用 ExplorerEntry/ExplorerFileResponse（只读，不新增字段）。

## 兼容策略（brownfield 必填）

- 未插入任何工作区引用时：wsRefTokens 空、槽位 null、镜像层无角标（附件 token 走 tokenMetas 补 Paperclip 元数据，视觉与现状一致——角标仅工作区三类新增，附件角标按 D-001 一并加上，属确认的增强）、substituteWsRefsForSend 原样返回——完全回退现状。
- 历史消息（本变更前）：正文无三类标记，parseInlineRefs 解析出单 text 段，渲染与现状逐字一致；既有 `[附件引用:...]` 解析口径不变。
- 用户手改坏 token：置换映射不命中 → 原样保留文本（孤儿降级，与附件 R-03 同口径）；历史解析失败片段原样显示。
- FilePreview 未传 onAddSelectionRef（explorer 页等其它消费方）：无 contextmenu 拦截，行为与现状一致；.md/图片/PDF/二进制分支零改动。
- 不改变的 API / 表结构：explorer 四端点、附件上传/删除/发送端点、inject 通道、头部附件标记行机制全部不动。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 类型角标引入布局/层级副作用（角标元素触发 stacking context 使 × 角标 z-20 失效；或误加 margin/padding 造成镜像层逐字符错位——2026-10-10 已有 mx-px 教训） | P1 | 角标 absolute 定位不占文本流（D-001）；沿用「背景块只用 background+radius」铁律；overlay 单测加角标后版式守卫用例 |
| R-02 | 组装位旁路遗漏导致 token 未置换直发（附件 R-04 同源风险；2026-10-10 独立审查实测现状 7 处，与 2026-10-09 归档 R-04 记 8 处存在漂移） | P1 | 锚定规则=在每个 substituteAttRefsForSend 调用点同点位串联 substituteWsRefsForSend；plan 落卡前 grep substituteAttRefsForSend 重盘核对（UB-1，review-2026-10-10-131956）；定时/团队路径测试覆盖 |
| R-03 | SyntaxHighlighter 开 showLineNumbers 后与 oneDark/fontSize 12/customStyle 观感冲突 | P2 | 实测门截图校准（lineNumberStyle 对齐）；纯文本分支行号自绘样式对照代码分支统一 |
| R-04 | 行号换算在软折行/横向滚动/反向选区下错行 | P2 | 按选区起止行元素 data-line 计算（非字符 offset），天然免疫折行；测试覆盖反选与跨行选区 |
| R-05 | 用户在 .md 预览选字右键无菜单，误以为功能失效（D-002 故障面） | P2 | 接受：引导文案/菜单可见性说明；后续「源码视角」再覆盖 |
| R-06 | 引用时效性：发送后文件被删/改，智能体读到最新内容或路径失效（D-003 指向语义） | P2 | 接受：显式边界；智能体读取失败自然报路径错误 |
| R-07 | 槽位穿透链长（portal→panel→input-bar props 三层），群聊/单聊/预会话三分支行为漂移 | P2 | 槽位契约单一（pendingWsRefInsert+nonce+handled 回抛）；三分支各一条 portal 测试 |
| R-08 | 空门户态右键树插入无消费者 | P2 | portal 兜底 toast「当前无可用输入区」；文件树入口本要求已选会话（fileWorkspaceId），实际触达面小 |
| 无长驻进程/外部资源，生命周期面不适用 | — | — | 右键菜单为受控 React 状态（document 级监听随菜单关闭/卸载移除）；无监听器/定时器/子进程残留 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-03；总体方案 Phase 3（角标）；接口定义 tokenMetas；R-01 | 已覆盖 |
| D-002@v1 | 非目标（.md 选区）；总体方案 Phase 0（分支范围）；R-05 | 已覆盖 |
| D-003@v1 | 非目标（快照不进正文）；数据模型；R-06 | 已覆盖 |
| D-004@v1 | FR-06；总体方案 Phase 1（三类标记）；数据模型；兼容策略 | 已覆盖 |
| D-005@v1 | FR-02；接口定义 allocateWsRefToken（并集池）；Phase 1；测试清单 attachment-refs.test.ts | 已覆盖 |
| D-006@v1 | FR-05；总体方案 Phase 2（selectionLineRange 非空才拦截） | 已覆盖 |
| D-007@v1 | FR-04；总体方案 Phase 0（行号前置）；R-03/R-04 | 已覆盖 |
| D-008@v1 | FR-08；总体方案 Phase 3/4（三输入区+组装位锚定串联）；R-02/R-07（计数由 D-008@v2 修正） | 已覆盖 |
| D-008@v2 | FR-06；总体方案 Phase 4（7 处实测清单）；R-02 | 已覆盖（修正组装位计数） |
| D-009@v1 | 总体方案 Phase 1（扩展 attachment-refs 库+复用 overlay）；拆分判断 | 已覆盖 |
| D-010@v1 | 防复潮条目（独立两套库——rejected），无覆盖点 | 已覆盖（否决留痕） |
| D-011@v1 | 防复潮条目（独立 chips 通道——rejected），无覆盖点 | 已覆盖（否决留痕） |

剩余风险：R-05（.md 用户预期）、R-06（引用时效性）为显式接受边界。多裁定组合推演：D-005（并集序号池）与附件 D-004@2026-10-09（删附件联动剥离）作用于同一 value 但无状态互锁——工作区 token 与附件 token 文本形态同构、删除各自精确匹配自己 token，叉乘（删附件×工作区 token 在场 / 删工作区引用×附件 token 在场）均不互扰，无组合约束。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期豁免/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large——多文件跨 explorer/sessions/daemon/group-chat 四块 + 8 组装位，需 Wave 编排走 plan）
- [x] 引用所有当前版本 D-001@v1..D-011@v1，覆盖点逐行落实（D-010/011 为 rejected 防复潮留痕）
- [x] 生命周期关键词（session 出现于文件路径）→ 已写紧邻豁免短语「不涉及生命周期契约」
- [x] UI 原型分级：组件级+新交互 → 已生成 prototype-workspace-ref-intake.html（变更目录内，默认 B 角标样式）
- [x] 无「自审存疑」未闭合项（R-05/R-06 为显式接受边界并登记；8 组装位清单沿附件 R-04 实测盘点）
