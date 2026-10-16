---
author: qinyi
created_at: 2026-10-16 16:40:00
---

# 模块变更索引（changelog sidecar）

## 2026-10-16 — token-refresh 状态码分流（变更 2026-10-16-fix-auth-random-logout task-03）
- `doRefresh` 按状态码分流：2xx 返回新对；401/403/其余 4xx 返回 null（明确失效，api.ts 401 收口清会话跳登录）；**5xx/408/429 抛 ApiError（status 透传）不清会话**——修复「部署窗口/代理抖动 5xx 被当登录失效误踢」根因二（D-004@v1；对齐 ql-20260917-005 timeout 抛错通道先例）。
- `api.ts` 401 收口契约注释同步（代码逻辑不变：null 才 clear+redirect，抛错自然传播）。
- 用例：frontend/src/lib/__tests__/token-refresh.test.ts +3（503/504 抛错不清会话、408/429 归类、401 返 null）；13 处 `ensureFreshAccessToken` 调用点抛错容错审计通过（app-shell catch 兜底；其余与 timeout 先例同构）。
- 2026-10-16-change-files-sync-result | change 文件树「刷新」同步链路三层静默失败——后端 RPC 预算 3s 短于实测 6~13.5…
