---
author: qinyi
created_at: 2026-08-23 08:59:44
change: 2026-08-23-agent-file-upload-mcp
---

# 决策台账（Decisions）

> 本变更的实现/验收决策记录。版本 ID 稳定，修正时新增版本并 supersedes 旧版。

## D-001@v1 会话内呈现方式 = 聊天流文件卡片

- type: UX 决策
- status: confirmed
- source: brainstorm step3 用户回答
- question: 会话中 agent 上传的文件在聊天界面如何呈现？
- answer: 聊天流文件卡片（图标+文件名+大小+下载/预览），图片类型内联缩略图，复用文件中心已有组件。
- normalized_requirement: 聊天时间线渲染文件卡片段；图片 mime 走缩略图卡片（JWT blob 拉取），其余走通用文件卡片。
- impacts: [FR-01, 前端 session-log-assembler/turn-segment-views, design §5 Wave3]
- evidence: 用户回答轮次 2026-08-23；原型 prototype-agent-file-upload-mcp.html
- priority: P0

## D-002@v1 覆盖范围 = 交互会话 + 批任务 worker

- type: 范围决策
- status: confirmed
- source: brainstorm step3 用户回答
- question: 本次变更覆盖哪些场景？
- answer: 交互会话（主 agent）与批任务 worker（mission worker run）都可调用上传。
- normalized_requirement: 两条注入链路都要打通：会话经 mainAgentMcpConfigProvider；worker 经 task-runner spawn 注入（写 .mcp.json + --mcp-config）。
- impacts: [FR-02, daemon cli.ts/session-manager.ts/task-runner.ts, design §5 Wave2]
- evidence: 用户回答轮次 2026-08-23；cli.ts:714-750（isMainAgentSession 现状）；task-runner.ts:716（buildArgs 现状，无 mcp 链路）
- priority: P0

## D-003@v1 工具集 = upload + list（不含 delete）

- type: 能力边界决策
- status: confirmed
- source: brainstorm step3 用户回答
- question: MCP 工具集提供哪些能力？
- answer: upload_file + list_uploaded_files 两个工具，不做 delete。
- normalized_requirement: file toolset 仅注册 2 个工具；删除走文件中心既有软删接口（用户操作），agent 无删除能力。
- impacts: [FR-03, daemon mcp-server.ts, design §5 Wave1]
- evidence: 用户回答轮次 2026-08-23
- priority: P0

## D-004@v1 下载权限 = 随会话/run 访问权

- type: 权限决策
- status: superseded（被 D-004@v2 取代：直接查 AgentRun.workspace_id 不可实现）
- source: brainstorm step3 用户回答（"能调用会话就能使用"）
- question: 谁可以查看/下载 agent 上传的文件？
- answer: 能访问该会话/run 的用户即可查看下载；实现上 owner_type=agent_session/agent_run 的 File 对「会话/run 所属 workspace 有 WORKSPACE_READ 的用户」可见。
- normalized_requirement: file/service.py _can_access 新增两个归属分支（查 AgentSession/AgentRun 的 workspace_id → WORKSPACE_READ），上传者本人与 platform_admin 沿用既有豁免。
- impacts: [FR-04, backend file/service.py, design §5 Wave1]
- evidence: 用户回答轮次 2026-08-23；file/service.py:125-143（_can_access 现状）
- priority: P0

## D-005@v1 技术方案 = A 文件子 MCP（同二进制 toolset 双模式）

- type: 架构决策
- status: confirmed
- source: brainstorm step4 用户选择
- question: 文件上传 MCP 用哪种技术方案？
- answer: 方案 A——daemon mcp-server.ts 增加 MCP_TOOLSET 双模式（orchestration 默认 / file 新增），file 模式作为独立 server 名 sillyhub-file 注入会话与 worker；daemon 本地读文件经 multipart 直传 backend 新端点，复用文件中心 MinIO 存储。
- normalized_requirement: 文件内容不经 agent 上下文（multipart 直传）；worker 注入的 file toolset 不含编排工具，不触碰 CC-12「worker 不注入编排工具」决策。
- impacts: [总体方案, daemon mcp-server.ts/mcp-config.ts/cli.ts/task-runner.ts, backend agent/file_artifacts.py, design §5 全部 Wave]
- evidence: 用户选择轮次 2026-08-23；方案对比 B（公共 MCP base64 直传大文件不可行）/ C（约定目录自动收集不满足主动上传）
- priority: P0

## D-006@v1 数据归属 = 复用 File 表 owner_type 扩展（不新建表）

