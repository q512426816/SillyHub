# Knowledge Index

> 子代理任务开始前查询此文件，按关键词匹配，只读命中的知识文件。
> execute/quick 执行中发现的坑自动追加到 uncategorized.md，经用户确认后归类到对应文件。

<!-- 格式：关键词1|关键词2|关键词3 → 文件路径 -->
<!-- 示例：mybatis-plus|分页|Page → pagination.md -->
<!-- 示例：跨域|CORS|preflight → cors.md -->

## Conventions

- sillyspec|文档驱动|流程|验收 → [SillySpec 文档驱动开发流程](conventions.md#sillyspec-文档驱动开发流程)
- 构建|测试|lint|命令|pytest|ruff|pnpm|uv → [子项目构建/测试/lint 命令](conventions.md#子项目构建--测试--lint-命令)
- 目录|monorepo|结构|约定 → [目录约定](conventions.md#目录约定)
- commit|提交规范|message → [提交规范](conventions.md#提交规范)
- sillyspec|stage|fsm|verify|archive|流转|transition → [SillySpec 变更状态机](conventions.md#sillyspec-变更状态机stageenum--transition-map)
- backend|model.py|ruff|line-length|esm|.js → [backend Python 工程约定](conventions.md#backend-python-工程约定modelpy-单数--ruff-配置)
- daemon|esm|import|.js|扩展名|node → [daemon ESM import 必须 .js](conventions.md#daemon-esm-import-必须带-js-扩展名)

## Patterns

- 架构|backend|frontend|daemon|三服务 → [Monorepo 三服务架构](patterns.md#monorepo-三服务架构)
- backend|模块|core|modules|router → [Backend 模块组织](patterns.md#backend-模块组织)
- sse|websocket|通信|http → [子项目间通信](patterns.md#子项目间通信)
- agentrun|lease|编排|sessionmanager|执行链路 → [AgentRun + DaemonTaskLease 编排流程](patterns.md#agentrun--daemontasklease-编排流程)
- daemon|adapters|协议|stream-json|json-rpc|ndjson|多provider → [daemon adapters/ 多协议抽象](patterns.md#daemon-adapters-多协议抽象stream-json--json-rpc--jsonl--ndjson--text)

## Known Issues

- daemon|python|node|重写|typescript → [sillyhub-daemon 从 Python 重写为 Node.js](known-issues.md#sillyhub-daemon-于-2026-06-14-从-python-重写为-nodejs)
- ci|hook|git-add|绕过|pretooluse → [CI hook 复合命令可绕过 claude PreToolUse 层](known-issues.md#ci-hook-复合命令可绕过-claude-pretooluse-层)
- daemon|session|卡死|重启|recovery|已修复 → [daemon 重启 session 恢复已修复](known-issues.md#-daemon-重启-session-恢复已修复gap-83--commit-40e21d3)
- agentrunlog|metadata|日志|submit-messages → [AgentRunLog 无 metadata 列](known-issues.md#agentrunlog-无-metadata-列三层日志-metadata-丢失)
- daemon|实例|taskkill|pid → [本机可能存在多个 daemon 实例](known-issues.md#本机可能存在多个-daemon-实例)
- docker|backend|热重载|reload|rebuild|挂载 → [Docker backend 容器不热重载](known-issues.md#-docker-backend-容器不热重载挂载非-app无---reload)
- healthcheck|busybox|wget|http_proxy|unhealthy|误报 → [frontend healthcheck busybox wget 走 http_proxy 误报](known-issues.md#-frontend-healthcheck-busybox-wget-走-http_proxy-误报-unhealthy)
- daemon|pnpm|overrides|claude-agent-sdk|二进制|钉死|0.3.181 → [daemon pnpm overrides 钉死 claude-agent-sdk 8 平台二进制](known-issues.md#-daemon-pnpm-overrides-把-claude-agent-sdk-8-平台二进制硬钉-0.3.181)
- frontend|react-query|未启用|apifetch|zustand|双lockfile|antd|shadcn → [frontend react-query 未启用 + 双 UI 库](known-issues.md#-frontend-声明了-tanstackreact-query-但源码未启用实际数据层是-apifetch--zustand)
