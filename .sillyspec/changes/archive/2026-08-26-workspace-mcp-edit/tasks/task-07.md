---
author: qinyi
created_at: 2026-08-26 14:20:00
id: task-07
title_zh: "daemon预取挂点与合并注入"
title: "daemon 预取挂点 + 会话级缓存 + provider 合并注入"
priority: P0
depends_on: [task-05, task-06]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/cli.ts
  - sillyhub-daemon/src/mcp-config.ts
goal: 接通注入链路最后一公里：daemon.ts 预取三件套存会话级缓存，cli.ts provider 同步消费合并注入
acceptance: |
  1. daemon.ts _startInteractiveSession（:3560，唯一持有 execPayload.workspaceId 处）：有 workspaceId 时异步 fetchMcpBundle 预取，写入 Map<sessionId, McpBundle>；预取失败写空 bundle + warn，不阻塞会话创建（R-03/D-007@v2）
  2. cli.ts mainAgentMcpConfigProvider（:796 同步签名不变）：读缓存 bundle，mergeMcpConfigs 调用形如 mergeMcpConfigs([...bundle.whitelist, DAEMON_MCP_SERVER_NAME, FILE_MCP_SERVER_NAME], platformCfg, workspaceCfg, {内置双 server})——内置名必须并入白名单参数（D-006@v2，configs[0] 自动白名单只覆盖 platform 位）
  3. 同名覆盖优先级 builtin > workspace > platform；rejected 数组记 warn 日志（现状未记，本任务接上）
  4. 无 workspaceId（quick-chat/legacy shared）：provider 用空 workspace 配置，行为与现状一致（现状回归零）
  5. restore/reload 缓存缺失：重取一次，失败回落空 bundle + warn（Map<sessionId,bundle> 生命周期=会话）
  6. isMainAgentSession 谓词不动（stage 三态判定维持 2026-08-22/08-25 语义；分身不进三件套合并——D-008@v1）
verify: cd sillyhub-daemon && pnpm typecheck && pnpm exec vitest run tests/cli-session-manager-injection.test.ts
implementation: daemon.ts _startInteractiveSession 预取 + Map<sessionId,McpBundle> 缓存 + cli.ts provider 消费合并
constraints: ["provider 同步签名不变（D-007@v2）", "内置名并入白名单参数（D-006@v2）", "isMainAgentSession 三态不动", "分身不进三件套（D-008@v1）"]
provides:
  - contract: "provider 注入合并"
    fields: [mergeMcpConfigs 白名单参数, rejected warn, 会话级缓存, 回落, 合并优先级]
expects_from:
  task-05:
    - contract: "fetchMcpBundle"
      needs: [McpBundle, 预净化, 回落]
---

# task-07: 预取与注入接线

## 实现要点

1. 缓存放哪：daemon.ts 模块级 `Map<sessionId, McpBundle>`（会话级生命周期，会话结束清理防泄漏）；cli.ts 装配时把「读缓存」闭包传给 provider（保持 provider 同步签名）。
2. provider 内合并顺序：`mergeMcpConfigs(combinedWl, bundle.platform, bundle.workspace, {mcpServers: {[DAEMON_MCP_SERVER_NAME]: daemonServer, [FILE_MCP_SERVER_NAME]: fileServer}})`——既有内置构造（cli.ts:799-820 buildDaemonMcpServerConfig/buildFileMcpServerConfig）不动，仅从「空 platform + 内置」改为「三件套 + 内置」。
3. mcpRefs 第三层过滤（session-manager:1393-1425）不动——merge 返回后既有 ∩ 逻辑自然生效（CC-06 提示文案在 task-10）。
4. 头注释（mcp-config.ts §1）与 cli.ts provider 注释块更新为真实链路。
