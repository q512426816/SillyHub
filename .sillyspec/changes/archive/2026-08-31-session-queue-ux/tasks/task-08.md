---
id: task-08
title: 'MessageQueueBar 重构——拖拽手柄原生 DnD（dragstart/dragover 高亮/drop/dragend + 松手全量 onReorder）+ ⚡立即发送按钮 onDispatchNow（pending+failed）+ ✎编辑浮层 onEdit（textarea 取消/保存；failed 转等待中提示；TASK_WAKEUP 前缀条目隐藏 ✎）+ 既有 ↻ ✕ 保留'
title_zh: 'MessageQueueBar 重构——拖拽手柄原生 DnD（dragstart/dragover 高亮/drop/dragend + 松手全量 onReorder）+ ⚡立即发送按钮 onDispatchNow（pending+failed）+ ✎编辑浮层 onEdit（textarea 取消/保存；failed 转等待中提示；TASK_WAKEUP 前缀条目隐藏 ✎）+ 既有 ↻ ✕ 保留'
author: 'qinyi'
created_at: 2026-08-31 04:15:00
priority: P0
depends_on: ['task-06']
blocks: []
requirement_ids: [FR-04, FR-05, FR-06]
decision_ids: [D-001@v1, D-003@v1, D-006@v1, D-009@v1]
allowed_paths:
  - frontend/src/components/daemon/message-queue-bar.tsx
provides:
  - contract: MessageQueueBarProps 三回调
    fields:
      - 'onReorder(ids: string[]): void'
      - 'onEdit(id: string, prompt: string): void'
      - 'onDispatchNow(id: string): void'
  - contract: QueueEntry 系统通知条目标记
    fields:
      - 'TASK_WAKEUP 前缀（[后台任务通知]）条目隐藏 ✎ 编辑按钮（D-009）'
goal: >
  MessageQueueBar 按原型 prototype-session-queue-ux.html §① 重构：每条 chip 加 ⇅ 拖拽
  手柄（HTML5 原生 DnD 换位预览，松手全量 onReorder）+ ⚡ 立即发送（pending/failed，
  title=打断当前轮）+ ✎ inline 编辑浮层（textarea 取消/保存；TASK_WAKEUP 前缀条目
  隐藏 ✎），既有 ↻/✕/展开/满员提示全保留；为 task-09 panel 提供三回调 props。
implementation:
  - "MessageQueueBarProps 补三个**可选**回调（可选的必要性：Wave 6 内 panel 未接线，必传会让 session-panel 既有两处挂载（:3587/:5417）全仓 tsc 红；task-09 接线后事实必传，undefined 时对应按钮不渲染）：onReorder?: (ids: string[]) => void；onEdit?: (id: string, prompt: string) => void；onDispatchNow?: (id: string) => void。既有 props（entries/onRemove/onRetry/max）契约不动"
  - "拖拽（原型 .drag ⇅ / .chip.dragging / .chip.drop-target，D-006 原生 DnD）：chip 外层 div 加 draggable + 左侧手柄（lucide GripVertical，title=「拖拽排序」）；组件 state 记 dragId/overId/局部展示序 override；dragstart 记 id + e.dataTransfer.effectAllowed=\"move\"，被拖 chip 加 .dragging 语义（opacity 降照 + 虚线边框）；dragover preventDefault + 命中条目加 drop-target 高亮（border-brand + 主题 shadow token，原型 box-shadow ring 语义）+ 按指针在目标条目前/后半区决定插入位（原型 getBoundingClientRect 中线判定）；drop/dragend 复位全部拖拽态"
  - "换位即时预览只改本地展示序 override（entries 真相仍归父级 useMessageQueue，纯展示组件不变式）；落定（drop/dragend）时收集本地序全量 ids 调 onReorder 并复位 override，等父级 load 收敛（R-02：422 MISMATCH 时以服务端为准）；原位松手/拖出有效区不调 onReorder；sending 条目 draggable=false 不参与（sending 不可操作既有不变式）"
  - "⚡立即发送（原型 .icon-btn.now，brand 品牌色）：pending 与 failed 均渲染（lucide Zap）；title/aria-label：pending=「打断当前轮，立即发送这条」、failed=「立即发送这条」（原型 :79/:94 两态文案）；点击 onDispatchNow(entry.id)；不本地造「已打断/已发送」状态——收敛统一走 SSE/load（R-04：空闲分支服务端可能当场派发成功删行）"
  - "✎编辑浮层（原型 .edit-pop）：组件 state editingId + draft；✎（lucide Pencil）点击以 entry.prompt 预填 textarea，在队列行下方展开单条 inline 编辑浮层（说明行 + textarea + 右下 取消/保存 两按钮，样式对齐原型）；说明行文案=「重新编辑排队消息（附件与配置不变，仅改文本；失败条目保存后转为等待中并尝试派发）」（failed 转等待中提示，FR-06）；取消=丢弃 draft 关浮层不回调；保存=trim 非空后 onEdit(entry.id, draft) 并关浮层（空文本禁用保存按钮，后端 422 双保险）"
  - "TASK_WAKEUP 前缀条目不渲染 ✎（D-009，后端 409 双保险）：文件内本地常量 const TASK_WAKEUP_PROMPT_PREFIX = \"[后台任务通知]\"（与 backend/app/modules/daemon/session/service.py:147 同值；跨语言无法共享 import，改前缀需两侧同步），按 entry.prompt.startsWith(TASK_WAKEUP_PROMPT_PREFIX) 判定"
  - "既有保留（原型 failed chip 内 ↻/⚡/✎/✕ 并存序）：failed ↻ 重试（onRetry）、pending/failed ✕ 删除（onRemove）、点击展开完整 displayPrompt、失败原因展示、附件数 📎、满员 Tag；expandedId 查看态与 editingId 编辑态互斥（开编辑浮层时收起查看展开，避免叠加）"
  - "样式全走主题语义 token（brand-* 语义阶 / muted-foreground / destructive + shadow-* var，FRONTEND_PAGE_STYLE §0.5 多主题铁律，blue/destructive 语义不硬编码色值）；头注释块同步重写注明 2026-08-31-session-queue-ux 与原型 §① 基准"
