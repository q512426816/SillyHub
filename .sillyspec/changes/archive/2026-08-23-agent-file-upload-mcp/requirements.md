---
author: qinyi
created_at: 2026-08-23 09:23:30
change: 2026-08-23-agent-file-upload-mcp
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 会话用户 | 在会话门户/工作区会话中与 agent 对话，查看/下载 agent 上传的文件 |
| 团队成员 | 查看 mission worker run 详情，下载产出文件（须对所属 workspace 有 WORKSPACE_READ） |
| 主 agent | 交互会话中的 claude 主控，经 sillyhub-file MCP 调用上传/列表工具 |
| mission worker | 批任务分身 run（claude 引擎），同样经 sillyhub-file MCP 上传产物 |
| daemon | 注入 sillyhub-file server、本地读文件并 multipart 直传 backend |
| backend | 文件制品端点、File 持久化、AgentRunLog 日志行、Redis 实时扇出、权限校验 |

## 功能需求

### FR-01: 会话聊天流文件卡片

覆盖决策：D-001@v1, D-007@v1, D-011@v1

Given 会话中主 agent 调用 upload_file 上传文件成功
When 前端 SSE 收到该上传的日志行（channel=tool_call，tool_kind=FileUpload）
Then 聊天流在当前位置渲染文件卡片（图标+文件名+大小+下载按钮），图片 mime 渲染内联缩略图卡片

Given 同一文件行因重放进库（dedup_key 撞唯一索引）
When 端点捕获 IntegrityError
Then 视作已写入，不重复出现卡片、不 500

Given 会话上传成功后用户刷新页面
When 重新拉取历史日志
Then 文件卡片仍在原时间线位置（日志行持久化于 AgentRunLog）

### FR-02: 会话与 worker 双场景上传

覆盖决策：D-002@v1, D-005@v1, D-008@v1, D-009@v2

Given claude 主 agent 交互会话（stage 为空或 orchestrator）
When spawn 注入 MCP 配置
Then sillyhub-file 与 sillyhub-daemon 并列注入（per-server env 含 MCP_SESSION_ID）

Given claude 引擎 mission worker run 被派发
When task-runner spawn worker
Then 写 0600 tmpdir 临时 .mcp.json（per-server env 含凭证/MCP_RUN_ID/MCP_ALLOWED_ROOT，run 终删除）并以 --mcp-config 传入；worker 可调用两个文件工具且不获得编排工具

Given codex 或 cursor 引擎的会话/worker
When spawn
Then 不注入 sillyhub-file（行为与现状一致）

### FR-03: MCP 工具集（upload + list）

覆盖决策：D-003@v1

Given agent 调用 upload_file(path, description?)
When path 经 resolve 后在允许根（会话 cwd / worker worktree）内且文件存在、校验通过
Then daemon 本地读文件 multipart 直传 backend，返回 {file_id, original_name, size, mime_type, description}；文件内容不经 agent 上下文

Given path 逃逸（绝对路径/.. 出根）或文件不存在或超限/类型不符
When 调用 upload_file
Then 返回结构化错误（path_out_of_root / file_not_found / file_too_large / file_type_not_allowed），不 crash server

Given agent 调用 list_uploaded_files()
When 当前上下文（会话/run）存在
Then 返回该上下文已上传文件列表（含 created_at，按时间倒序）

### FR-04: 下载权限随会话/run 访问

覆盖决策：D-004@v2, D-010@v1

Given File 归属为 agent_session 且会话 workspace_id 非空
When 对该 workspace 有 WORKSPACE_READ 的用户请求下载/列表
Then 允许；workspace_id 为 NULL 时兜底拒绝

Given File 归属为 agent_run
When 按 target_workspace_id ?? mission.workspace_id ?? task.workspace_id 解析出 workspace 且用户有 WORKSPACE_READ
Then 允许；解析链全空（孤儿 run）兜底拒绝

Given 无 workspace 读权限的用户
When 请求下载
Then 与不存在共用语义 404

Given run 详情页产出文件区
When 普通成员（非 admin）打开
Then 数据经 GET /api/agent/file-artifacts?run_id= 返回（不复用 /api/file/list）

### FR-05: run 详情页产出文件 + 日志流记录

覆盖决策：D-007@v1, D-010@v1, D-011@v1

Given worker 上传成功
When 用户打开该 run 详情页
Then 「产出文件」区列出文件卡片（可下载）；运行日志流出现 FILE 记录行

Given 上传端点写日志行成功
When 端点向 agent_run:{run_id} / agent_session:{id} 通道 publish
Then 前端 SSE 实时收到；publish 失败时降级为刷新可见（不阻断上传响应，记 WARNING）

### FR-06: 文件元数据持久化

覆盖决策：D-006@v2

Given 上传带 description
When 落库
Then File.description 列（String(255) nullable）持久化；FileUploadResp/FileMetaResp 返回 description 与 created_at；旧数据 NULL 兼容

### FR-07: 安全边界

覆盖决策：D-009@v2（及 R-01/R-09）

Given MCP server 缺少 MCP_ALLOWED_ROOT
When 任意 upload_file 调用
Then 拒绝一切上传

Given worker 临时 .mcp.json 已生成
When run 结束 / daemon 启动
Then 文件被删除/清扫；文件权限 0600 且不位于 workDir（不污染用户仓库 git status）

### FR-08: 兼容性

覆盖决策：D-008@v1

Given MCP_TOOLSET 未设置（或缺省）
When sillyhub-daemon server 启动
Then 仅注册既有 5 个编排工具，行为与现状零差异

Given 未升级的 daemon / 未注入的引擎 / 旧前端
When 与新 backend/frontend 交互
Then 既有链路零回归；旧前端遇 FileUpload tool_kind 走忽略策略不报错

## 非功能需求

- 兼容性：Windows/Linux/macOS 三端路径处理（tmpdir、权限位、分隔符）；无 MinIO 环境上传返回结构化错误不影响编排工具
- 可回退：sillyhub-file 注入为增量配置，移除配置即回退；description 列 nullable 纯加列，不写不读零影响
- 可测试：路径逃逸/权限/实时扇出/白名单放行均有单测或集成测试锚点；报错文案中文化（l10n 测试覆盖）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 呈现=聊天流文件卡片+图片缩略图 |
| D-002@v1 | FR-02 | 范围=会话+批任务 worker |
| D-003@v1 | FR-03 | 工具集=upload+list（无 delete） |
| D-004@v2 | FR-04 | 权限锚点解析链+NULL deny+GET 读级鉴权 |
| D-005@v1 | FR-02 | 方案=A 文件子 MCP（同二进制双 toolset） |
| D-006@v2 | FR-06 | 复用 File 表+description 加列+迁移 |
| D-007@v1 | FR-01, FR-05 | AgentRunLog 日志行承载定位 |
| D-008@v1 | FR-02, FR-08 | 仅 claude 引擎注入 |
| D-009@v2 | FR-02, FR-07 | tmpdir 0600 tmpfile+凭证 per-server env |
| D-010@v1 | FR-04, FR-05 | run 页数据源=新端点 |
| D-011@v1 | FR-01, FR-05 | 写行后 Redis publish 实时扇出 |

（全部当前版本决策均被覆盖；D-004@v1/D-006@v1/D-009@v1 已 superseded，不在矩阵。）
