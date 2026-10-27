---
author: flow-machine-draft
created_at: 2026-10-27T00:43:43.805Z
---
# 任务注册表（Tasks）— 2026-10-27-scheduled-send-attachments

- [x] task-01: ScheduledSendModal 新增可选 attachments prop——弹窗「将发送的内容」区块下渲染附件预览行（图标+文件名），无附件不占位；空态判定放宽为「空文本且无附件」才禁用确认与提示（验证：组件渲染无附件形态与现状一致）
- [x] task-02: dialog 模式 confirmSchedCreate 组装 pendingAttachments id 进请求体 attachment_ids + 成功后按 onSendSettled 同款清附件（chips 过滤 + clearAttachmentsRef + meta 镜像逐 id 删）；ScheduledSendModal 挂载点传 attachments（验证：dialog 测试断言请求体与清理）
- [x] task-03: page 模式 confirmSchedCreate 同款改造（带附件+成功清理+弹窗传参），与 dialog 口径逐字对齐（验证：两处 diff 对称、lint 过）
- [x] task-04: 新增 session-panel-dialog-scheduled-attachments.test.tsx 覆盖 FR-01..04 四场景断言；跑该文件 + scheduled-messages-bar 既有测试 + 触及文件 lint 全绿（验证：测试命令输出全 pass）
