---
author: qinyi
created_at: 2026-08-26 14:05:00
---

# 决策台账（Decisions）— 2026-08-26-workspace-mcp-edit

## D-001@v1 工作区 MCP 配置页从只读升级为可编辑

- type: feature-scope
- status: confirmed
- source: brainstorm step 3 用户原话「要能编写啊」
- question: 工作区 MCP 配置页是否支持编辑？
- answer: 支持。页面双态（查看/编辑），编辑保存到 specDir/.mcp.json。
- normalized_requirement: 页面提供编辑能力，推翻旧变更 2026-07-07-skills-mcp-management-ui 的 D-006（只读）决策；本决策为该决策在新变更内的替代版本。
- impacts: frontend 页面、backend 新增写接口、（连带）daemon 消费链
- evidence: 用户 2026-08-26 对话明确要求；调研确认无任何编辑入口（改文件是唯一途径，对非技术用户不可用）
- priority: P0
- 锚点: frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx:22（原「只读——无编辑按钮」注释改写）
- 模块域: frontend_workspace_mcp, backend_workspace

## D-002@v1 编辑形态采用 textarea JSON（非结构化表单）

- type: ux
- status: confirmed
- source: brainstorm step 4/5
- question: 编辑界面用什么形态？
- answer: 与平台级 设置→MCP 页一致的 textarea JSON 编辑 + zod 前端校验。
- normalized_requirement: 编辑态为 JSON 文本域；校验含 JSON 语法、顶层 mcpServers、command 非空、args 数组、仅 stdio；报错中文并定位 server 名。
- impacts: frontend 页面交互、测试
- evidence: 平台级 settings/mcp/page.tsx 已用 textarea 形态（:67,:162），仓库一致性优先；结构化表单成本高收益低
- priority: P1
- 锚点: frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx
- 模块域: frontend_workspace_mcp

## D-003@v1 secret 用 <set> 占位符往返语义

- type: security
- status: confirmed
- source: brainstorm step 4（沿用平台级既有语义）
- question: 编辑时 env 密钥如何处理？
- answer: GET/响应脱敏为 `<set>`；PUT 请求保留 `<set>` 表示不修改，后端从磁盘现有文件还原真值；无法还原时报错要求重输明文。
- normalized_requirement: 密钥不明文回传浏览器；`<set>` 绝不写盘；还原失败显式中文报错。
- impacts: backend service、frontend 提示文案
- evidence: settings 模块 `_redact_mcp_env` + PUT `<set>` 语义为既有先例（mcp-settings.ts MCP_SECRET_PLACEHOLDER 注释）
- priority: P0
- 锚点: backend/app/modules/workspace/skills_view_service.py:97（get_mcp_config 旁新增 update_mcp_config）
- 模块域: backend_workspace, frontend_workspace_mcp

## D-003@v2 <set> 服务端还原本变更新设（非平台级先例）

- supersedes: D-003@v1
- type: security
- status: confirmed
- source: design-grill CC-01
- question: 「与平台级同一语义」的表述是否成立？
- answer: 不成立。平台级 settings 只有 GET 脱敏、PUT 原样存储（`<set>` 字面量写库，settings/router.py put_mcp_platform_config docstring「接收原值存储，不脱敏」）；服务端还原真值是本变更新设机制。语义方向（<set> 往返/绝不写盘/还原不了报错）与 v1 相同，定位修正。
- normalized_requirement: 密钥不明文回传浏览器；`<set>` 绝不写盘；还原失败显式中文报错（HTTP_422_MCP_SECRET_UNRESOLVABLE）。
- impacts: backend service、design §2/§7.1 措辞
- evidence: settings/router.py put docstring + settings/mcp/page.tsx:56「PUT 后端原样存储」+ mcp-settings.ts:52
- priority: P0
- 锚点: backend/app/modules/workspace/skills_view_service.py（update_mcp_config 还原段）
- 模块域: backend_workspace

## D-004@v1 daemon 经扩展 API 拉取三件套（方案 A）

