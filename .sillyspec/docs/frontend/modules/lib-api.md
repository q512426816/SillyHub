---
schema_version: 1
doc_type: module-card
module_id: lib-api
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-api

## 定位
前端唯一 HTTP 客户端封装（`frontend/src/lib/api.ts`，约 230 行）。所有领域 lib 与页面均经 `apiFetch` 调后端，统一承担 URL 解析、鉴权注入、错误归一化、401 自动刷新重试、请求追踪。是整个前端数据层的基石，不携带任何领域语义。

## 契约摘要
- `apiFetch<T>(path, options?): Promise<T>` — 核心请求函数。`options.json` 序列化为 body；`options.query` 拼 query（数组用重复 key 编码 `?k=a&k=b` 适配 FastAPI `Query(list[...])`）。
- `getApiBaseUrl()` — 浏览器返回当前 origin（走 Next.js rewrite 代理 `/api/*`→后端）；SSR 返回 `INTERNAL_API_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL` / `localhost:8000`。
- `getDirectApiBaseUrl()` — 绕过代理的直连后端 URL，浏览器侧需 `NEXT_PUBLIC_API_BASE_URL`；供 SSE 等实时连接使用（代理缓冲会破坏流式）。
- `ApiError` — 抛出的错误类，字段 `code` / `status` / `requestId` / `details`，替代裸 `Error`。
- `safeUUID()` — 兼容非安全上下文（非 HTTPS 非 localhost）的 UUID 生成，`crypto.randomUUID` 不可用时降级为时间戳+随机数。

## 关键逻辑
```
apiFetch(path, opts):
  url = resolveUrl(path); 拼 query(跳过空值/空数组，数组重复 key)
  headers = { accept:json, "x-request-id": 新UUID }
  if session.accessToken: headers.Authorization = Bearer ${token}
  json !== undefined → content-type:json + body
  resp = fetch(url, init)  # 网络异常 → ApiError(code=network_error, status=0)
  payload = safeJsonParse(resp.text)
  if !resp.ok:
    err = isApiErrorPayload(payload) ? payload : { code:http_${status}, ... }
    if 401 && 未重试 && 非auth端点:
      refreshToken 存在且 hydrated → POST /api/auth/refresh → setTokens → 带 x-auth-retry:1 递归重试一次
      否则 session.clear() + 跳转 /login
    throw ApiError(status, err)
  return payload
```

## 注意事项
- 401 自动刷新仅重试一次，靠请求头 `x-auth-retry:1` 防死循环；`/api/auth/*` 端点不触发刷新逻辑（避免 refresh 本身 401 又触发 refresh）。
- `hydrated` 为 false（session 未从 storage 恢复）时即便 401 也不刷新，防止用空 refresh token 瞎猜。
- 浏览器端用相对路径走代理，使应用可从任意 origin（frp/局域网/localhost）访问，不在客户端 bundle 硬编码后端地址。
- SSE/EventSource 不能走 `apiFetch`（需直连且 token 入 query），故流式订阅另用 `getDirectApiBaseUrl` + token 参数模式。
- 数组 query 编码与 FastAPI 默认接收方式对齐，空数组被跳过不发，避免发出 `?k=` 噪音。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
