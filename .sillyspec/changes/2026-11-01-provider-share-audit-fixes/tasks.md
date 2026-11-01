---
author: flow-machine-draft
created_at: 2026-11-01T23:20:09.257Z
---
# 任务注册表（Tasks）— 2026-11-01-provider-share-audit-fixes

- [x] task-01: 对 /api/llm-providers/{非UUID}/shares 传畸形 UUID 时返回 422 JSON 错误体(不再 500),合法 UUID 路径零回归
- [x] task-02: 共享弹窗 DialogDescription 与产品文档明示:共享后解密密钥会下发到会话实际运行的守护进程(包括对方自己的机器),仅共享给可信用户
- [x] task-03: 迁移 20261030160000 的 docstring/注释如实描述降级实际删除范围,不再声称「只撤销本迁移授予的」
- [x] task-04: 新增 HTTP 层用例覆盖 GET /usable(路由不被 /{provider_id} 遮蔽/共享行脱敏)与 shares CRUD(201/204/404 语义),全绿
- [x] task-05: 新增 claim 注入链用例:runtime 属主≠会话属主时共享供应商经 _inject_provider_config 注入 payload.provider_config,且 session 缺行回落 fallback_user_id,全绿
- [x] task-06: 相关 backend/frontend 测试全绿,lint 零新增
