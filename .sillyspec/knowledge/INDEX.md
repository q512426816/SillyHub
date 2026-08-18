# Knowledge Index

> 子代理任务开始前查询此文件，按关键词匹配，只读命中的知识文件。
> execute/quick 执行中发现的坑暂存到 uncategorized.md，成熟后归类到下列分类文件并在此加索引。

<!-- 格式：关键词1|关键词2|关键词3 → 文件路径 -->
<!-- 示例：mybatis-plus|分页|Page → pagination.md -->
<!-- 示例：跨域|CORS|preflight → cors.md -->

## Conventions
- 模块卡片|标题|title|H1|中文|平台解析|文档列表 → [模块卡片 H1 用中文名（module-id）](conventions.md#模块卡片-h1-用中文名module-id)

- sillyspec|文档驱动|流程|验收 → [SillySpec 文档驱动开发流程](conventions.md#sillyspec-文档驱动开发流程)
- 构建|测试|lint|命令|pytest|ruff|pnpm|uv → [子项目构建/测试/lint 命令](conventions.md#子项目构建--测试--lint-命令)
- 目录|monorepo|结构|约定 → [目录约定](conventions.md#目录约定)
- commit|提交规范|message → [提交规范](conventions.md#提交规范)
- sillyspec|stage|fsm|verify|archive|流转|transition → [SillySpec 变更状态机](conventions.md#sillyspec-变更状态机stageenum--transition-map)
- backend|model.py|ruff|line-length|esm|.js → [backend Python 工程约定](conventions.md#backend-python-工程约定modelpy-单数--ruff-配置)
- daemon|esm|import|.js|扩展名|node → [daemon ESM import 必须 .js](conventions.md#daemon-esm-import-必须带-js-扩展名)
- basemodel|apperror|异常命名|分层|schema.py|service|请求内实例化|sqlmodel基类 → [backend 模块分层与基类/异常约定](conventions.md#backend-模块分层与基类异常约定routerserviceschema--basemodel--apperror)
- sse|fetch-sse|eventsource|流式|ReadableStream|authorization → [前端 SSE 消费统一 fetch-sse：token 走 Authorization header，禁用 EventSource](conventions.md#前端-sse-消费统一-fetch-ssetoken-走-authorization-header禁用-eventsource)
- tailwind|md:|断点|视口|容器断点|侧栏|grid-cols → [Tailwind md: 是视口断点非容器断点：侧栏内嵌组件禁用响应式前缀](conventions.md#tailwind-md-是视口断点非容器断点侧栏内嵌组件禁用响应式前缀)

## Patterns

- 架构|backend|frontend|daemon|三服务 → [Monorepo 三服务架构](patterns.md#monorepo-三服务架构)
- backend|模块|core|modules|router → [Backend 模块组织](patterns.md#backend-模块组织)
- sse|websocket|通信|http → [子项目间通信](patterns.md#子项目间通信)
- agentrun|lease|编排|sessionmanager|执行链路 → [AgentRun + DaemonTaskLease 编排流程](patterns.md#agentrun--daemontasklease-编排流程)
- daemon|adapters|协议|stream-json|json-rpc|ndjson|多provider → [daemon adapters/ 多协议抽象](patterns.md#daemon-adapters-多协议抽象stream-json--json-rpc--jsonl--ndjson--text)
- storage|minio|对象存储|存储后端|文件中心|aiobotocore|s3 → [平台文件中心：对象存储抽象](patterns.md#平台文件中心对象存储抽象storagebackend--factory--miniobackend)
- 鉴权|token|shk_live_|shpsync_|shmcp_|mcp_token|写通道|403 → [四轨鉴权 token 分轨：JWT / shk_live_ / shpsync_ / shmcp_](patterns.md#四轨鉴权-token-分轨jwt--shk_live_--shpsync_--shmcp_)
- base_ts|base_version|乐观锁|字典序|冲突|进度上行 → [platform_sync 两套乐观锁语义：base_ts 字典序与 base_version 整数版本](patterns.md#platform_sync-两套乐观锁语义base_ts-字典序与-base_version-整数版本)
- spec|增量同步|manifest|fileop|spec-sync|spec-manifest|软删 → [Spec 文件增量同步协议：manifest 比对 + FileOp 上行 + apply_ops 单写者](patterns.md#spec-文件增量同步协议manifest-比对--fileop-上行--apply_ops-单写者)
- change_write|代写|占坑|claim|daemon_change_writes|回灌|sync-manual → [Daemon 代写队列：占坑 commit + lease-polling claim + GC 回灌](patterns.md#daemon-代写队列占坑-commit--lease-polling-claim--gc-回灌)

## Known Issues

- daemon|python|node|重写|typescript → [sillyhub-daemon 从 Python 重写为 Node.js](known-issues.md#sillyhub-daemon-于-2026-06-14-从-python-重写为-nodejs)
- ci|hook|git-add|绕过|pretooluse → [CI hook 复合命令可绕过 claude PreToolUse 层](known-issues.md#ci-hook-复合命令可绕过-claude-pretooluse-层)
- daemon|session|卡死|重启|recovery|已修复 → [daemon 重启 session 恢复已修复](known-issues.md#-daemon-重启-session-恢复已修复gap-83--commit-40e21d3)
- agentrunlog|metadata|日志|submit-messages → [AgentRunLog 无 metadata 列](known-issues.md#agentrunlog-无-metadata-列三层日志-metadata-丢失)
- daemon|实例|taskkill|pid → [本机可能存在多个 daemon 实例](known-issues.md#本机可能存在多个-daemon-实例)
- docker|backend|热重载|reload|rebuild|挂载 → [Docker backend 容器不热重载](known-issues.md#-docker-backend-容器不热重载挂载非-app无---reload)
- healthcheck|busybox|frontend|已解决|node-fetch → [frontend healthcheck busybox 误报已解决](known-issues.md#-frontend-healthcheck-busybox-误报问题已解决commit-46591be0)
- daemon|pnpm|overrides|claude-agent-sdk|二进制|钉死|0.3.181 → [daemon pnpm overrides 钉死 claude-agent-sdk 8 平台二进制](known-issues.md#-daemon-pnpm-overrides-把-claude-agent-sdk-8-平台二进制硬钉-0.3.181)
- frontend|react-query|已启用|queryclient|apifetch|zustand → [frontend react-query 已正式启用](known-issues.md#-frontend-react-query-已正式启用2026-07-openapi-类型迁移commit-fecaa155--29b3c86b)
- frontend|lockfile|antd|shadcn|双ui库 → [frontend 与 daemon 各自独立 lockfile + 双 UI 库并存](known-issues.md#-frontend-与-daemon-各自独立-lockfile--双-ui-库并存)
- audit|audit_hooks|审计|auditlog|测试|生产 → [audit_hooks 只在测试 lifespan 注册](known-issues.md#-audit_hooks-只在测试-lifespan-注册生产审计要业务代码显式写-auditlog)
- docker|postgres|pg|端口|映射|alembic|连不上 → [全 Docker 部署本地 PG 容器端口未映射 host](known-issues.md#-全-docker-部署本地-pg-容器端口未映射-hostrun-alembicpytest-连不上)
- export-excel|路由顺序|422|uuid|路径参数|item_id|fastapi|ppm|导出|字面量 → [ppm export-excel 路由必须前置 item_id](known-issues.md#-ppm-导出-export-excel-路由必须前置于-item_id-路由)
- alembic|migration|多head|revision|crash|并行 → [alembic 并行变更撞 revision 多 head：启动 crash-loop](known-issues.md#-alembic-并行变更撞-revision-多-head启动-crash-loop)
- gen:types|api-types|漂移|e2e|playwright|puppeteer|闸门 → [前端测试闸门缺口：gen:types:check 未进 CI，E2E 零落地](known-issues.md#-前端测试闸门缺口gentypescheck-未进-cie2e-零落地)
- mcp|fastmcp|锁版|1.29|mcp_gateway|升级 → [mcp Python SDK 锁死 v1 线：v2 移除 FastMCP 与平台 mount 冲突](known-issues.md#-mcp-python-sdk-锁死-v1-线v2-移除-fastmcp-与平台-mount-冲突)
- bind mount|stat|性能|reparse|scandir|幽灵200|windows → [Windows Docker bind mount stat 性能断崖：spec_root fs 重循环必炸](known-issues.md#-windows-docker-bind-mount-stat-性能断崖spec_root-fs-重循环必炸)
- worktree|gc|expires_at|租约|回收|泄漏 → [worktree 过期租约无自动 GC：expires_at 与索引闲置](known-issues.md#-worktree-过期租约无自动-gcexpires_at-与索引闲置)
- spec_guardian|tool_gateway|死代码|run_guard|守护门 → [spec_guardian 死代码与 tool_gateway 注释失配：守护门从未在生产生效](known-issues.md#-spec_guardian-死代码与-tool_gateway-注释失配守护门从未在生产生效)
- god 文件|daemon.ts|session-manager|task-runner|大文件 → [daemon 三个 3000+ 行 god 文件（daemon.ts 4047 / session-manager.ts 3897 / task-runner.ts 3156）](known-issues.md#-daemon-三个-3000-行-god-文件daemonts-4047--session-managerts-3897--task-runnerts-3156)

## SillySpec Gotchas

- sillyspec|execute|worktree|基线|commit|apply|死循环 → [execute 启动前规范文件须 commit](sillyspec-gotchas.md#execute-启动前主仓库规范文件必须-commitworktree-apply-前提)
- sillyspec|worktree|未提交|基线|子代理 → [worktree 基线不含未提交改动](sillyspec-gotchas.md#execute-的-worktree-基线不含未提交改动)
- sillyspec|sqlite|pragma|foreign_keys|cascade|清理|孤儿 → [SQLite PRAGMA foreign_keys 默认关闭](sillyspec-gotchas.md#sqlite-pragma-foreign_keys-默认关闭致-cascade-失效清理孤儿变更)
- sillyspec|嵌套|.sillyspec|二级 runtime|cwd|变更目录 → [plan/execute 嵌套 .sillyspec 副作用](sillyspec-gotchas.md#planexecute-子代理可能把-cwd-设到变更目录产生嵌套-sillyspec-副作用)
- sillyspec|execute|cwd|pnpm|子项目|重置|重开 → [execute worktree 内跑 pnpm 后 cwd 持久](sillyspec-gotchas.md#execute-worktree-内跑-pnpm-后-bash-cwd-持久致-sillyspec-命令在子项目上下文重置)
- sillyspec|worktree|node_modules|junction|子代理|落点 → [worktree 无 node_modules + 子代理 cwd](sillyspec-gotchas.md#execute-worktree-无-node_modules--子代理-cwd-需显式-worktree-路径)
- sillyspec|plan|execute|contract|task 编号|wave|校验 → [plan→execute contract task 编号递增](sillyspec-gotchas.md#planexecute-contracttask-编号须严格按拓扑-wave-递增)
- sillyspec|execute|exec-run|review.json|残留|复用 → [exec-run ID 复用 review.json 残留](sillyspec-gotchas.md#execute-的-exec-run-id-可能复用旧目录reviewjson-残留需先-read-再覆盖)
- sillyspec|plan|postcheck|多变更|resolvechangedir|空 progress → [plan postcheck 多变更校验错](sillyspec-gotchas.md#plan-postcheck-多变更环境校验错变更progressjson-空--sort-reverse)
- sillyspec|reopen|from-step|done|回填|completed|重开 → [reopen --from-step N 后 --done 会把后续未执行步骤回填 completed](sillyspec-gotchas.md#reopen---from-step-n-后---done-会把后续未执行步骤回填-completed)

## Testing Gotchas

- pytest|patch|局部导入|函数内 import|mock → [pytest patch 函数内局部导入](testing-gotchas.md#后端pytest-patch-函数内局部导入的目标)
- pytest|docker|venv|/host-projects|容器内测试 → [Docker 后端容器跑 pytest](testing-gotchas.md#后端无本地-venv-时在-docker-后端容器跑-pytest)
- 前端测试|menu|permission|重复 key|querybylabeltext|picker → [MENU_PERMISSION_GROUPS 重复 key](testing-gotchas.md#前端menu_permission_groups-跨-menu-重复-permissionkey-致-querybylabeltext-失败)
- antd|datepicker|dayjs|locale|中文|日历表头 → [antd v5 DatePicker dayjs locale](testing-gotchas.md#前端antd-v5-datepicker-周几日历表头显示英文仅-configprovider-locale-不够)
- antd|autoletterspacing|中文按钮|getbyrole|字间空格 → [antd v5 autoLetterSpacing 字间空格](testing-gotchas.md#前端antd-v5-两字中文按钮-autoletterspacing-致-dom-字间空格getbyrole-匹配失败)
- markdown-text|next/dynamic|ssr:false|jsdom|null|getbytext → [MarkdownText jsdom 渲染 null](testing-gotchas.md#前端markdowntext-用-nextdynamic-ssrfalsejsdom-测试同步-render-得-null)

## Uncategorized（暂存区，未加索引）

`uncategorized.md` 存放项目特定架构经验、历史记录、尚未提炼成通用 pattern 的知识。条目成熟后应迁出到上述分类文件。当前内容包括：install.sh 分发机制、sync_stage_status / auto_dispatch / complete_stage stage 调度链路、Alembic migration 目录惯例、cursor-agent 版本探测、ETL 迁移顺序、单类拆 facade import 策略、Codex interactive driver 抽象、Windows spawn EINVAL、codex turn 收敛强契约、daemon allowed_roots 范围、Next.js rewrite proxy 等。直接读 `uncategorized.md` 浏览。
