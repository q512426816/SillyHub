---
schema_version: 1
doc_type: module-card
module_id: lib-api
author: qinyi
created_at: 2026-08-18 01:45:00
---

# API 客户端封装（lib-api）

## 定位
前端唯一 HTTP 客户端封装 + 类型真相源（`frontend/src/lib/api.ts` 约 191 行 + `frontend/src/lib/api-types.ts` 约 3.29 万行生成物）。所有领域 lib 与页面均经 `apiFetch` 调后端，统一承担 URL 解析、鉴权注入、错误归一化、401 单飞刷新重试、请求追踪；不携带任何领域语义。

`api-types.ts` 由 OpenAPI 生成（`pnpm gen:types`，经 `scripts/gen-api-types.mjs` 跑后端 `dump_openapi.py` → `openapi-typescript`），**禁止手写**；`gen:types:check` 以 git diff 守护漂移（根 CLAUDE.md 规则 21）。

## 契约摘要
- `apiFetch<T>(path, options?): Promise<T>` — 核心请求函数。
  - `options.json` 序列化为 body（自动加 `content-type: application/json`）。
  - `options.query` 拼 query：跳过空值/空串/空数组；数组用重复 key `?k=a&k=b`（适配 FastAPI `Query(list[...])` 默认接收）。
- `getApiBaseUrl(): string` — 浏览器返回当前 origin（走 Next.js rewrites 代理 `/api/*`→后端）；SSR 返回 `INTERNAL_API_BASE_URL ?? NEXT_PUBLIC_API_BASE_URL ?? http://localhost:8000`。
- `ApiError` — 统一错误类，字段 `code` / `status` / `requestId` / `details`；网络异常抛 `code=network_error, status=0`。
- `safeUUID()` — 兼容非安全上下文（非 HTTPS 非 localhost）的 UUID 生成：`crypto.randomUUID` 可用则用，否则降级时间戳+随机数；兼作 `x-request-id` 生成器。
- `api-types.ts` — `paths` / `components.schemas` 形状供各领域 lib 以 `components["schemas"]["Xxx"]` 索引复用，消除手写类型漂移。

## 关键逻辑
```
apiFetch(path, opts):
  url = resolveUrl(path); 拼 query(跳过空值/空数组，数组重复 key)
  headers = { accept:json, "x-request-id": 新UUID }; 有 accessToken → + Bearer
  resp = fetch(url)  # 网络异常 → ApiError(network_error, status=0)
  payload = safeJsonParse(resp.text)
  if !resp.ok:
    if 401 && 无 x-auth-retry:1 && 非 /api/auth/* 端点:
      newToken = ensureFreshAccessToken()   # lib-token-refresh 单飞（模块级 inflight）
      newToken 有 → 带 x-auth-retry:1 递归重试一次（新 token 已写回 store）
      newToken 无 → session.clear() + 跳 /login
    throw ApiError(status, payload 是标准错误体 ? payload : http_${status} 兜底)
  return payload
```

## 注意事项
- 401 自动刷新仅重试一次，靠请求头 `x-auth-retry:1` 防死循环；`/api/auth/*` 端点不触发刷新（避免 refresh 自身 401 又触发刷新）。
- 刷新逻辑已从 api.ts 内联迁至 `lib-token-refresh.ensureFreshAccessToken`：模块级 inflight 保证并发 401 风暴只发 1 次 POST /api/auth/refresh；未登录/未 hydrate/refresh 失败均返回 null（走清 session + 跳登录）。
- 浏览器端用相对路径走 rewrites 代理，应用可从任意 origin（frp/局域网/localhost）访问，客户端 bundle 不硬编码后端地址。
- SSE/流式订阅不走 `apiFetch`：`lib-agent-stream` 用 `getApiBaseUrl` + `lib-fetch-sse.fetchSse`（token 走 Authorization header）。
- 错误体识别 `isApiErrorPayload` 只认 `{code:string, message}` 形状；非 JSON 响应体原样塞进 `details`，`message` 用 `resp.statusText` 兜底。
- `_module-map` main_symbols 中的 `getDirectApiBaseUrl` 已不存在于源码（历史符号），以本卡为准。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
