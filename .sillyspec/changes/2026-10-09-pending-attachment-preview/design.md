---
author: flow-machine-draft
created_at: 2026-10-09T02:41:20.771Z
---
# 设计记录（Design Record）— 2026-10-09-pending-attachment-preview

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题：单聊输入栏（session-input-bar.tsx）与群聊面板（group-chat-panel.tsx）的待发送附件 chips 是纯展示 `<span>`（图标+文件名+大小+X），点击无任何反应——附件虽已上传到服务端（选文件即传），用户发送前却无法查看内容。

方案：复用已发送消息附件的成熟预览链路（attachment-chips.tsx → FilePreviewModal）。附件上传完成后已持有服务端 id（AttachmentRead），点击 chip 文件名区即以 `fetch: () => fetchAttachmentBlob(att.id)`、`meta: { name, size: bytes }`、`officeSource: { source: "session_attachment", id }` 组装 FilePreviewTarget 打开 FilePreviewModal——图片走 ImagePreviewer、office 家族走 DS 高保真降级链，与已发送附件完全同一体验。两处输入区各持一对 previewTarget/previewOpen state，组件层零新依赖（FilePreviewModal 与 fetchAttachmentBlob 均既有导出）。结构上把 chip 的文件名区从 `<span>` 改为 `<button type="button">`（X 删除按钮保持独立兄弟节点），HTML 不嵌套按钮、事件天然不串。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

不动任何后端端点/API 封装签名。前端组件内部行为变化：

- `session-input-bar.tsx`：新增 FilePreviewModal/`FilePreviewTarget`/`fetchAttachmentBlob` import 与预览 state；`SessionInputBarProps` 无新增 prop（对外契约不变）。
- `group-chat-panel.tsx`：同上，面板组件 props 无变化。
- 待发 chip 文件名区从 `<span>` 变 `<button>`，title 统一为 `${name} · ${大小}（点击在线预览）`；X 按钮 aria-label（`移除附件 ${name}`）不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

预览按点击时刻的附件快照（闭包捕获 att）组装 fetch；上传中（uploading>0）的 chip 不存在（附件列表只有上传完成项），无迟到态。上传失败不产生 chip，预览无从触发。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

预览是只读拉取（GET content），不写任何数据；与移除并发时最坏情况是 blob 拉取 404 → FilePreviewModal 内建 error 重试态（既有 R-07 行为），不崩溃。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

预览窗 open 时删除该附件 → chips 消失但弹窗内容已加载则可继续看；关闭弹窗即释放（useObjectUrl revoke 既有逻辑）。切换会话/组件卸载 → React state 随组件销毁，无泄漏。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

预览 target 携带附件 id 走鉴权拉取（fetchAttachmentBlob 带 Bearer + 401 刷新重试），附件 id 会话无关（草稿态全局），无跨工作区串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：测试面——多处既有 harness 以工厂 mock `@/lib/api/session-attachments`，缺新用到的 `fetchAttachmentBlob` 导出时组件 import 可能拿到 undefined；本变更只在实际点击预览时调用该函数，且对涉及的 mock 顺手补齐该导出。放弃的方案：给 chip 整体包 `<button>` 再给 X `stopPropagation`——嵌套按钮非法 HTML 且事件冒泡补丁脆弱，改为文件名区与 X 两个独立兄弟按钮，无冒泡依赖。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/session-input-bar.tsx | 待发 chips 文件名区改可点击按钮 + FilePreviewModal 预览 state |
| 修改 | frontend/src/components/group-chat/group-chat-panel.tsx | 群聊待发 chips 同款可点击预览 |
| 修改 | frontend/src/components/daemon/__tests__/session-input-bar-upload.test.tsx | 新增预览/删除不串扰用例 + mock 补 fetchAttachmentBlob |
| 修改 | frontend/src/components/group-chat/__tests__/group-chat-panel.test.tsx | 新增群聊待发 chip 点击预览用例 |
| 修改 | frontend/src/components/daemon/__tests__/session-input-bar-height.test.tsx | 旧 harness 补 fetchAttachmentBlob mock |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx | 旧 harness 补 fetchAttachmentBlob mock + chip title 锚点跟随新契约 |
| 修改 | frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx | 旧 harness 补 fetchAttachmentBlob mock + chip title 锚点跟随新契约 |
