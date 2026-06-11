---
schema_version: 1
doc_type: module-card
module_id: lib-api
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-api

## 定位
全局 HTTP 客户端封装。所有 lib/* API 模块都通过此模块发起请求。不直接被页面调用。

## 契约摘要
- `apiFetch<T>(path, options?)` — 核心请求函数，支持 JSON body、query 参数、自定义 headers
- `getApiBaseUrl()` — 获取 API 基础 URL（浏览器用相对路径，SSR 用环境变量）
- `getDirectApiBaseUrl()` — 获取直连后端 URL（绕过 Next.js rewrite，用于 SSE）
- `ApiError` — 自定义错误类（含 code/status/requestId/details）
- `ApiRequestOptions` — 请求选项类型

## 关键逻辑
- 浏览器端请求通过 Next.js rewrite 代理（相对路径），SSR 直接请求后端
- 自动注入 Bearer token（从 Zustand session store 获取）
- 自动生成 x-request-id（crypto.randomUUID 或 fallback）
- 401 时自动尝试 refresh token + 重试一次，失败则清除 session 并跳转 /login
- 请求失败抛出 ApiError，包含结构化错误信息

## 注意事项
- token 自动刷新逻辑内联在 apiFetch 中，不依赖 lib/auth
- resolveUrl 在浏览器和 SSR 中行为不同，测试时需注意环境

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