- type: 数据模型决策
- status: superseded（被 D-006@v2 取代：description 无持久化位置，需加列；另证据引文修正 owner_type 实为 String(64) NOT NULL）
- source: brainstorm step5 设计（依据 2026-07-22-platform-file-center 既有 owner_type 多态设计 file/model.py）
- question: 上传文件元数据存哪？新建表还是复用文件中心？
- answer: 复用 File 表，owner_type 新增取值 agent_session / agent_run（owner_id=会话id/run id），不新建表、不加列、无迁移。
- normalized_requirement: FileService.upload_file 原样复用（owner_type 字符串自由取值）；查询走既有 GET /api/file/list?owner_type=&owner_id=。
- impacts: [数据模型章节, backend file 模块零 schema 改动]
- evidence: backend/app/modules/file/model.py（owner_type: str = ""）；file/router.py:71（list 端点已支持 owner 过滤）
- priority: P1

## D-007@v1 聊天流定位承载 = AgentRunLog 结构化日志行

- type: 数据流决策
- status: confirmed
- source: brainstorm step5 设计
- question: 上传事件如何在聊天时间线/run 日志流中出现并刷新不丢？
- answer: backend 上传端点同步写一条 AgentRunLog（channel=tool_call，tool_kind=FileUpload，content 为文件元信息 JSON，dedup_key=file-upload:{file_id} 幂等）；前端日志装配器把该行映射为新 file 段渲染卡片。
- normalized_requirement: 会话场景挂当前活跃 run（无活跃 run 取会话最新 run，均无则 422 拒绝）；worker 场景 run_id 直接给定。
- impacts: [FR-01, FR-05, backend agent/file_artifacts.py, frontend session-log-assembler.ts, design §5 Wave1/Wave3]
- evidence: agent/model.py:382+（AgentRunLog 列）；known-issues「AgentRunLog 无 metadata 列」（故用 content 承载 JSON）
- priority: P0

## D-008@v1 worker 注入仅 claude 引擎

- type: 兼容边界决策
- status: confirmed
- source: brainstorm step5 设计（依据 2026-08-22-team-session-unify D-003@v1：codex 不消费 mcpServers）
- question: codex 引擎的 worker/会话是否也注入文件 MCP？
- answer: 不注入。codex 引擎维持现状（无 MCP 能力），后续另立变更。
- normalized_requirement: task-runner 注入仅对 claude 引擎生效（stream-json adapter claude 分支）；cursor/codex 分支忽略 mcpConfigPath。
- impacts: [非目标, adapters/stream-json.ts, 兼容策略]
- evidence: cli.ts:719（provider=codex → 一律 false）
- priority: P1

## D-004@v2 权限锚点 = 解析链 + deny 兜底 + GET 读级鉴权

- type: 权限决策（修正）
- status: accepted
- supersedes: D-004@v1
- source: design-grill round1（UB-02/UB-06）
- question: v1 写「查 AgentRun.workspace_id」，但该列不存在；run 页 listFiles 非 admin 404，如何修正？
- answer: agent_run 归属按解析链 `target_workspace_id ?? mission_id→AgentMission.workspace_id ?? task 归属`，任一为空兜底 deny；AgentSession.workspace_id 为 NULL 也 deny；GET /api/agent/file-artifacts 鉴权降 WORKSPACE_READ（面向前端普通成员）；run 详情页数据源改新端点（D-010@v1）。
- normalized_requirement: _can_access 新分支按解析链实现并有 NULL-deny 单测；run 页禁用 /api/file/list 查 agent_run 归属文件。
- impacts: [FR-04, backend file/service.py, agent/file_artifacts.py, 前端 run 详情]
- evidence: agent/model.py（AgentRun 无 workspace_id，仅 nullable mission_id/target_workspace_id）；file/service.py:198-206（list_files 非 admin 把 owner_id 当 workspace_id）
- priority: P0

## D-006@v2 归属 = 复用 File 表 + 加 description 列

- type: 数据模型决策（修正）
- status: accepted
- supersedes: D-006@v1
- source: design-grill round1（UB-01）
- question: File 表无 description 列，MCP 输出/列表响应/前端卡片的 description 无持久化位置，v1「无新列」与 §7 契约矛盾，如何收口？
- answer: 仍复用 File 表不新建表，但新增 description 列（String(255)，nullable）+ alembic 纯加列迁移；FileUploadResp/FileMetaResp/upload_file 同步扩字段。否决「日志 JSON 反查」（无索引支撑、脆弱）与「砍掉 description」（功能劣化）。
- normalized_requirement: description 全链路单点持久化于 File.description；旧数据 NULL 兼容。
- impacts: [数据模型, file/model.py+schema.py+service.py, 迁移任务]
- evidence: file/model.py:24-81（无 description 列）；design §7.1/§7.2 契约需字段
- priority: P0

