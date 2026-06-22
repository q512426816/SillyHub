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

## Patterns

- 架构|backend|frontend|daemon|三服务 → [Monorepo 三服务架构](patterns.md#monorepo-三服务架构)
- backend|模块|core|modules|router → [Backend 模块组织](patterns.md#backend-模块组织)
- sse|websocket|通信|http → [子项目间通信](patterns.md#子项目间通信)

## Known Issues

- daemon|python|node|重写|typescript → [sillyhub-daemon 从 Python 重写为 Node.js](known-issues.md#sillyhub-daemon-于-2026-06-14-从-python-重写为-nodejs)
- ci|hook|git-add|绕过|pretooluse → [CI hook 复合命令可绕过 claude PreToolUse 层](known-issues.md#ci-hook-复合命令可绕过-claude-pretooluse-层)
- daemon|session|卡死|重启|recovery|已修复 → [daemon 重启 session 恢复已修复](known-issues.md#-daemon-重启-session-恢复已修复gap-83--commit-40e21d3)
- agentrunlog|metadata|日志|submit-messages → [AgentRunLog 无 metadata 列](known-issues.md#agentrunlog-无-metadata-列三层日志-metadata-丢失)
- daemon|实例|taskkill|pid → [本机可能存在多个 daemon 实例](known-issues.md#本机可能存在多个-daemon-实例)
