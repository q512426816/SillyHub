---
author: WhaleFall
created_at: 2026-08-27 14:32:24
---

# daemon 模块变更索引

- ql-20260827-010-e472 | 会话附件 daemon 落盘改内容寻址命名 attachments/{sha256}.{白名单ext}（同内容复用、废弃同名 (n) 序号），注入清单注原文件名并明确无需浏览比对其他文件
- ql-20260827-014-d438 | reopen 会话级供应商凭证链补全——backend 建 lease 补写 session_llm_provider_id + SESSION_RESUME 携解密 provider_config；daemon resume 路由透传 record.providerConfig（修 reopen 后 SDK 无凭证 "Not logged in" 秒退、会话约 2s 回 ended 死亡循环）