## D-009@v1 worker .mcp.json = tmpdir 临时文件 + 凭证不落盘

- type: 安全决策
- status: superseded（被 D-009@v2 取代：凭证「spawnEnv 注入 MCP 子进程」通道被 mcp-config.ts:288-296 spike-01 结论反证——MCP 子进程仅继承固定 12 变量白名单 + per-server env，父进程自定义 env 不透传，按 v1 实现会 401）
- source: design-grill round1（UB-04）
- question: .mcp.json 写 workDir 在 rootPath 模式下污染用户真实仓库 git status，且文件内嵌 daemon apiKey/token 落盘于 agent 可读可提交目录，如何消除？
- answer: 临时 .mcp.json 写 os.tmpdir()（0600 权限、run 终删除、daemon 启动清扫残留）；daemon 凭证不写入文件，经 task-runner spawnEnv 白名单 env 注入 MCP server 子进程。
- normalized_requirement: 文件内仅含非敏感配置（toolset/runId/allowedRoot/backendUrl）；凭证仅进程 env；单测覆盖权限与清理。
- impacts: [R-09, task-runner.ts, mcp-config.ts]
- evidence: workspace.ts:137-142（rootPath 模式 workDir=宿主真实仓库）；mcp-config.ts:337-344（现配置 env 含凭证）
- priority: P0

## D-009@v2 worker .mcp.json = tmpdir 临时文件 + 凭证走 per-server env

- type: 安全决策（修正）
- status: accepted
- supersedes: D-009@v1
- source: design-grill round2（NEW-1）
- question: spawnEnv 直达 MCP 子进程不可行（spike-01 反证），凭证如何投递？
- answer: daemon 凭证（apiKey/token）经 **per-server env 写入 0600 tmpdir 临时 .mcp.json**（唯一已验证可靠通道）；文件不进 workDir（0600、run 终删除、daemon 启动清扫残留）；暴露面=同用户可读临时文件、生命周期单 run，与 agent 本可读 daemon config 同级，非新增暴露面；R-03 spike 顺带验证 `${VAR}` 展开，可用则升级为「文件只存变量引用、真值走 spawnEnv」的加固形态。
- normalized_requirement: tmpfile 权限 0600 + run 终删除 + 启动清扫三件套单测；`${VAR}` spike 结论记入 execute 笔记。
- impacts: [R-09, R-03, task-runner.ts, mcp-config.ts]
- evidence: mcp-config.ts:288-296（spike-01：per-server env 唯一可靠，顶层 options.env 无效）；workspace.ts:137-142（rootPath 模式 workDir=宿主真实仓库）
- priority: P0

## D-010@v1 run 页数据源 = 新端点 GET /api/agent/file-artifacts

- type: 数据流决策
- status: accepted
- source: design-grill round1（UB-06）
- question: run 详情页用 listFiles(owner_type=agent_run) 时非 admin 用户 404（/api/file/list 把 owner_id 当 workspace_id 鉴权），数据源怎么选？
- answer: 改用 GET /api/agent/file-artifacts?run_id=（JWT + WORKSPACE_READ + 会话/run 锚 workspace 复核）；不改 /api/file/list 行为（守 §9「只增不改」）。
- normalized_requirement: 前端 run 详情文件区数据源唯一为新端点。
- impacts: [前端 run 详情, §7.2]
- evidence: file/service.py:198-206（owner_id 被当 workspace_id）
- priority: P1

## D-011@v1 写日志行后必须 Redis publish

- type: 实时性决策
- status: accepted
- source: design-grill round1（UB-03）
- question: backend 直写 AgentRunLog 不经 Redis publish，会话 SSE（stream_session_logs 纯 pub/sub 单腿）实时收不到文件卡片行，怎么办？
- answer: 上传端点写行成功后向会话/run 通道 publish 该日志行（复用 submit_run_input 同款模式，agent/service.py:842/:929），保障 FR-01/FR-02 实时呈现。
- normalized_requirement: publish 失败不阻断上传响应（降级为刷新可见，同 submit_run_input :929 降级语义），记 WARNING 日志。
- impacts: [R-10, agent/file_artifacts.py, §7.5]
- evidence: agent/service.py:1190+（stream_session_logs 为 Redis Pub/Sub 单腿，实时帧仅来自 daemon 提交路径 publish）
- priority: P1
