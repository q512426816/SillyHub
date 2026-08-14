---
author: qinyi
created_at: 2026-08-15 00:32:00
---

# 需求（Requirements）— security-audit-remediation

## 功能需求

- FR-01 daemon WS（/api/daemon/ws）升级期必须校验凭据（X-API-Key/Bearer）且 principal.user_id == instance.user_id；无凭据 4001、归属不匹配 4003；daemon 客户端同 change 升级传 header。
- FR-02 claim_lease / pending-leases / heartbeat 必须校验 actor 与 runtime/daemon_instance 归属一致；不匹配 404。
- FR-03 LLM master key 不出现在任何下发 payload（claim payload / WS provider_config / 日志）；openai_chat 供应商经 /api/daemon/llm-proxy 透传可用；context.py **两处**（resolve_default + resolve_bound）全覆盖；proxy 端点含 usr-uid-pid model 归属断言。
- FR-04 file 模块 get_stream/get_meta/batch_meta/soft_delete/list 全部按 uploaded_by 或 WORKSPACE_READ 权限限定可见域；跨用户 404；platform_admin 豁免。
- FR-05 platform_sync：shpsync_ 可读写（token 派生 workspace）；JWT/shk_live_ 写端点一律 403，读端点按 CHANGE_READ 并集聚合；NULL-workspace 写路径关闭（含 approval）。
- FR-06 sync_documents 路径守卫改 relative_to；filename 白名单 `^[A-Za-z0-9._\-]+$`。
- FR-07 quick-chat 四端点按 lease metadata.actor_user_id 过滤（placement 补写锚点）；跨用户 404。
- FR-08 mission SSE 改 workspace-scoped TASK_READ。
- FR-09 workspace activate/init 改 workspace-scoped WORKSPACE_WRITE。
- FR-10 auth_deps 删除 token/api_key query 回退；前端 5 处依赖同 change 改 fetch-SSE / header 转传。
- FR-11 git_identity username/email 单行无控制字符校验。
- FR-12 claim_token 比较改 secrets.compare_digest。
- FR-13 markdown 渲染管线加 rehype-sanitize（markdown-text.tsx + 排查 @uiw 三处引用）。
- FR-14 deploy compose PG/MinIO/S3 弱口令默认值改 :?must set；5432/9000 端口收紧。

## 非功能需求

- NFR-01 anthropic 分支 provider_config 9 字段逐字不变（零回归）。
- NFR-02 每修复点先写失败测试再改实现；module 级测试策略。
- NFR-03 daemon vitest 全量不破；backend 命中模块 pytest 全绿。
- NFR-04 Windows/Linux/macOS 兼容（路径校验用 pathlib 不拼字符串）。
