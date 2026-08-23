---
author: qinyi
created_at: 2026-08-23 08:59:44
scale: large
tier: independent
change: 2026-08-23-agent-file-upload-mcp
---

# 设计文档（Design）— Agent 文件上传 MCP（会话/Worker 产物上传给用户）

## 1. 背景

平台会话中 agent 会在本地（会话 cwd / worker worktree）生成文件（报告、图表、数据导出等），但这些文件只留在 daemon 所在机器的磁盘上：聊天流（`session-log-assembler.ts` 的段类型只有 text/thinking/tool/subagent_stub/stderr）没有文件段，也没有任何下载入口；用户看不到、拿不到。反向（用户→agent 附件）已有 `session_attachment` 模块，正向缺口。

同时平台已有完整文件中心（`backend/app/modules/file` + `storage` → MinIO，upload/list/download API + 前端组件，owner_type/owner_id 多态归属），目前仅服务 PPM 附件与 workspace 方案文件。

daemon 已有内置 stdio MCP server（`sillyhub-daemon/src/mcp-server.ts`，5 个编排工具经 `HubClient` 回打 backend），交互会话主 agent 已注入（`mainAgentMcpConfigProvider`）；批任务 worker 刻意不注入编排工具（CC-12 防递归），且 task-runner 完全没有 MCP 注入链路。

## 2. 设计目标

1. 会话中的主 agent 可调用 MCP 工具 `upload_file` 把工作目录内文件上传到平台，聊天流中出现文件卡片（图片内联缩略图），用户可查看/下载。
2. 批任务 worker（claude 引擎）同样可调用 `upload_file`/`list_uploaded_files`，run 详情页出现「产出文件」区 + 运行日志流出现文件记录行。
3. 文件存储复用文件中心（MinIO + File 表），下载权限跟随会话/run 访问权（能访问所属 workspace 即可下载）。
4. 文件内容不经 agent 对话上下文（daemon 本地读文件 multipart 直传 backend），大文件（受现有上限约束）可行。

## 3. 非目标

- 不做 delete 工具（删除走文件中心既有软删，用户操作；D-003@v1）
- 不做 codex 引擎注入（codex 不消费 mcpServers，维持 2026-08-22-team-session-unify D-003@v1；D-008@v1）
- 不在公共 MCP server（mcp_gateway）加文件工具（方案 B 已否决，base64 直传大文件不可行）
- 不做超大文件流式/分片上传（沿用现有 `file_max_size_mb` 全量校验，优化另立变更）
- 不改文件中心既有页面/接口行为，不做会话文件聚合列表页（聊天流与 run 详情内呈现即可）
- 不做 worker 结束自动收集目录（方案 C 已否决）

## 4. 拆分判断

单一垂直功能，三端契约耦合紧密（MCP tool schema ↔ backend 端点 ↔ 前端段类型），拆成多个 change 会产生长期中间态（如端点就绪但无注入）。按端分 Wave 在单 change 内推进：Wave1 backend → Wave2 daemon → Wave3 frontend，接口契约在本文档 §7 一次定死。

## 5. 总体方案

数据流（方案 A，D-005@v1）：

```
会话主 agent ──┐                       ┌─> File 表（owner_type=agent_session/agent_run）
                ├→ [sillyhub-file MCP] ─┤      │
批任务 worker ──┘   (stdio, file 模式)   ├─> AgentRunLog 一行（tool_kind=FileUpload）
      │                │ 本地读文件      └─> MinIO 对象
      │                └ multipart 直传 backend POST /api/agent/file-artifacts
      └ 注入：task-runner 写 .mcp.json + --mcp-config（claude）；会话走 mainAgentMcpConfigProvider

前端消费：聊天流 file 段→文件卡片（图片缩略图）；run 详情页产出文件区走 GET /api/agent/file-artifacts（D-010@v1，不复用 /api/file/list）
```

