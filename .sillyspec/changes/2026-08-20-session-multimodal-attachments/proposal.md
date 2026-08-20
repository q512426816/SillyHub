# Proposal：会话附件（图片多模态 + 文件落盘）

- 变更：2026-08-20-session-multimodal-attachments
- 规模：large（跨 backend / frontend / sillyhub-daemon 三端 + MinIO 存储 + DB 迁移 + 协议扩展）
- 参考：E:/Deepseek/deepseek-harness attachment 能力族（ImageAttachmentRef / Limits / 内容寻址 / 提交时持久化）
- 方案：A 引用式（用户已确认）

## 问题

/sessions 会话只能发纯文本。图片报错、设计稿、日志文件等场景无法把材料交给模型
——多模态是 Claude Code 生态刚需。

## 方案概述

选文件即上传 MinIO 得 attachment_id（内容寻址 + session_attachments 元数据行）；
发消息时 inject 带 attachment_ids：图片/PDF 由 backend 预读组 base64 内联下发
（帧总量 8MB 闸门，超限 daemon 回拉），daemon 转 SDK ImageBlock/DocumentBlock
多模态直读；其他文件 daemon 下载到会话 `cwd/attachments/` 并在 prompt 附路径
清单，agent 用 Read/Grep 等工具消费。历史回显经 user_input 日志标记行 + 按 id
拉存储。codex 会话三层门控禁用附件。

## 价值

- 图片：模型直接看图（截图排障、UI 比对）
- 文件：agent 工具消费任意类型文件（日志分析、文档处理）
- 历史：重进会话附件完整回显
- 审计：附件元数据入库，归属可查

## 非目标

- 附件内容加密（与文件中心同安全模型：私有桶 + 归属校验）
- 对象存储垃圾回收自动化（V1 孤儿对象兜底声明，D-5）
- codex 引擎多模态（协议不支持，D-6）
- 附件编辑/版本（不可变模型，对齐参考实现）
