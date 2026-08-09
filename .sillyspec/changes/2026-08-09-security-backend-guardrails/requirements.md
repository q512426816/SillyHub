---
author: qinyi
created_at: 2026-08-09T20:49:11
---
# 需求（Requirements）— 后端防护加固：incident 状态机转换校验 + SSRF 三连

## FR-01 · incident 合法转换图（放宽版）
**Given** incident 状态有 open / investigating / mitigated / resolved 四态，
**When** 调用 `IncidentService.update` 改 status，
**Then** 仅允许以下迁移：open→{investigating, resolved}；investigating→{mitigated, open, resolved}；mitigated→{resolved, investigating}；resolved→{investigating}。其余迁移拒绝。
**依据**：D-001@v1。

## FR-02 · incident 非法转换返 422
**Given** 一个已存在的 incident（状态 S1），
**When** update 传 status=S2 且 S1→S2 不在转换图（如 open→mitigated、resolved→open），
**Then** 抛 `InvalidTransition`（HTTP 422，含 current/target/allowed 详情），状态不变。
**依据**：D-001@v1、D-006@v1。

## FR-03 · incident 非法状态值仍返 400
**Given** 一个已存在 incident，
**When** update 传 status="unknown"（值不在 VALID_STATUSES），
**Then** 抛 `IncidentError`（HTTP 400，match="Invalid status"）。值校验先于转换校验。
**依据**：D-006@v1（保 test_update_invalid_status 绿）。

## FR-04 · resolved 重开清空解决字段
**Given** 一个 resolved 状态的 incident（有 resolved_at + resolved_by），
**When** update 传 status="investigating"（重开，合法），
**Then** resolved_at 置 None、resolved_by 置 None，status 变 investigating。
**依据**：D-002@v1。

## FR-05 · incident 同状态幂等
**Given** 一个状态为 S 的 incident，
**When** update 传 status=S（与当前相同），
**Then** 不报错、不触发转换校验、直接放行（幂等 no-op）。
**依据**：D-006@v1。

## FR-06 · incident 进 resolved 写解决字段
**Given** 一个非终态 incident，
**When** update 传 status="resolved"（合法转换），
**Then** resolved_at 写当前 UTC 时间；resolved_by 写传入值（若有）。
**依据**：D-001@v1（保持现有 test_update_resolve 行为）。

## FR-07 · worktree clone 协议白名单
**Given** clone_bare 收到一个 repo_url，
**When** 协议为 ext::（含 ext:: 前缀）、file://、file:::、或裸本地路径（/abs、./rel、..、Windows 盘符 C:\foo / C:/foo），
**Then** 抛 `UnsafeRepoUrl`（HTTP 400），不执行 clone。
**When** 协议为 https / ssh / git（含 `://`），或 scp-like（无 `://`、含 `:`、首 `:` 前 token 形如 hostname `[A-Za-z0-9.@-]+` 且非单字母盘符，如 git@host:path、host.xz:path），
**Then** 放行（不查 IP，允许内网 git）。
**依据**：D-004@v1 + Design Grill X-02/P2-1（Windows 盘符收紧）。

## FR-08 · mcp webhook 注册 SSRF 校验
**Given** McpWebhookService.create 收到一个回调 url，
**When** url 的 scheme 非 http/https（如 file://）或 host 解析到私网/保留/不可解析（127.0.0.1、169.254.169.254、10.x、192.168.x、::1、fc00::、fe80::），
**Then** 抛 SsrfBlocked/UnsafeRepoUrl（HTTP 400），不落库。
**When** url 是公网 http/https，
**Then** 正常注册。
**依据**：D-003@v1。

## FR-09 · mcp webhook 投递前复查 SSRF
**Given** WebhookDispatcher._deliver_one 即将 POST webhook.url，
**When** 复查 assert_public_url 发现 host 解析到私网/不可解析（防注册后 DNS 重绑定/解析变更），
**Then** 记 warning + 放弃该条投递（best-effort，不重试、不向上抛、不影响主流程）。
**依据**：D-003@v1。

## FR-10 · http_get 逐跳 SSRF 复查（修 IPv6 + 重定向）
**Given** _handle_http_get 处理一个 url，
**When** url 的 host 解析到 IPv4/IPv6 私网（含 ::1/fc00::/fe80::），或 3xx 重定向的任一跳 Location 指向私网，
**Then** 拒绝（返 result_code 错误 / SsrfBlocked），不跟随到私网。
**When** 公网地址 + 公网重定向（≤3 跳，每跳校验通过），
**Then** 正常返回响应。
**额外**：3xx 缺 Location header 或 Location 畸形 → 返回 `{"result_code": 1, "output": "Invalid redirect"}` 不 hang。
**依据**：D-005@v1 + Design Grill P2-2。

## NFR-01 · 现有功能零回归
- incident 模块现有测试（test_service.py / test_router.py）全绿，仅新增用例不改动既有断言（除非测试逻辑本身模拟了现已非法的迁移——经核实无此情况）。
- mcp_gateway / worktree / tool_gateway 现有公网用例不受影响。

## NFR-02 · 跨平台
- 所有改动纯 Python（urllib / ipaddress / asyncio / httpx），无平台特定代码，兼容 Windows / Linux / macOS（CLAUDE.md 规则 13）。

## NFR-03 · 不碰对外契约
- 不改 OpenAPI schema / DTO / 响应体 / 表结构 / migration → 无需 gen:types。

## AC（验收锚点）
| AC | 对应 FR | 验证手段 |
|---|---|---|
| AC-1 incident 全部合法边可迁移 + 关键非法边拒 422 | FR-01/02 | test_fsm.py 新用例 |
| AC-2 test_update_invalid_status 仍 400 | FR-03 | 既有用例保持绿 |
| AC-3 重开清 resolved_at/by | FR-04 | test_fsm.py 新用例 |
| AC-4 同状态幂等放行 | FR-05 | test_fsm.py 新用例 |
| AC-5 进 resolved 写解决字段 | FR-06 | 既有 test_update_resolve 保持绿 |
| AC-6 worktree ext::/file:///C:\foo 拒、https/ssh/git@ 放行 | FR-07 | test_repo_url_guard.py |
| AC-7 mcp webhook 注册内网/本机/云元数据拒 | FR-08 | test_webhook_ssrf.py |
| AC-8 mcp 投递前复查（mock 私网 url 放弃） | FR-09 | test_webhook_ssrf.py |
| AC-9 http_get IPv6 私网拒、重定向到 127.0.0.1 拒 | FR-10 | test_ssrf.py |
| AC-10 现有 incident/mcp/worktree/tool_gateway 测试零回归 | NFR-01 | 全量 pytest 回归 |
