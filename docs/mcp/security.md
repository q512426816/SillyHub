# 安全：scope、token 吊销、本地隧道与注意事项

本篇讲对外 MCP 的安全模型：token 能干什么（scope）、怎么吊销、本地开发怎么把服务暴露
给第三方，以及若干"不存明文"的注意事项。

## scope 模型

McpToken 签发时带一组 scope，决定它能调哪些 tool。scope 取值只有三个：

| scope | 含义 |
| --- | --- |
| `read` | 只读：看 profile、worker 状态、产出、日志 |
| `dispatch` | 派发：建 mission、派 worker、落决策日志 |
| `converge` | 收敛：触发 mission 合并收尾 |

### scope 与 8 tool 对应表

| tool | read | dispatch | converge |
| --- | :-: | :-: | :-: |
| list_agent_profiles | ✓ | | |
| list_workers | ✓ | | |
| get_worker_result | ✓ | | |
| get_run_logs | ✓ | | |
| create_mission | | ✓ | |
| dispatch_worker | | ✓ | |
| report_progress | | ✓ | |
| converge_mission | | | ✓ |

每个 tool 入口都做 scope 校验，不足即拒绝（403），**不触达业务逻辑**。拒绝决策会记
structlog 日志（带所需 scope / 已有 scope / workspace_id / token_id，**不含 token
凭据**）。

**最小授权建议**：只做监控的集成就只签 `read`；要派任务加 `dispatch`；`converge` 单独
授权（它能触发 git 合并，影响面最大）。一个 token 可同时带多个 scope（最多 3 个）。

### workspace 隔离

token 绑定唯一 workspace，所有 tool 的 `workspace_id` 都由 token 注入、**不接受客户端
指定**。即使你知道别的 workspace 的 mission_id，调过去也一律 404（跨 workspace 视同
不存在），不会泄露"存在 vs 不存在"。

## token 生命周期与吊销

### 签发与存储（不存明文）

- 明文 token 形如 `shmcp_<32 随机字节 url-safe>`，**只在签发响应里返回一次**，之后无法
  找回。
- 数据库只存 `sha256(明文)`（`token_hash`，唯一索引），**不存明文**。校验时按
  `token_hash` O(1) 查表（MCP 每次工具调用都过这里，必须亚毫秒）。
- 校验带 Redis 正 / 负缓存（命中免查库，redis 故障自动降级直查 DB，认证永不因缓存层
  故障而失败）。
- 明文与 `token_hash` **永不进日志、永不进任何响应**。日志只带 `token_id`（UUID，
  非敏感）。

### 吊销流程

```http
DELETE /api/workspaces/{workspace_id}/mcp-tokens/{token_id}
Authorization: Bearer <平台用户 JWT>   # owner/admin
```

- 成功返 **204**。吊销是幂等的，且**立即生效**：吊销时精确清除该 token 的正缓存，无
  TTL 放行窗口。
- 不存在 / 已吊销 / 跨 workspace 越权统一返 **404**（不区分原因，防存在性探测）。
- 吊销后用该 token 的 MCP 调用立即 401。

`GET /api/workspaces/{workspace_id}/mcp-tokens` 可列出全部 token（含已吊销），带
`last_used_at` / `revoked_at`，用于审计"哪个 token 还在用、什么时候用过"。

### webhook secret 的存储

注册 webhook 时填的 `secret` 同样**不明文入库**：服务端加密后存储（密文 + key_id 编码
进单列，支持将来密钥轮换），任何响应都不回显 secret。只有投递器在发推送前临时解密出
明文算 HMAC。请你自己保存好 secret——校验签名要用，平台无法帮你找回。

## 本地开发隧道（R-03）

第三方 MCP client（尤其云端 agent）需要能通过公网 URL 访问你的本地 SillyHub 后端。本地
开发用隧道把本地端口暴露成公网 HTTPS：

### ngrok

```bash
ngrok http 8000    # 8000 换成你本地后端端口
```

输出里 `Forwarding` 行的 `https://xxxx.ngrok-free.app` 即公网地址，接入 URL 就是
`https://xxxx.ngrok-free.app/mcp/`（带尾斜杠）。

### cloudflare tunnel

```bash
cloudflared tunnel --url http://localhost:8000
```

输出里会给一个 `https://xxxx.trycloudflare.com` 临时域名，接入 URL 是
`https://xxxx.trycloudflare.com/mcp/`。

注意事项：

- 隧道只是把本地端口暴露出去，**鉴权仍靠 McpToken**——别以为走了隧道就安全，token
  一样要保护好。
- 每次重启隧道临时域名会变，记得同步更新 client 里的 URL。
- 生产环境请用正式域名 + HTTPS，不要用临时隧道域名。

## 其它注意事项

- **MCP 通道只认 header**：`Authorization: Bearer <token>`，**刻意不支持 `?token=`
  query 参数**——query 会被反向代理 / 访问日志记录，明文 token 一旦落盘即构成泄漏。
- **日志脱敏**：`get_run_logs` 只返回 `content_redacted`（脱敏后内容），平台只存脱敏后
  日志，第三方永远拿不到原始明文，agent 运行中碰到的密钥不会外泄。
- **agent 层不存密钥**：`list_agent_profiles` 返回的 profile 摘要只含工具能力面
  （tool_policy / mcp_refs / skill_refs），不含任何密钥。
- **失败形态统一**：token 无效 / 过期 / 已吊销的报错 message 统一，不告诉攻击者具体是
  哪种；删除不存在的资源统一 404 而非区分原因。
