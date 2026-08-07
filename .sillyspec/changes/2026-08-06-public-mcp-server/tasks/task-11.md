---
id: task-11
title: webhook dispatcher + mcp_webhooks CRUD API (HMAC-SHA256 signature + exponential backoff retry)
title_zh: webhook 投递器 + mcp_webhooks CRUD API（HMAC-SHA256 签名 + 指数退避重试最多 5 次）
author: qinyi
created_at: 2026-08-06 13:52:28
priority: P1
depends_on: [task-01]
blocks: [task-12]
requirement_ids: [FR-07]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/mcp_gateway/service.py
  - backend/app/modules/mcp_gateway/router.py
  - backend/app/main.py
provides:
  - contract: WebhookDispatcher
    fields: [deliver, events, retry_policy]
goal: >
  mcp_gateway/service.py 建 WebhookDispatcher（worker 终态按 mcp_webhooks 配置异步投递，HMAC-SHA256 签名 + 指数退避最多 5 次
  不阻塞主流程）加 workspace 级 CRUD API（POST/GET/DELETE /workspaces/<wid>/mcp-webhooks），main.py include_router 注册（G-1）；task-12 complete_lease 钩子调 deliver 触发投递。
implementation:
  - service.py WebhookDispatcher.deliver(workspace_id, event, payload) 查该 workspace active 且 events 匹配（事件名或 "*"）的 mcp_webhooks，逐条 asyncio.create_task 异步投递不 await 不阻塞调用方；每条 hmac.new(secret_plain, body, sha256).hexdigest() 写 X-Signature header，body 为 event/workspace_id/mission_id/worker_id/status/error_code/timestamp 的 JSON（design §7.3）
  - httpx.AsyncClient(trust_env=False, timeout=10) POST webhook.url（对齐 finalizer.py:149 / delegation.py:183 出站 httpx 模式，trust_env=False 不继承宿主代理）；指数退避 1s/4s/16s/64s 共最多 5 次（attempt 1 立即发，2-5 失败后 asyncio.sleep 退避再重试），2xx 成功，重试耗尽或异常 structlog warn 不抛
  - secret 加密存取：注册时 get_cipher().encrypt(plaintext) 返回 (ciphertext, key_id) 入库（task-01 ORM 已落加密列 + key_id，本 task 不改表），投递前 get_cipher().decrypt(ciphertext, key_id) 还原明文算 HMAC，明文绝不落日志/响应
  - router.py 建 APIRouter 前缀 /workspaces、tag mcp-webhooks；POST /<wid>/mcp-webhooks 注册（body url+secret+events[]，落 token_id+workspace_id，响应 id+url+events+active 不回显 secret）、GET /<wid>/mcp-webhooks 列表（不返 secret）、DELETE /<wid>/mcp-webhooks/<id> 返 204；鉴权 require_permission(Permission.WORKSPACE_WRITE)
  - main.py app.include_router(mcp_router, prefix="/api")（G-1，与 task-02 同 router 复用，落 /api/workspaces/<wid>/mcp-webhooks）
acceptance:
  - POST 注册 secret 加密入库（get_cipher().decrypt 可还原，明文不存表不回显）；GET 不含 secret；DELETE 后该 webhook 不再被 deliver 命中
  - deliver 按 events 过滤（"worker.completed" 仅命中订阅该事件或 "*" 的 webhook），X-Signature 接收方 hmac 校验通过；投递异步不阻塞调用方（deliver 返回即释放不 await httpx）
  - 5xx/超时/连接错误触发指数退避（1s/4s/16s/64s）最多 5 次，2xx 不重试，重试耗尽记 audit 不抛异常不影响主流程
  - 三端点经 require_permission(WORKSPACE_WRITE) 越权 403；main.py include_router 后路由实际可达
verify:
  - cd backend && uv run pytest app/modules/mcp_gateway -q --no-cov
constraints:
  - HMAC-SHA256(secret, body) 写 X-Signature header（hex），body 含 event/workspace_id/mission_id/worker_id/status/error_code/timestamp（design §7.3）
  - 指数退避 1s/4s/16s/64s 最多 5 次（design §7.3），2xx 成功不重试，5xx/超时/异常才退避
  - secret 加密存复用 get_cipher 不存明文（design §8.2），明文不入日志/响应；mcp_webhooks 表结构归 task-01 本 task 不动
  - 投递异步不阻塞主流程（asyncio.create_task 派发，失败 best-effort），投递结果可落 mcp_webhook_deliveries 审计表（可选非硬性）；CRUD 鉴权 require_permission(WORKSPACE_WRITE) 对齐 task-02，complete_lease 钩子接线归 task-12
---
