# 符号影响面报告

> tasks.md 内容指纹（生成时）: 5bab22c499c6325e——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 纯新增导出（WsRefKind/WsRefDesc/WsRefTokenEntry/WsRefTokenMap 类型 + buildWsRefToken/allocateWsRefToken/stripWsRefTokens/substituteWsRefsForSend/parseInlineRefs/InlineRefPart），既有附件五函数签名零变动（纯追加导出，无既有签名修改）；受影响调用点=无（新符号，消费方在 task-05/07/08/09 接线）。
- task-02: FilePreview 组件 props 增可选 onAddSelectionRef?: (desc: WsRefDesc) => void——可选 prop 追加，既有消费点（portal-file-panels.tsx:127、file-preview 全屏态等）不传时行为不变，均在任务范围内（透传接线归 task-06）。
- task-03: 新建 floating-context-menu.tsx 通用组件（新增导出，无既有签名变更）；FileExplorer props 增可选 onAddNodeRef?: (desc: WsRefDesc) => void——可选追加，既有消费点不传时行为不变。
- task-04: InputRefOverlay props 增可选 tokenMetas?: Record<string, {kind, title}>——可选追加，既有调用点（session-input-bar.tsx:951-959、group-chat-panel.tsx:3043）不传时渲染逐字一致；扩 props 接线归 task-05/08。
- task-05: SessionInputBar props 增可选 pendingWsRefInsert/onPendingWsRefInsertHandled/onWsRefTokensChange（三项均可选）；既有调用点 session-panel-page.tsx:3850/:4933、session-panel-dialog.tsx:2153 不传时行为不变，接线归 task-07。
- task-06: PortalFileTreePanel/PortalFilePreviewPanel 两壳 props 增可选 onAddNodeRef/onAddSelectionRef 直通；sessions-portal 内部新增 state，组件对外签名无破坏性变更；下发给 SessionPanel/GroupChatPanel 的槽位 prop 接线归 task-07/08。
- task-07: session-panel-page.tsx / session-panel-dialog.tsx 新增 wsRefTokens state + props 增可选 pendingWsRefInsert 透传 + SessionInputBar 挂 onWsRefTokensChange；组装位在 substituteAttRefsForSend 同点位串联 substituteWsRefsForSend（纯调用追加，不改既有函数签名）。
- task-08: GroupChatPanel props 增可选 pendingWsRefInsert/onPendingWsRefInsertHandled；内部新增 wsRefTokens state；组装位（group-chat-panel.tsx:1969 实测点位）同点位串联 substituteWsRefsForSend；历史渲染检测函数换 parseInlineRefs（attachment-refs.ts 侧保留旧导出兼容）。
- task-09: InlineAttRefText props 增可选 onOpenWsRef（缺省不可点击，同附件 onOpenRef 语义）；内部解析换 parseInlineRefs（task-01 保留 parseInlineAttRefs 薄封装，既有消费零破坏）；turn-segment-views.tsx 仅消费 InlineAttRefTextWithPreview 既有导出。
