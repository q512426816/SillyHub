## FR-mcp-server-001 会话聊天流文件卡片
变更：2026-08-23-agent-file-upload-mcp
状态：active
摘要：默认场景
依据决策：D-001@v1、D-007@v1、D-011@v1
场景正文：
- 场景：默认场景 — Given 会话中主 agent 调用 upload_file 上传文件成功 同一文件行因重放进库（dedup_key 撞唯一索引） 会话上传成功后用户刷新页面；When 前端 SSE 收到该上传的日志行（channel=tool_call，tool_kind=FileUpload） 端点捕获 IntegrityError 重新拉；Then 聊天流在当前位置渲染文件卡片（图标+文件名+大小+下载按钮），图片 mime 渲染内联缩略图卡片 视作已写入，不重复出现卡片、不 500 文件卡片仍在原时间线位
全文：.sillyspec/changes/archive/2026-08-23-agent-file-upload-mcp/requirements.md#FR-01
最近确认：ce7ad937b

## FR-mcp-server-002 会话与 worker 双场景上传
变更：2026-08-23-agent-file-upload-mcp
状态：active
摘要：默认场景
依据决策：D-002@v1、D-005@v1、D-008@v1、D-009@v2
场景正文：
- 场景：默认场景 — Given claude 主 agent 交互会话（stage 为空或 orchestrator） claude 引擎 mission worker run 被派发 cod；When spawn 注入 MCP 配置 task-runner spawn worker spawn；Then sillyhub-file 与 sillyhub-daemon 并列注入（per-server env 含 MCP_SESSION_ID） 写 0600 tmp
全文：.sillyspec/changes/archive/2026-08-23-agent-file-upload-mcp/requirements.md#FR-02
最近确认：ce7ad937b

