---
author: flow-machine-draft
created_at: 2026-10-09T02:41:20.771Z
---
# 提案书（Proposal）— 2026-10-09-pending-attachment-preview

## 动机

任务原话转写：会话输入区待发送附件 chips 仅展示不可点击，用户上传图片/文件后未发送时无法再次查看内容，需要点击预览。

成功标准：
- 单聊输入栏（session-input-bar）待发附件 chip 点击文件名区打开 FilePreviewModal 在线预览（复用已发送附件的 fetchAttachmentBlob + officeSource 链路）
- 群聊面板（group-chat-panel）待发附件 chip 同样支持点击预览
- 预览与移除互不干扰：点击 X 删除附件不触发预览，点击预览不影响删除
- 既有上传/移除/发送行为零回归，相关测试全绿

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 单聊输入栏（session-input-bar）待发附件 chip 点击文件名区打开 FilePreviewModal 在线预览（复用已发送附件的 fetchAttachmentBlob + officeSource 链路）
2. 群聊面板（group-chat-panel）待发附件 chip 同样支持点击预览
3. 预览与移除互不干扰：点击 X 删除附件不触发预览，点击预览不影响删除
4. 既有上传/移除/发送行为零回归，相关测试全绿

## 成功标准（可验证）

1. 单聊输入栏（session-input-bar）待发附件 chip 点击文件名区打开 FilePreviewModal 在线预览（复用已发送附件的 fetchAttachmentBlob + officeSource 链路）
2. 群聊面板（group-chat-panel）待发附件 chip 同样支持点击预览
3. 预览与移除互不干扰：点击 X 删除附件不触发预览，点击预览不影响删除
4. 既有上传/移除/发送行为零回归，相关测试全绿
