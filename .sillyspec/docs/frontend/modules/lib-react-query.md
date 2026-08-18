---
schema_version: 1
doc_type: module-card
module_id: lib-react-query
author: qinyi
created_at: 2026-08-18 01:45:00
---

# React Query 基础设施（lib-react-query）

## 定位
React Query（@tanstack/react-query 5）基础设施两件套：`query-client.ts` 提供 `makeQueryClient()` 工厂（freshness-first 默认配置），`query-keys.ts` 提供集中式 query key 工厂。上层 Provider 在 `src/lib/providers.tsx` 的 `AppProviders`（useState 初始化器调工厂创建每会话实例 + QueryClientProvider + dev 才挂 Devtools）。供 `lib-use-agent-runs` / `lib-use-daemon-machines` / `lib-daemon-audit` / `lib-mcp-skills` hooks 及多个页面/组件消费。

## 契约摘要
`query-client.ts`：
- `makeQueryClient(): QueryClient` — 唯一导出。默认 queries 配置：`staleTime: 15_000` + `refetchOnWindowFocus: true`；`retry: (count, err) => err instanceof ApiError && err.status >= 500 ? count < 3 : false`（仅 5xx 重试至多 3 次，4xx 含 401/403/404 不重试）；全局不设 refetchInterval。

`query-keys.ts`：
- `queryKeys` 常量树（全部 `as const`）：
  - `agentRuns.list(workspaceId)`
  - `daemonRuntimes.list(params)` / `daemonMachines.list(params)` — 完整过滤/分页 params 进 key
  - `daemonVersion.all`
  - `workspaceSkillsView.detail(workspaceId)` / `workspaceMcpConfig.detail(workspaceId)`
  - `customSkills`：`all` / `manifest` / `content(name)`（按 skill 名参数化）
  - `mcpSettings`：`config` / `whitelist`

## 关键逻辑
```
providers.tsx: const [client] = useState(() => makeQueryClient())
  → 每个浏览器会话独立实例；禁止导出模块级单例
key 规则：凡影响查询结果的变量都进 key（params 变化 → 新查询，自动停旧启新）
```

## 注意事项
- **禁止模块级 QueryClient 单例**：App Router SSR 下会跨请求泄漏缓存（文件头 R-01 明示）；新消费方一律经工厂。
- staleTime 15s 是焦点刷新风暴修复（原 staleTime:0 致每次切回标签重发全部挂载查询）的产物；实时性由各 hook 自带 refetchInterval 保证，勿在全局再加。
- retry 只认 `ApiError` 且 status≥500；401 刷新由 token-refresh 层处理，不要在 retry 里补。
- 新增查询须在 `queryKeys` 注册 key 工厂再消费，避免拼错 key 静默去重到不存在的缓存；mutation 失效统一走对应 `*.all` 前缀。
- 模块地图登记的 `queryClient` 符号实际不存在——本模块只导出 `makeQueryClient` 工厂与 `queryKeys`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
