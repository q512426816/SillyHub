---
schema_version: 1
doc_type: module-card
module_id: tool_gateway
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工具调用网关（tool_gateway）

## 定位

agent 在 worktree lease 内执行工具调用的统一校验/执行/审计网关。三层：`ToolGatewayService`
（执行编排）、`ToolPolicyService`（无状态策略校验 + SSRF 原语）、policy CRUD（ToolPolicy
表管理）。审批流为 V1 stub。`assert_public_hostname` 被 core/ssrf.py 复用为全仓 SSRF
原语（llm_provider 等经它做外联校验）。

## 契约摘要

- `POST /api/worktrees/{lease_id}/tools` —— 执行工具（7 类：file_read / file_write /
  file_list / file_search / shell_exec / run_tests / http_get）
- `GET .../workspaces/{wid}/approvals/pending` / `history` —— **stub 返回空数组**
- `POST .../approvals/{request_id}/approve` / `reject` —— **stub no-op**，直接返回
  假状态（完整审批流 pending V2）
- policy CRUD（policy_router.py）：`/api/workspaces/{wid}/tool-policies[/{pid}]`，
  WORKSPACE_ADMIN 权限；表 `tool_policies`（(workspace_id, name) 唯一；allowed_tools /
  blocked_commands / allowed_paths / allowed_domains JSON；max_timeout / max_output_size）
- 每次执行双写：`ToolOperationLog`（业务日志）+ workflow `AuditLog`（action=
  `tool:{type}`）
- `SsrfBlocked`（AppError）—— 私网/解析失败时抛

## 关键逻辑

```
execute(lease_id, user, tool_type, params):
  lease 存在 + 属本人 + status=="locked"（否则 404/403）
  policy = default_policy()        # 现状：router 不传 → 恒默认宽松策略
  await asyncio.to_thread(check)   # SSRF 的 DNS 解析移线程池，不阻塞事件循环
  limits = apply_limits(policy); result = _dispatch(...)  # 路由到 7 个 handler
  输出超限截断 → 双写 op_log + AuditLog → commit
```

## 关键逻辑补充

- policy check 四连：tool 白名单 → shell 命令黑名单（`SHELL_BLOCKED_PATTERNS` 正则拦
  sudo / rm -rf / mkfs / dd / nc / shutdown 等）→ 域名白名单 → SSRF 私网检查
  （`_PRIVATE_NETWORKS` 网段字面量 + `assert_public_hostname` DNS 解析复核，防
  域名指向内网）
- http_get 手动逐跳重定向 ≤3 跳（`_MAX_REDIRECT_HOPS`），每跳 `assert_public_url`
  复查，封堵重定向绕过
- 子进程隔离（ql-20260808-001）：shell_exec / run_tests 经
  `ExecEnvBuilder.build_env_vars` 构造最小 env（HOME/GIT_* + OS 非密白名单），绝不
  继承宿主 os.environ；http_get 用 httpx 不起子进程
- file 类 handler 走 `validate_path` 强制 target 落在 lease_root 内（沙箱越界 403）
- run_tests 支持 pytest / go_test，输出解析为结构化 JSON

## 注意事项

- **策略未接线（如实认知）**：execute 端点不加载 workspace 的 ToolPolicy 行，恒用
  `default_policy()`（非持久化宽松默认）——policy CRUD 建的行目前不参与执行路径，
  接线是待办；接线时应改为按 workspace/agent 加载持久化策略
- **审批是 stub**：pending/history 恒空、approve/reject 无副作用，前端不要把假状态当
  真审批结果
- 错误文案已中文化（error-message-l10n），守护测试强制新 raise 含 CJK
- `MAX_OUTPUT_SIZE = 64_000` 截断；`DEFAULT_TIMEOUT = 30s`
- ToolPolicyService 是纯静态方法集（无 DB 状态），策略对象由调用方传入，测试友好
- core/ssrf.py → `assert_public_hostname` 的依赖方向是 core 依赖本模块（历史原语所
  在地），动签名须同步 ssrf.py 与 llm_provider 探活

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