- **Wave1（backend）**：新增 `agent/file_artifacts.py` 端点（上传/列表，daemon 双路径鉴权，写日志行）；`file/service.py` `_can_access` 扩两个归属分支；测试；`gen:types` 同步。
- **Wave2（daemon）**：`mcp-server.ts` 增加 `MCP_TOOLSET` 双模式（orchestration 默认不变 / file 新增 2 工具）；`mcp-config.ts` 新增 `buildFileMcpServerConfig`；会话注入（cli.ts + session-manager.ts 并入 sillyhub-file）；worker 注入（task-runner 写 `.mcp.json` + `stream-json.ts` buildArgs 增 `mcpConfigPath`，仅 claude 分支）；测试。
- **Wave3（frontend）**：`session-log-assembler.ts` 新增 file 段；`file-message-card.tsx` 文件卡片（复用 `lib/file/api.ts` 下载与 JWT blob）；run 详情页「产出文件」区；测试。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | sillyhub-daemon/src/mcp-server.ts | 新增 `MCP_TOOLSET` env 双模式（缺省 orchestration，行为不变）；`FILE_MCP_SERVER_NAME='sillyhub-file'`；file 模式注册 `upload_file`/`list_uploaded_files`；新 env `MCP_RUN_ID`/`MCP_ALLOWED_ROOT`；路径 resolve+前缀校验。producer=env 注入方（session-manager/task-runner）→ consumer=tool handler |
| 修改 | sillyhub-daemon/src/hub-client.ts | 新增 `uploadFileArtifact`（multipart FormData：file+description+run_id，附 `X-Session-Id`）与 `listFileArtifacts`。producer=tool handler → consumer=backend 端点 |
| 修改 | sillyhub-daemon/src/mcp-config.ts | 新增 `buildFileMcpServerConfig(backendUrl, auth, {sessionId?, runId?, allowedRoot})`：构造 sillyhub-file server 条目（command=node、args=[dist/mcp-server.js]、env 含 MCP_TOOLSET=file 及上下文） |
| 修改 | sillyhub-daemon/src/cli.ts | `mainAgentMcpConfigProvider` 返回表并入 sillyhub-file（与 sillyhub-daemon 并列，`mergeMcpConfigs` 白名单自动收录平台内置名） |
| 修改 | sillyhub-daemon/src/interactive/session-manager.ts | per-server env 注入管道（现写 `mcpServers['sillyhub-daemon'].env.MCP_SESSION_ID` 处）扩展同时写 `mcpServers['sillyhub-file'].env` |
| 修改 | sillyhub-daemon/src/task-runner.ts | worker spawn 前（仅 `provider==='claude'` 租约）：`buildFileMcpServerConfig` → 写 **os.tmpdir() 临时 .mcp.json**（0600，run 终删除，daemon 启动清扫残留）→ `buildArgs({mcpConfigPath})`；**daemon 凭证经 per-server env 写入该 0600 tmpfile**（spike-01 已证唯一可靠通道：MCP 子进程仅继承固定白名单 + per-server env，父进程 spawnEnv 自定义变量不透传，mcp-config.ts:288-296；D-009@v2）；R-03 spike 顺带验证 .mcp.json env `${VAR}` 展开，可用则升级为「文件只存变量引用、真值走 spawnEnv」的加固形态。producer=lease/run 上下文（runId、allowedRoot）→ consumer=claude CLI 子进程 |
| 修改 | sillyhub-daemon/src/adapters/stream-json.ts | `buildArgs` opts 增 `mcpConfigPath?: string`；claude 分支追加 `--mcp-config <path>`；cursor 分支忽略（D-008@v1） |
| 新增 | sillyhub-daemon/tests/mcp-server-file.test.ts | file toolset 工具注册、路径逃逸拒绝、multipart 转发（mock hub-client）单测（daemon vitest include=tests/**/*.test.ts，测试一律放 tests/ 下） |
| 新增 | sillyhub-daemon/tests/task-runner-file-mcp.test.ts | worker 注入（.mcp.json 内容、env、仅 claude）单测 |
| 修改 | sillyhub-daemon/tests/stream-json.test.ts | `mcpConfigPath` 参数单测（claude 追加 / cursor 忽略；现有 buildArgs 测试实际在 tests/ 根下，tests/adapters/ 为其它 adapter 测试） |
| 新增 | backend/app/modules/agent/file_artifacts.py | 新 router：`POST /api/agent/file-artifacts`（multipart，daemon 双路径鉴权 `require_permission_any(WORKSPACE_WRITE)`，按 X-Session-Id/run_id 锚 workspace 复核，同 mcp_tools.py 模式）→ `FileService.upload_file`（owner_type=agent_session/agent_run）+ 写 AgentRunLog 行；`GET /api/agent/file-artifacts` 列表。producer=daemon hub-client → consumer=FileService/AgentRunLog |
| 修改 | backend/app/modules/file/service.py | `_can_access` 新增分支：owner_type=agent_session → 查 AgentSession.workspace_id（NULL 兜底 deny）；owner_type=agent_run → **解析链** `target_workspace_id ?? mission_id→AgentMission.workspace_id ?? task→workspace`（AgentRun 无 workspace_id 列，全空兜底 deny），有 WORKSPACE_READ 即可见（D-004@v2） |
| 修改 | backend/app/modules/file/model.py | File 表新增 `description` 列（String(255)，nullable，旧数据 NULL；D-006@v2） |
| 修改 | backend/app/modules/file/schema.py | `FileUploadResp`/`FileMetaResp` 扩 description 字段，`FileMetaResp` 另补 created_at（列已有，DTO 未暴露——§7.1 list 工具需要） |
| 修改 | backend/app/modules/file/service.py | `upload_file` 增 description 参数（落库截断 255，仿 original_name） |
| 新增 | backend/migrations/versions/20260823100000_file_description_column.py | alembic 迁移：file 表加 description 列（nullable，无回填；down_revision 取执行时 head） |
| 修改 | backend/app/modules/agent/execution.py | `worker_tool_config` 生成处：显式 allowed_tools 白名单模式自动追加整服务器名 `mcp__sillyhub-file`（通配符写法未验证，用整服务器名；R-02 落地归属） |
| 修改 | backend/app/modules/agent/router.py | include 新 file_artifacts router（挂载点与 mcp_tools 同处：`agent/router.py:905` 聚合，已核实） |
| 新增 | backend/app/modules/agent/tests/test_file_artifacts.py | 端点测试：上传落库+日志行、路径上下文缺失 422、越权 workspace 403、鉴权双路径 |
| 修改 | backend/app/modules/file/tests/（service 访问测试文件） | `_can_access` 新分支测试（会话/Run 归属 + 无权 404） |
| 生成 | backend/openapi.json | `gen:types` 产物同步（新端点 schema），禁止手写 |
| 生成 | frontend/src/lib/api-types.ts | 同上（frontend 侧生成） |
| 生成 | sillyhub-daemon/src/api-types.ts | 同上（daemon 侧生成） |
| 修改 | frontend/src/components/daemon/session-log-assembler.ts | `TurnSegment` 联合新增 `{ kind:'file'; id; fileId; name; size; mime; description; ts; segId? }`；日志行 `tool_kind==='FileUpload'` → file 段（parse content JSON）。producer=backend AgentRunLog 行 → SSE → consumer=assembler/段视图 |
| 新增 | frontend/src/components/daemon/file-message-card.tsx | 文件卡片：图片 mime → 缩略图卡片（JWT blob，复用 file-image 模式）；其余 → 图标+名+大小+下载（复用 `lib/file/api.ts` downloadFile） |
| 修改 | frontend/src/components/daemon/turn-segment-views.tsx | file 段渲染 `FileMessageCard` |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/[tid]/page.tsx（「智能体运行详情」区；原 agent/page.tsx 已随智能体控制台移除变为 5 行 stub，落点以现存页面为准） | 新增「产出文件」区：数据源 `GET /api/agent/file-artifacts?run_id=`（JWT 用户，WORKSPACE_READ + workspace 锚定鉴权；**不复用 `/api/file/list`**——其非 admin owner 分支把 owner_id 当 workspace id 鉴权会 404，D-010@v1）+ 卡片网格 |
| 新增 | frontend/src/components/daemon/__tests__/file-message-card.test.tsx | 卡片渲染（图片/普通两形态、下载事件）测试 |
| 修改 | frontend/src/components/daemon/__tests__/（assembler 测试文件） | file 段映射测试 |