- type: architecture
- status: confirmed
- source: brainstorm step 4 用户选择「方案A（推荐）」
- question: daemon 如何获取工作区 MCP 配置？
- answer: 扩展 GET /api/daemon/mcp/config 支持 workspace_id，返回 platform_default + whitelist + workspace；daemon 会话创建时预取缓存，mergeMcpConfigs 合并注入。
- normalized_requirement: 三件套一次拉取；失败回落（platform→本地文件、workspace→空）不阻塞会话；本地/远程部署形态均可用。
- impacts: backend daemon 接口、daemon mcp-config.ts/cli.ts
- evidence: 复用既有 API/鉴权/合并函数/测试；方案 B 远程 daemon 读不到文件断链；方案 C 只覆盖 worker 不覆盖对话会话（step 4 对比表，用户确认）
- priority: P0
- 锚点: backend/app/modules/daemon/router.py:4027
- 模块域: backend_daemon_api, sillyhub_daemon_mcp
- 否决理由: （B/C 被否）B 跨机断链；C 覆盖不全且侵入 lease 协议
- 复潮条件: （B）若未来 daemon 与 backend 强制同机部署可重议；（C）若 lease 协议大版本重构可重议

## D-005@v1 仅允许 stdio 类型 server

- type: security
- status: confirmed
- source: 沿用旧变更 2026-07-07 D-017（防 SSRF）
- question: 写接口允许哪些 MCP server 类型？
- answer: 仅 stdio（command+args+env）；type 缺省视为 stdio；非 stdio 值校验拒绝。
- normalized_requirement: 后端 pydantic 校验 + daemon 端 assertMcpServerType 双重把关。
- impacts: backend 校验、daemon 既有校验
- evidence: mcp-config.ts:157-169 assertMcpServerType 既有实现；SSRF 安全边界不放松
- priority: P0
- 锚点: backend/app/modules/workspace/skills_view_service.py（update_mcp_config 校验段）
- 模块域: backend_workspace, sillyhub_daemon_mcp

## D-005@v2 非 stdio 双关口径改为「后端拒绝写入 + daemon 预净化跳过」

- supersedes: D-005@v1
- type: security
- status: confirmed
- source: design-grill CC-03
- question: assertMcpServerType 在会话创建路径抛错会阻塞会话（违反 R-03），怎么办？
- answer: 写接口严格拒绝（pydantic 校验，新写入的文件保证纯净）；daemon fetchMcpBundle 对 workspace 配置预净化——非 stdio 的 server 跳过 + warn，不抛错。存量/手改文件含 sse/http 条目不再阻塞会话创建。
- normalized_requirement: 后端 PUT 拒绝非 stdio；daemon 预净化跳过 + warn；会话创建路径永不因配置内容抛错。
- impacts: design §7.3、daemon mcp-config.ts
- evidence: mcp-config.ts:159-166 assertMcpServerType throw 语义 + Grill CC-03
- priority: P0
- 锚点: sillyhub-daemon/src/mcp-config.ts（fetchMcpBundle 预净化段）
- 模块域: backend_workspace, sillyhub_daemon_mcp

## D-006@v1 注入优先级 builtin > workspace > platform

- type: architecture
- status: confirmed
- source: brainstorm step 5 设计确认
- question: 多层配置同名冲突时谁覆盖谁？
- answer: mergeMcpConfigs(wl, platform, workspace, builtin)：工作区覆盖平台默认，内置 server（sillyhub-daemon/sillyhub-file）最高优先级防被覆盖；全部过白名单（platform 位自动入白名单）。
- normalized_requirement: 内置 server 名（DAEMON_MCP_SERVER_NAME/FILE_MCP_SERVER_NAME）不可被用户配置覆盖。
- impacts: daemon cli.ts 注入逻辑
- evidence: mergeMcpConfigs 既有语义（后者覆盖前者、configs[0] 自动入白名单，mcp-config.ts:182-190）
- priority: P1
- 锚点: sillyhub-daemon/src/cli.ts:799（mainAgentMcpConfigProvider）
- 模块域: sillyhub_daemon_mcp

## D-006@v2 内置 server 名并入白名单参数（调用形式修正）

