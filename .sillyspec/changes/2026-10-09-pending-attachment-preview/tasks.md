---
author: flow-machine-draft
created_at: 2026-10-09T02:41:20.771Z
---
# 任务注册表（Tasks）— 2026-10-09-pending-attachment-preview

- [x] task-01: session-input-bar.tsx 待发 chips 文件名区改按钮（title 带「点击在线预览」）+ FilePreviewModal 预览 state（fetchAttachmentBlob + officeSource），验证：tsc 无错
- [ ] task-02: group-chat-panel.tsx 待发 chips 同款改造，验证：tsc 无错
- [ ] task-03: 测试——session-input-bar-upload.test.tsx 新增「点击文件名开预览」「点 X 删除不开预览」两用例（mock 补 fetchAttachmentBlob + FilePreviewModal），验证：vitest 该文件全绿
- [ ] task-04: 测试——group-chat-panel.test.tsx 新增待发 chip 点击预览用例，验证：vitest 该文件全绿（含既有附件用例零回归）