原型：`prototype-agent-file-upload-mcp.html`（聊天卡片 + run 文件区 + 日志行，双主题）。

## 7. 接口定义

### 7.1 MCP 工具（sillyhub-file，file 模式）

```ts
upload_file:
  input:  { path: string（相对工作目录；含 .. 或绝对路径逃逸即拒绝）, description?: string }
  output: { file_id, original_name, size, mime_type, description }
  错误:   path_out_of_root / file_not_found / file_too_large / file_type_not_allowed / http / network（isError+JSON，沿用 errorContent 模式）

list_uploaded_files:
  input:  {}
  output: { files: [{ file_id, original_name, size, mime_type, description, created_at }] }
```

路径校验：`path.resolve(allowedRoot, path)` 结果必须以 `allowedRoot + 分隔符` 为前缀；`allowedRoot` 来自 env（会话=cwd，worker=worktree 根），env 缺失则拒绝一切上传。

### 7.2 backend 端点（daemon 鉴权）

```
POST /api/agent/file-artifacts
  multipart: file: UploadFile; description: str = ""; run_id: UUID | None
  header: X-Session-Id（会话场景；与 mcp_tools._SESSION_ID_HEADER 同名同源）
  鉴权: require_permission_any(Permission.WORKSPACE_WRITE)（JWT / X-API-Key 双路径）
  逻辑: 会话场景（X-Session-Id）→ owner_type=agent_session, owner_id=会话id，
        AgentRunLog 挂当前活跃 run（_ACTIVE_RUN_STATUSES 口径），无活跃取最新 run，均无→422；
        worker 场景（run_id）→ 校验 run 存在，owner_type=agent_run, owner_id=run_id，日志行挂该 run
  写 AgentRunLog: channel='tool_call', tool_kind='FileUpload',
        content_redacted=JSON{file_id, original_name, size, mime_type, description},
        dedup_key=f"file-upload:{file_id}"（重放防护：直写路径 catch IntegrityError
        撞 (run_id,dedup_key) 部分唯一索引时视作已写入，不 500）
  实时扇出: 写行成功后向 Redis channel（会话流 agent_session:{id} / run 日志流）publish
        该日志行——复用 submit_run_input 同款模式（agent/service.py:842 写行+:929 publish，无
        publish_submitted_messages 方法）；缺此步 SSE 实时流收不到（D-011@v1）
  resp 201: FileUploadResp（含 description，持久化于 File.description 列）

GET /api/agent/file-artifacts?session_id=UUID | run_id=UUID
  鉴权: require_permission_any(Permission.WORKSPACE_READ)（读操作：面向前端普通成员
        与 daemon list 工具；注：WRITE⊇READ 仅对种子角色成立（workspace_owner 同含两者，
        rbac 无蕴含层级），自定义只-write 角色会使 daemon list 工具 403（良性失败，upload 不受影响））
        + 会话/run 锚 workspace 复核
  → { files: [FileMetaResp 含 description、created_at] }（按 created_at 倒序）
```

