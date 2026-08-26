---
author: qinyi
created_at: 2026-08-26 14:05:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员（Writer） | 可在工作区 MCP 页查看并编辑本工作区 MCP 配置 |
| 平台管理员（admin） | 维护平台默认 MCP 配置与白名单（既有功能，本变更不改动） |
| daemon | 启动 agent 会话时拉取三件套并合并注入 |
| agent（Claude 会话） | MCP server 配置的最终消费者 |

## 功能需求

### FR-01: 工作区 MCP 配置页可编辑
覆盖决策：D-001@v1, D-002@v1

Given 用户是工作区 Writer 且打开 `/workspaces/[id]/mcp` 页
When 点击「编辑」进入编辑态、修改 JSON、点击保存且校验通过
Then 调 `PUT /api/workspaces/{id}/mcp-config` 成功，页面回到查看态并展示写后配置

Given 编辑态 JSON 存在语法错误或结构不合法（顶层无 `mcpServers`、command 缺失、args 非数组、type 非 stdio）
When 点击保存
Then 前端 zod 校验拦截，中文报错并定位到 server 名，不发请求

Given 用户无 WorkspaceWriter 权限
When 尝试调 PUT 接口
Then 后端 403（与 mcp-tokens 签发同权限模式）

### FR-02: 仅允许 stdio 类型
覆盖决策：D-005@v2

Given 请求体某 server 的 `type` 为 `sse`/`http` 或其它非 `stdio` 值
When 调 PUT
Then 后端 `HTTP_422_MCP_TYPE_NOT_STDIO`（中文报错）拒绝整个请求，文件不落盘

Given daemon 拉取的工作区配置含非 stdio server（存量/手改文件）
When `fetchMcpBundle` 解析
Then 该 server 被跳过并记 warn，不抛错、不阻塞会话创建

### FR-03: 密钥 `<set>` 占位符往返
覆盖决策：D-003@v2

Given 现有 `.mcp.json` 某 env 键为密钥类且 GET 已脱敏为 `<set>`
When PUT 请求中该键值保持 `<set>`
Then 后端从磁盘现有文件同名 server 同名键还原真值写入，响应中该键仍显示 `<set>`

Given PUT 请求中某 `<set>` 键在磁盘现有文件中找不到对应真值（server 改名/键新增）
When 调 PUT
Then 后端 `HTTP_422_MCP_SECRET_UNRESOLVABLE`（中文报错，指明 server 名与键名），`<set>` 字面量绝不写盘

### FR-04: daemon 端到端注入
覆盖决策：D-004@v1, D-006@v2, D-007@v2, D-008@v1

Given 工作区会话（普通/主控，`execPayload.workspaceId` 存在）
When daemon `_startInteractiveSession` 创建会话
Then 预取三件套（平台默认+白名单+工作区配置），provider 以 `mergeMcpConfigs([...whitelist, DAEMON_MCP_SERVER_NAME, FILE_MCP_SERVER_NAME], platform, workspace, builtin)` 合并注入；同名覆盖优先级 builtin > workspace > platform

Given 某 workspace server 名不在平台白名单
When 合并注入
Then 该 server 被剔除并记 warn 日志

Given 三件套拉取失败（backend 不可达等）
When 创建会话
Then platform 回落本地 `~/.sillyhub/daemon/mcp.json`、workspace 回落空配置，仅记 warn；内置 server 注入不受影响，会话创建不被阻塞

Given 会话 restore/reload 时缓存缺失
When provider 取缓存
Then 重取一次，仍失败回落空 bundle + warn（不静默永久丢失）

Given quick-chat / legacy shared 会话（无 workspaceId）
When 创建会话
Then 不预取工作区配置，仅平台默认 + 内置（现状不变）

### FR-05: daemon API 向后兼容扩展
覆盖决策：D-004@v1

Given daemon 调 `GET /api/daemon/mcp/config` 不带 `workspace_id`
When 响应
Then 结构与现状完全一致（`{platform_default, whitelist}`）

Given 带 `workspace_id` 且该工作区 `.mcp.json` 存在
When 响应
Then 追加 `workspace: {mcpServers: {...}}`（明文，不脱敏）；文件缺失/解析失败返回空 `{}` 不报错

## 非功能需求

- 兼容性：旧 daemon 配新 backend（忽略新字段）与新 daemon 配旧 backend（fetch 失败回落）均不崩
- 跨平台：`.mcp.json` 写入临时文件 + `os.replace` 原子替换，Windows/Linux 通用；`ensure_ascii=False` + `indent=2` + 末尾换行
- 安全：daemon API 明文响应仅 daemon token 鉴权可达；写操作落审计日志；密钥不明文回传浏览器
- 可回退：页面保留「取消」退出编辑不保存；`.mcp.json` 删除后行为回到现状（空配置）
- 可测试：后端 pytest / daemon vitest（或既有 runner）/ 前端 vitest 各层有用例；错误文案中文（守护测试约束）

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | 页面可编辑（推翻旧 D-006） |
| D-002@v1 | FR-01 | textarea JSON 编辑形态 |
| D-003@v2 | FR-03 | `<set>` 服务端还原本变更新设 |
| D-004@v1 | FR-04, FR-05 | daemon 经扩展 API 拉三件套（方案 A） |
| D-005@v2 | FR-02 | 后端拒绝写入 + daemon 预净化跳过 |
| D-006@v2 | FR-04 | 优先级链 + 内置名并入白名单参数 |
| D-007@v2 | FR-04 | 预取挂点 daemon.ts + 会话级缓存 |
| D-008@v1 | FR-04 | 覆盖范围：工作区普通/主控会话，分身除外 |
