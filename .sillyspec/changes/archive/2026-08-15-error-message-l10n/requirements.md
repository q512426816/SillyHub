---
author: qinyi
created_at: 2026-08-15T10:05:00+08:00
change: 2026-08-15-error-message-l10n
project: backend
status: draft
---

# Requirements — 后端面向用户报错文案中文化

> author: qinyi
> created_at: 2026-08-15T10:05:00+08:00

- FR-01 范围 A 内 41 文件的英文 raise message 全部改为中文短语+行动指引。
- FR-02 技术 ID（UUID/路径/上游错误串）从 message 移入 details 字段，不丢失。
- FR-03 code / http_status / API 契约零变更；前端零改动。
- FR-04 机器对机器接口（daemon 内部 RPC / MCP 工具 / platform_sync / core
  启动校验）不改。
- FR-05 现有测试全量通过；断言旧英文 message 的测试改为断言异常类型/新中文。
- FR-06 新增守护测试：范围 A 文件清单内 raise message 不得以英文字母开头。
