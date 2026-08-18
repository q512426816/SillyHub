---
schema_version: 1
doc_type: module-card
module_id: tool_gateway
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工具操作安全网关（tool_gateway）

## 定位
agent 工具操作的安全网关 + 策略引擎：
7 类工具（文件 / Shell / 测试 / HTTP）统一经 `execute` 入口，
在 worktree lease 根目录内执行，受 `ToolPolicy`
（工具白名单 / 命令黑名单 / 域名白名单 / SSRF 防护）约束，
输出脱敏 + 截断，双写审计（ToolOperationLog + AuditLog）。
同时是平台 SSRF 校验原语（`assert_public_hostname` / `SsrfBlocked`）的宿主，
llm_provider 等模块复用。

## 契约摘要
- 路由：
  - `tag=tool_gateway`：`POST /worktrees/{lease_id}/tools`
    （`ToolExecuteRequest`→`ToolExecuteResponse`）；
    approvals 四端点（`GET .../approvals/pending` / `history`、
    `POST .../approvals/{request_id}/approve` / `reject`）为 **V1 stub**——
    pending/history 返回空列表，approve/reject 直接回包不落任何状态
  - `tag=tool_policy`（policy_router）：
    `/workspaces/{ws}/tool-policies` POST/GET/GET {id}/PATCH/DELETE
    （workspace 级策略，workspace_id+name 唯一索引，PATCH 支持部分更新）
- 7 种工具（`_dispatch` 按名路由）：file_read / file_write / file_list /
  file_search / shell_exec / run_tests / http_get，各有 `_handle_*` handler
- 数据：
  - `ToolOperationLog`：tool_type / params / result_code / redacted_output 等审计行
  - `ToolPolicy`：allowed_tools（默认全量）/ blocked_commands（默认空）/
    allowed_paths（默认 ["."]）/ allowed_domains（默认空）/ max_timeout=30 /
    max_output_size=64000
  - `PolicyLimits(effective_timeout, max_output_size)`：apply_limits 的解析产物
- 错误：`ToolOperationForbidden`(403) / `ToolPathForbidden` /
  `SsrfBlocked`(400，跨模块通用信号) / `GitCommandError`（worktree 域）

## 关键逻辑
execute 主链路（`ToolGatewayService.execute`）：
```
lease, task = _get_lease_and_task(lease_id, user)    # lease 有效 + 关联 task
policy = default_policy()                            # 宽松兜底（见注意事项）
await asyncio.to_thread(ToolPolicyService.check, ...)  # 白名单/黑名单/域名+SSRF
limits = apply_limits(policy, params)                # timeout/output cap，不改 params
result = _dispatch(tool_type, params, lease_root, allowed_paths, limits, isolated_env)
输出截断到 limits.max_output_size
→ 双写 ToolOperationLog + AuditLog(action=f"tool:{type}") → commit
```
- check 三步（纯静态方法，无 DB）：`_check_tool_allowed` →
  shell_exec/run_tests 走 `_check_command_not_blocked` →
  http_get 走 `_check_domain_allowed` + 私网校验
  （IPv4 五段 + IPv6 loopback/ULA/link-local，security-backend-guardrails task-03）
- `_handle_http_get` **逐跳 SSRF**：httpx follow_redirects=False 手动循环
  （≤重定向上限），每跳 `core.ssrf.assert_public_url` 复查——
  封 3xx 跳内网 / 169.254.169.254 / IPv6 私网 / 非 http-https scheme（B4/R-04）；
  SsrfBlocked / UnsafeRepoUrl 捕获转 result_code=1 输出
- shell_exec / run_tests：`validate_shell_command` 黑名单（sudo/rm -rf/mkfs/dd/
  nc/crontab/shutdown 等）前置；`asyncio.create_subprocess_exec(cwd=lease_root,
  env=isolated_env)`；timeout 上限 120s（超时 kill 后返超时输出）；
  stdout 经 `redact_output` 脱敏（git_gateway 提供）再截断；
  run_tests 支持 pytest/jest 输出解析（`_parse_test_output`）
- `validate_path`：路径必须在 allowed_paths 内并限 lease_root，防遍历

## 注意事项
- **策略 CRUD 与执行链路未接线**：router 的 execute 调
  `service.execute(..., policy=None)` → 恒用 `default_policy()`
  （全工具允许、无黑名单、30s/64000 上限）；ToolPolicy 表有完整 CRUD 但没有
  任何执行路径加载它——要真收紧需先把 policy 加载接进 execute
- 审批流是占位 stub：不存在 pending 队列与真实 approve/reject 状态机，
  前端审批面板拿到的永远是空列表 / no-op 回包
- check 整体 `asyncio.to_thread` 是刻意的：SSRF 的同步 `socket.getaddrinfo`
  直接跑事件循环会被慢 DNS 拖垮整个 worker（含 daemon WS 连接），勿改回
- `_check_not_private_ip`（policy 阶段）IPv4-only，逐跳 assert_public_url 补
  IPv6 与重定向盲区，两层并存是有意设计
- 所有操作限 lease 对应 worktree 目录内，跨 lease 不可达；
  lease 无关联 task 时 allowed_paths 为空列表
- `SsrfBlocked` 是通用信号：llm_provider.fetch_models 等非工具场景捕获后
  转自己的领域错误，本模块勿替消费方决定语义
- 输出截断双保险：execute 统一按 limits.max_output_size 截 +
  handler 内 MAX_OUTPUT_SIZE 截；脱敏发生在落库前

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