## FR-mcp-server-003 MCP 工具集（upload + list）
变更：2026-08-23-agent-file-upload-mcp
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given agent 调用 upload_file(path, description?) path 逃逸（绝对路径/.. 出根）或文件不存在或超限/类型不符 agent；When path 经 resolve 后在允许根（会话 cwd / worker worktree）内且文件存在、校验通过 调用 upload_file 当前上下文（会；Then daemon 本地读文件 multipart 直传 backend，返回 {file_id, original_name, size, mime_type, d
全文：.sillyspec/changes/archive/2026-08-23-agent-file-upload-mcp/requirements.md#FR-03
最近确认：ce7ad937b

## FR-mcp-server-004 下载权限随会话/run 访问
变更：2026-08-23-agent-file-upload-mcp
状态：active
摘要：默认场景
依据决策：D-004@v2、D-010@v1
场景正文：
- 场景：默认场景 — Given File 归属为 agent_session 且会话 workspace_id 非空 File 归属为 agent_run 无 workspace 读权限的用户；When 对该 workspace 有 WORKSPACE_READ 的用户请求下载/列表 按 target_workspace_id ?? mission.worksp；Then 允许；workspace_id 为 NULL 时兜底拒绝 允许；解析链全空（孤儿 run）兜底拒绝 与不存在共用语义 404 数据经 GET /api/agen
全文：.sillyspec/changes/archive/2026-08-23-agent-file-upload-mcp/requirements.md#FR-04
最近确认：ce7ad937b

## FR-mcp-server-005 run 详情页产出文件 + 日志流记录
变更：2026-08-23-agent-file-upload-mcp
状态：active
摘要：默认场景
依据决策：D-007@v1、D-010@v1、D-011@v1
场景正文：
- 场景：默认场景 — Given worker 上传成功 上传端点写日志行成功；When 用户打开该 run 详情页 端点向 agent_run:{run_id} / agent_session:{id} 通道 publish；Then 「产出文件」区列出文件卡片（可下载）；运行日志流出现 FILE 记录行 前端 SSE 实时收到；publish 失败时降级为刷新可见（不阻断上传响应，记 WAR
全文：.sillyspec/changes/archive/2026-08-23-agent-file-upload-mcp/requirements.md#FR-05
最近确认：ce7ad937b

## FR-mcp-server-006 文件元数据持久化
变更：2026-08-23-agent-file-upload-mcp
状态：active
摘要：默认场景
依据决策：D-006@v2
场景正文：
- 场景：默认场景 — Given 上传带 description；When 落库；Then File.description 列（String(255) nullable）持久化；FileUploadResp/FileMetaResp 返回 descr
全文：.sillyspec/changes/archive/2026-08-23-agent-file-upload-mcp/requirements.md#FR-06
最近确认：ce7ad937b

## FR-mcp-server-007 安全边界
变更：2026-08-23-agent-file-upload-mcp
状态：active
摘要：默认场景
依据决策：D-009@v2
场景正文：
- 场景：默认场景 — Given MCP server 缺少 MCP_ALLOWED_ROOT worker 临时 .mcp.json 已生成；When 任意 upload_file 调用 run 结束 / daemon 启动；Then 拒绝一切上传 文件被删除/清扫；文件权限 0600 且不位于 workDir（不污染用户仓库 git status）
全文：.sillyspec/changes/archive/2026-08-23-agent-file-upload-mcp/requirements.md#FR-07
最近确认：ce7ad937b

## FR-mcp-server-008 兼容性
变更：2026-08-23-agent-file-upload-mcp
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given MCP_TOOLSET 未设置（或缺省） 未升级的 daemon / 未注入的引擎 / 旧前端；When sillyhub-daemon server 启动 与新 backend/frontend 交互；Then 仅注册既有 5 个编排工具，行为与现状零差异 既有链路零回归；旧前端遇 FileUpload tool_kind 走忽略策略不报错
全文：.sillyspec/changes/archive/2026-08-23-agent-file-upload-mcp/requirements.md#FR-08
最近确认：ce7ad937b

## FR-mcp-server-009 主控首轮任务简报
变更：2026-08-24-session-team-mission-context
状态：active
摘要：默认场景
依据决策：D-002@v1、D-004@v1、D-013@v1
场景正文：
- 场景：默认场景 — Given 会话已预建活跃 mission（弹层或 create 携带）且本轮 prompt 非空 同一 mission 已有非 failed 的 orchestrator；When 该 mission 不存在 status ∈ {pending, running, completed} 的 orchestrator run（failed 不；Then 本轮 SESSION_INJECT/create 首 prompt = `简报 + "\n\n---\n\n" + 用户消息`；简报含 mission_id、锚
全文：.sillyspec/changes/archive/2026-08-24-session-team-mission-context/requirements.md#FR-01
最近确认：a9b06c982

## FR-mcp-server-010 mission_status 常驻查询工具
变更：2026-08-24-session-team-mission-context
状态：active
摘要：默认场景
依据决策：D-002@v1、D-005@v1、D-012@v1
场景正文：
- 场景：默认场景 — Given Claude 主 agent 会话（非分身） 会话无活跃 mission daemon 未升级（旧版本）；When 调用 mission_status MCP 工具 调用 mission_status 新 backend 运行；Then 返回 active/mission_id/派生状态/objective/锚点工作区/scope_workspaces（含 daemon_online/daemo
全文：.sillyspec/changes/archive/2026-08-24-session-team-mission-context/requirements.md#FR-02
最近确认：a9b06c982

## FR-mcp-server-011 弹层工作区探测
变更：2026-08-24-session-team-mission-context
状态：active
摘要：默认场景
依据决策：D-008@v2
场景正文：
- 场景：默认场景 — Given 派团队弹层打开 弹层工作区行渲染；When 前端调用 `POST /api/workspaces/probe`（候选工作区 id 列表） daemon_online=true/false/未绑定；Then 返回每工作区 `{git_mode, daemon_name, daemon_online}`（后端任一成员 binding 口径，与简报/mission_st
全文：.sillyspec/changes/archive/2026-08-24-session-team-mission-context/requirements.md#FR-03
最近确认：a9b06c982

## FR-mcp-server-012 非 git 工作区直通
变更：2026-08-24-session-team-mission-context
状态：active
摘要：默认场景
依据决策：D-006@v2、D-007@v1
场景正文：
- 场景：默认场景 — Given worker 派发目标工作区 探测=git 探测=direct 探测=unknown mission 收敛；When 后端探测（非降级 RPC 通道 stat `<root>/.git` 绝对路径） worker 派发 worker 派发 worker 派发 直通 worker；Then 三态：exists=True→git；daemon 真答 False→direct；transport 异常/未绑 daemon/超时→unknown per-
全文：.sillyspec/changes/archive/2026-08-24-session-team-mission-context/requirements.md#FR-04
最近确认：a9b06c982

## FR-mcp-server-013 新会话派团队可用
变更：2026-08-24-session-team-mission-context
状态：active
摘要：默认场景
依据决策：D-009@v2
场景正文：
- 场景：默认场景 — Given 预会话（未发送首句）且引擎=claude 且所选机器在线 create 过程任意步骤失败；When 用户点击派团队并确认 弹层正常可用（不再置灰），payload 暂存 用户发送首句 事务回滚；Then createSession 请求携带 team_mission 块；后端在首 run 创建前 flush-only 同事务预建 mission；objectiv
全文：.sillyspec/changes/archive/2026-08-24-session-team-mission-context/requirements.md#FR-05
最近确认：a9b06c982

## FR-mcp-server-014 主 agent 选择器（仅预会话）
变更：2026-08-24-session-team-mission-context
状态：active
摘要：默认场景
依据决策：D-010@v1、D-014@v1
场景正文：
- 场景：默认场景 — Given 预会话弹层 选择工作区 W（∈ scope） 既有会话（已存在）派团队弹层；When 渲染主 agent 选择器 创建会话 渲染；Then 默认「当前会话」+ scope 内各工作区（显示机器名+在线状态；离线/未绑禁选）；落 orchestrator_workspace_id（null=默认） s
全文：.sillyspec/changes/archive/2026-08-24-session-team-mission-context/requirements.md#FR-06
最近确认：a9b06c982

## FR-mcp-server-015 存量零回归
变更：2026-08-24-session-team-mission-context
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 无 mission 普通会话 / 既有会话预建路径 / 懒建路径 / 存量 external-team mission / patrol 重派；When 本变更上线 行为全部不变（懒建不补简报不增强响应；patrol 的 render_orchestrator_prompt 输出结构等价+新增机器名字段，不引入探
全文：.sillyspec/changes/archive/2026-08-24-session-team-mission-context/requirements.md#FR-07
最近确认：a9b06c982