### 7.3 前端段类型（TurnSegment 新成员）

```ts
{ kind: 'file'; id: string; fileId: string; name: string; size: number;
  mime: string; description: string; ts: number | null; segId?: string | null }
```

## 7.5 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 会话注入 sillyhub-file | daemon session-manager | claude SDK 主 agent | mcpServers['sillyhub-file'].env: MCP_SESSION_ID | 无 run 状态变化（会话获得 upload 工具） |
| worker 注入 sillyhub-file | daemon task-runner | claude CLI 子进程 | .mcp.json（含 sillyhub-file）、env: MCP_RUN_ID, MCP_ALLOWED_ROOT | 无状态变化（worker run 运行中获得工具） |
| upload_file 工具调用 | agent（主/worker） | sillyhub-file MCP server | path, description? | 无状态变化（本地读文件+校验） |
| 上传文件制品 | sillyhub-file server | backend POST /api/agent/file-artifacts | multipart file、description?、X-Session-Id 或 run_id | File 行创建（owner_type=agent_session/agent_run）+ AgentRunLog 追加 1 行（run 状态不变） |
| 日志行实时扇出 | backend file_artifacts 端点 | Redis pub/sub → 前端 SSE（会话流/run 日志流） | channel（agent_session:{id}/run 通道）、完整日志行 payload | 无状态变化（前端实时收到文件行并渲染卡片） |
| 列出文件制品 | sillyhub-file server | backend GET /api/agent/file-artifacts | session_id 或 run_id | 无（只读） |
| 用户下载/预览 | 前端 | backend GET /api/file/{file_id} | file_id、JWT | 无（流式返回，图片白名单 inline） |
| run/session 终态 | backend finalizer | — | run_id/session_id | 文件不随终态删除（保留回看；软删仅用户手动走文件中心） |