acceptance:
  - "拖拽链路：dragstart → dragover（目标 drop-target 高亮 + 前后半区插入预览）→ drop 后 onReorder 收到全量有序 ids（D-003）；原位松手/无效落点不触发；dragend 后无残留高亮（fireEvent.dragStart/dragOver/drop + dataTransfer mock 用例归 task-10，本卡不写）"
  - "⚡：pending 与 failed 均渲染且 pending title=「打断当前轮，立即发送这条」（failed=「立即发送这条」）、sending 不渲染；点击回调 onDispatchNow(id)"
  - "✎：浮层 textarea 预填原 prompt；取消不回调不改动；保存（trim 非空）回调 onEdit(id, prompt) 并关浮层；failed 条目浮层含「转为等待中」说明；prompt 以 [后台任务通知] 开头的条目无 ✎ 入口（D-009）"
  - "既有 ↻/✕/展开/失败原因/附件数/满员提示行为零回归；新 props 可选——未传时组件编译与渲染不破（session-panel 既有两处挂载不受影响）"
  - "cd frontend && pnpm exec tsc --noEmit 0 错误"
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
  - "cd frontend && pnpm test -- src/components/daemon/__tests__/message-queue-bar.test.tsx（既有用例应保持绿——本卡为纯增量渲染；若红先自查是否误删既有元素/改坏既有 props，断言适配与新用例归 task-10）"
constraints:
  - "仅改 frontend/src/components/daemon/message-queue-bar.tsx；不写/不改任何测试（拖拽换位/编辑浮层三态/⚡ 调用/TASK_WAKEUP 隐藏 ✎ 用例与 jsdom dataTransfer mock 全归 task-10）"
  - "纯展示组件不变式：不 fetch、不持队列真相（拖拽换位仅本地展示序 override，落定即上抛 onReorder + 复位等父级收敛）、不引状态库"
  - "零新依赖（NG-02/D-006）：HTML5 原生 DnD，禁 @dnd-kit 等三方库；图标复用已引入的 lucide-react/antd，不新增包"
  - "触屏拖拽降级为不可用可接受（RISK-4：⚡/✎/↻/✕ 按钮完整覆盖核心功能，拖拽是效率增强非唯一路径）"
  - "样式走主题语义 token（FRONTEND_PAGE_STYLE 多主题铁律），不硬编码色值/仅暗色可读的颜色；title/aria-label 中文"
  - "代码风格遵循 .sillyspec/docs/SillyHub/scan/CONVENTIONS.md"
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