- supersedes: D-006@v1
- type: architecture
- status: confirmed
- source: design-grill CC-02
- question: v1 的调用形式会不会把内置 server 白名单剔除？
- answer: 会。既有 mergeMcpConfigs 只把 configs[0]（platform 位）自动入白名单，内置 server 在第 4 位不放行。修正调用：mergeMcpConfigs([...whitelist, DAEMON_MCP_SERVER_NAME, FILE_MCP_SERVER_NAME], platform, workspace, builtin)；同时把 rejected 剔除记 warn 接上（现状 cli.ts 未记）。优先级语义与 v1 相同：builtin > workspace > platform。
- normalized_requirement: 内置 server 名（DAEMON_MCP_SERVER_NAME/FILE_MCP_SERVER_NAME）不可被用户配置覆盖、不可被白名单剔除；白名单外 server 剔除时记 warn。
- impacts: design §5.6/§6 cli.ts 行、daemon cli.ts
- evidence: mcp-config.ts:230-237（仅 configs[0] 自动入白名单）+ Grill CC-02
- priority: P1
- 锚点: sillyhub-daemon/src/cli.ts（provider merge 调用）
- 模块域: sillyhub_daemon_mcp

## D-007@v1 预取+缓存，不改 provider 同步签名

- type: architecture
- status: confirmed
- source: brainstorm step 5 设计确认
- question: 注入入口是同步函数，异步拉取怎么接？
- answer: 会话创建路径先异步预取三件套存会话级缓存，mainAgentMcpConfigProvider 同步消费缓存；不修改 provider 签名（零侵入既有装配）。
- normalized_requirement: 缓存会话级（新会话拿新配置，不过期复用）；预取失败写空 bundle 继续。
- impacts: daemon cli.ts
- evidence: mainAgentMcpConfigProvider 为同步回调（cli.ts:799 起），改签名波及 SessionManager 装配；预取模式侵入最小
- priority: P1
- 锚点: sillyhub-daemon/src/cli.ts
- 模块域: sillyhub_daemon_mcp

## D-007@v2 预取挂点定稿 daemon.ts _startInteractiveSession

- supersedes: D-007@v1
- type: architecture
- status: confirmed
- source: design-grill CC-04
- question: cli.ts 装配处是一次性启动动作，拿不到 workspaceId，预取挂哪？
- answer: daemon.ts _startInteractiveSession（唯一持有 execPayload.workspaceId 的位置，lease/context.py:586-591 仅 tar 传输且 lease_meta.workspace_id 已写时携带）。缓存形态 Map<sessionId, McpBundle>；restore/reload 缓存缺失重取一次，失败回落空 bundle + warn。provider 保持同步签名消费缓存（v1 结论不变）。
- normalized_requirement: 预取不阻塞会话创建；无 workspaceId（quick-chat/legacy shared）不预取、回落空 workspace 配置；缓存会话级。
- impacts: design §5.5/§6（新增 daemon.ts 行）、daemon daemon.ts/cli.ts/mcp-config.ts
- evidence: Grill CC-04 源码核查（execPayload/ CreateSessionInput / MainAgentMcpContext 无 workspaceId 字段）
- priority: P1
- 锚点: sillyhub-daemon/src/daemon.ts（_startInteractiveSession）
- 模块域: sillyhub_daemon_mcp

## D-008@v1 工作区 MCP 注入覆盖范围：工作区下所有普通/主控会话，分身除外

- type: boundary
- status: confirmed
- source: design-grill CC-04 + 用户确认（2026-08-26「本工作区下的会话都要」）
- question: 哪些会话注入工作区 MCP 配置？
- answer: 工作区下所有普通对话与主控（orchestrator）会话注入三件套合并结果；分身（mission_worker）维持既有受限注入（不推翻 2026-08-25-team-subsession-governance 治理决策，其放开另议）；quick-chat/legacy shared 无 workspaceId 只用平台默认+内置。
- normalized_requirement: 不改 backend 派发协议为无条件（当前 tar 传输+workspace_id 已写即可覆盖工作区会话）；execute 前置验证工作区会话 workspaceId 下发覆盖率，缺则补。
- impacts: design §5.5/§5.6、daemon provider 分支
- evidence: lease/context.py:586-591 下发条件；deploy/.env SPEC_TRANSPORT=tar；cli.ts isMainAgentSession 谓词三态
- priority: P1
- 锚点: sillyhub-daemon/src/cli.ts（isMainAgentSession 谓词）
- 模块域: sillyhub_daemon_mcp, backend_daemon_api