## 8. 数据模型

无新表；**一处加列**（D-006@v2，修订自 v1「无新列」——description 需要持久化位置支撑列表接口与卡片展示）：
- `File` 表新增 `description` 列（String(255)，nullable，旧数据 NULL），附 alembic 迁移（纯加列，无回填）。
- `File.owner_type` 新增自由取值 `agent_session` / `agent_run`（列为 String(64) NOT NULL，无枚举约束，取值变更无 schema 影响），`owner_id` = 会话/run UUID，`uploaded_by` = daemon API Key 绑定用户。
- `AgentRunLog` 复用现有列（channel String(20) / tool_kind String(32) / content_redacted / dedup_key String(200)，容量均足够）；已知坑「AgentRunLog 无 metadata 列」故元信息 JSON 进 content（D-007@v1）。
- 权限锚点：`AgentSession.workspace_id`（nullable，NULL 兜底 deny）；`AgentRun` 无 workspace_id 列，按 `target_workspace_id ?? mission.workspace_id ?? task 归属` 解析链取锚（D-004@v2）。

## 9. 兼容策略

- `MCP_TOOLSET` 缺省 = orchestration：现有 sillyhub-daemon server 5 工具行为零变化；未升级 daemon 的环境无感知。
- codex/cursor 引擎不注入（buildArgs cursor 分支忽略 mcpConfigPath；isMainAgentSession 对 codex 仍 false）。
- 文件中心既有接口/UI/权限分支不变，`_can_access` 只增不改；既有 PPM/workspace 文件访问不受影响。
- 旧前端遇到未知 tool_kind 沿用 assembler 忽略策略（升级前最多不显示卡片，不报错）。
- profile `mcp_refs` 过滤交互：`mcp_refs` 非空的 profile 下 sillyhub-file 与 sillyhub-daemon 同语义受过滤（未列名即剔除，session-manager.ts 现有行为），不单独豁免；需要常驻的 profile 显式列名即可。
- DB 兼容：description 列 nullable 纯加列迁移，旧行 NULL、旧代码不读该列不受影响；无数据回填。
- 环境无 MinIO 时上传工具返回结构化错误（沿用 storage 异常路径），不影响编排工具。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 路径逃逸：agent 上传工作目录外任意文件 | P0 | MCP server 内 resolve+前缀校验（MCP_ALLOWED_ROOT），拒绝绝对路径与 `..`；allowedRoot 缺失拒绝一切上传；单测覆盖逃逸用例 |
| R-02 | worker tool_config 显式 allowed_tools 白名单会禁掉上传工具 | P1 | backend `execution.py` worker_tool_config 白名单模式自动追加整服务器名 `mcp__sillyhub-file`（通配符 `mcp__x__*` 写法未验证不用）；无白名单（bypassPermissions）无需处理；集成测试覆盖 |
| R-03 | claude CLI `--mcp-config` 与现有参数组合兼容性（版本差异）；.mcp.json env `${VAR}` 展开是否可用（D-009@v2 加固项） | P1 | 仅 claude 引擎；Wave2 先以单测+本地 spike 验证参数共存与 `${VAR}` 展开，失败则回退写 `~/.claude.json` 项目级配置方案（备选，execute 时定） |
| R-04 | 大文件全量进内存（FileService bytes 模式 + multipart 全读） | P1 | 沿用 `file_max_size_mb` 上限校验（413）；流式分片列非目标 |
| R-05 | 上传时会话无活跃 run（日志行无处挂）；直写行撞 dedup 唯一索引 | P2 | 取会话最新 run 兜底；均无→422 中文报错（l10n 测试覆盖）；插入 catch IntegrityError 视作已写入（重放防护） |
| R-06 | `_can_access` 新分支对 batch_meta 的逐行查询性能 | P2 | 主键单查；量级与会话文件数同阶，可接受 |
| R-07 | 日志行 JSON 与现有 tool_use 文本段混淆（assembler 误渲染） | P2 | tool_kind='FileUpload' 精确匹配优先于通用 tool_use 映射；旧/未知 tool_kind 走忽略分支 |
| R-08 | daemon apiKey 权限面（WORKSPACE_WRITE）复用扩权担忧 | P2 | 与既有 5 工具同一鉴权轨道，不新增越权面；上传落审计日志沿用现有行为 |
| R-09 | worker .mcp.json 落盘卫生与凭证安全：写入 workDir 会污染用户真实仓库 git status（rootPath 模式 workDir=宿主仓库）；凭证经 per-server env 落入 0600 tmpfile，同用户进程（含 agent）可读（spike-01 证 spawnEnv 自定义变量不透传 MCP 子进程，per-server env 是唯一可靠通道，无法完全避免落盘） | P0 | 临时文件写 os.tmpdir()（**不进 workDir**，0600 权限、run 终删除、daemon 启动清扫残留）；凭证暴露面收敛=「同用户可读的临时文件、生命周期=单 run」与 daemon 自身 config 同级（agent 本可读 daemon config，非新增暴露面）；R-03 spike 验证 `${VAR}` 展开，可用则文件只存变量引用（加固形态）；单测覆盖文件权限与清理 |
| R-10 | backend 直写日志行不 publish 则 SSE 实时流收不到（stream_session_logs 为 Redis pub/sub 单腿） | P1 | 端点写行后必须 publish（D-011@v1）；集成测试覆盖实时帧到达 |

