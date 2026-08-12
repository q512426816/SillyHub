---
author: qinyi
created_at: 2026-08-12 10:13:52
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员 | 点「初始化」的人（actor_user_id），init 完成后获得本地 local.yaml 配置 |
| daemon | 领 init lease、写成员本地 local.yaml 的本地守护进程 |
| 后端 platform_sync 模块 | 签发 shpsync_ 同步 token |
| 后端 mcp_gateway 模块 | 签发 shmcp_ 工作区 MCP token |

## 功能需求

### FR-01: init claim 时签发两个 workspace-scoped token
覆盖决策：D-001

Given 一个 workspace 已 ensure_spec_workspace 且成员已绑定 daemon
When daemon claim 该 workspace 的 init lease（mode='init'）
Then 后端 `build_claim_payload` 调 `PlatformSyncTokenService.get_or_issue(ws, actor)` + `McpTokenService.get_or_issue(ws, actor)` 拿明文，注入 `payload.platform_config.local_yaml={platform_token, mcp_token}`

### FR-02: get_or_issue 吊销旧未吊销 + 签新（逻辑复用，不堆积）
覆盖决策：D-001

Given 同一 (workspace_id, created_by) 已存在未吊销的 shpsync_/shmcp_ token
When init claim 调 get_or_issue
Then 旧 token 被 revoke（revoked_at=now），新 token 签发返回明文；同维度始终仅一条活 token

Given 同一 (workspace_id, created_by) 无未吊销 token
When init claim 调 get_or_issue
Then 直接签新 token 返回明文

### FR-03: 明文 token 不落 lease.metadata
覆盖决策：D-002（P0 安全）

Given init lease 正被 claim
When build_claim_payload 注入 local_yaml
Then 明文 token 只存在于 claim 请求的内存 payload，**不写** lease.metadata_（DB 持久化 JSON 列、被审计服务读取）；DB 两 token 表只存 sha256 hash

### FR-04: daemon 写 local.yaml platform 段（权威覆盖）
覆盖决策：D-004

Given daemon 收到含 local_yaml 的 init payload + rootPath
When handleInitLease 执行 writeLocalYaml
Then `<rootPath>/.sillyspec/local.yaml` 的 `platform:` 顶层段被文本级覆盖为 `{url: <serverOrigin>, token: <platform_token>}`，段外注释/其他段/CRLF 字节级保留；文件不存在则创建

### FR-05: daemon 写 local.yaml mcp 段（有才留）
覆盖决策：D-004

Given daemon 收到含 local_yaml 的 init payload
When handleInitLease 执行 writeLocalYaml
Then 若 `mcp:` 顶层段**不存在**，写入 `{url: <serverOrigin>/mcp, token: <mcp_token>}`；若**已存在**（用户手填），原样保留不动

### FR-06: url 由 daemon 端决定
覆盖决策：D-002

Given daemon 写 local.yaml
Then platform_url = daemon `config.server_url`（去尾斜杠），mcp_url = platform_url + `/mcp`；**不用** payload 的 server_origin（避免后端 SERVER_ORIGIN 与本机可达地址不一致）

### FR-07: 写 local.yaml 失败 = init 整体失败
覆盖决策：D-003

Given writeLocalYaml 因任何原因失败（无写权限/磁盘满/路径无效）
When handleInitLease 第 4 步 catch 到错误
Then 返回 `ok:false`，`_runInitLease` 据 result.ok 走 `_finish(false)`，lease 标 failed，init_synced_at 不回写；前端显示初始化失败

### FR-08: mcp token scope 合法
Given McpTokenService.get_or_issue 签发
Then scope 必须取 `MCP_SCOPES` 合法值（read/dispatch/converge，auth.py:44）；init 场景用 `['dispatch']`（execute 派 Wave 子代理语义）；不可用非法值（绕过 router Literal 收口会持久化废 token）

## 非功能需求

- **兼容性**：Windows/Linux/macOS 路径与换行（CRLF/LF 字节级保留）；文本级段替换算法跨平台一致。
- **安全**：明文 token 最小暴露（仅 claim 内存），DB 只存 hash，token workspace-scoped 可独立吊销。
- **零回归**：get_or_issue 不改原 create/authenticate；init dispatch 阶段行为不变（不签 token、不碰 local.yaml 的写入仍只在 claim 后）；connect 命令行为不变。
- **幂等**：重复 init（同 ws+人）不堆积废 token（get_or_issue 吊销旧+签新）。

## 约束

- 不修改 sillyspec 工具仓（`~/IdeaProjects/sillyspec/`）任何文件。
- daemon 段替换算法复制 sillyspec sync.js 逻辑（TS 重写），逐测试对齐。