## 11. 决策追踪

| 决策 | 状态 | 覆盖 |
|---|---|---|
| D-001@v1 呈现=聊天流文件卡片 | confirmed | FR-01、§5 Wave3、§7.3 |
| D-002@v1 范围=会话+worker | confirmed | FR-02、§5 Wave2、§7.5 |
| D-003@v1 工具集=upload+list | confirmed | FR-03、§7.1、非目标 |
| D-004@v2 权限锚点解析链（supersedes v1：AgentRun 无 workspace_id 列，直接查列不可实现） | accepted（grill 修正） | FR-04、§6 file/service.py、§8 |
| D-005@v1 方案=A 文件子 MCP | confirmed | §5 总体方案 |
| D-006@v2 归属=复用 File 表+加 description 列（supersedes v1「无新列」：description 需持久化位置） | accepted（grill 修正） | §8 数据模型、§6 file 三件套+迁移 |
| D-007@v1 定位=AgentRunLog 日志行 | confirmed | §7.2、§7.3、R-05/R-07 |
| D-008@v1 仅 claude 引擎 | confirmed | 非目标、§9、stream-json.ts 改动 |
| D-009@v2 worker .mcp.json=tmpdir+凭证走 per-server env（supersedes v1「spawnEnv 不落盘」：被 spike-01 结论反证，自定义 env 不透传 MCP 子进程） | accepted（grill round2 修正） | §6 task-runner.ts、R-09、R-03 |
| D-010@v1 run 页数据源=新端点 GET | accepted（grill 修正） | §6 run 页行、§7.2 |
| D-011@v1 写行后 Redis publish | accepted（grill 修正） | §7.2、§7.5、R-10 |

无未解决决策；剩余风险见 §10。

## 12. 自审（Self-Review）

- 章节齐全：背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审 ✅（frontmatter 含 author/created_at/scale）
- 生命周期关键词（session/agent_run/daemon）命中 → §7.5 契约表已含 8 事件（含实时扇出），每个事件在 §6 有对应代码/测试任务 ✅
- 文件清单含对外字段/DTO/事件 payload（MCP tool output、端点 resp、TurnSegment）→ 各行已标 producer→consumer 数据流 ✅
- 前端文件（.tsx）改动达原型级别 → `prototype-agent-file-upload-mcp.html` 已在变更目录 ✅
- decisions.md D-001~D-011（v2 版本覆盖 v1）全部在 §11 引用 ✅
- Design Grill Round1（独立子代理，verdict=fail）6 项 blocker 已全部修正并升版决策（D-004@v2/D-006@v2/D-009/D-010/D-011），留档 `design-grill-round1.md`；复审结论见 stage review。
- ⚠️ 自审存疑 1：R-03 备选方案（~/.claude.json 项目级配置）未展开设计，若 spike 失败需回本档补 v2。
- ⚠️ 自审存疑 2：classifySessionLog 现签名只收 (content, channel)，file 段映射需重构分类入口传入 toolKind（比「加一个分支」深），Wave3 实现时注意测试覆盖「FileUpload 行不再产生 tool_use 段」。
