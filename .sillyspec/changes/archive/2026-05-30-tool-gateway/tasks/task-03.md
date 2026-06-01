---
id: task-03
title: ToolPolicyService 策略校验引擎
priority: P0
estimated_hours: 4
depends_on: [task-01]
blocks: [task-05, task-06, task-07]
allowed_paths:
  - backend/app/modules/tool_gateway/tool_policy.py
  - backend/tests/modules/tool_gateway/test_tool_policy_service.py
---

# task-03: ToolPolicyService 策略校验引擎

## 背景

本任务在 task-01 产出的 `ToolPolicy` 模型基础上，构建集中式策略校验引擎 `ToolPolicyService`。该服务封装所有策略校验逻辑（工具白名单、命令黑名单、路径校验、域名白名单、资源限制），使 `ToolGatewayService.execute()` 只需调用 `ToolPolicyService.check()` + `ToolPolicyService.apply_limits()` 即可完成策略管控，无需在 execute 流程中散布校验代码。

**关键前置**：task-01 完成后会创建 `backend/app/modules/tool_gateway/tool_policy.py`，其中定义 `ToolPolicy` SQLModel 模型、`ALL_TOOLS` 常量和 `default_policy()` 工厂函数。本任务在同一文件中追加 `ToolPolicyService` 类。

## ToolPolicy 模型定义（task-01 产出，本任务只读）

```python
# task-01 在 backend/app/modules/tool_gateway/tool_policy.py 中创建：

ALL_TOOLS = ["file_read", "file_write", "file_list", "file_search", "shell_exec", "run_tests", "http_get"]

class ToolPolicy(BaseModel, table=True):
    __tablename__ = "tool_policies"
    # 字段：id, workspace_id, name, allowed_tools, blocked_commands,
    #       allowed_paths, allowed_domains, max_timeout, max_output_size,
    #       created_at, updated_at

def default_policy() -> ToolPolicy:
    """返回非持久化的默认策略对象，全量允许。"""
```

## 修改文件（必填）

| 操作 | 文件路径 |
|------|----------|
| 修改 | `backend/app/modules/tool_gateway/tool_policy.py` — 在文件末尾追加 `ToolPolicyService` 类及辅助函数 |
| 新增 | `backend/tests/modules/tool_gateway/test_tool_policy_service.py` — 策略引擎单元测试 |

## 实现要求

### 1. 在 `tool_policy.py` 末尾追加 `ToolPolicyService` 类

该类是**无状态服务**（不需要 `__init__` 或 session），所有方法均为 `@staticmethod` 或独立函数。策略校验所需的全部信息通过 `ToolPolicy` 对象参数传入。

**核心方法**：

- `check(policy, tool_type, params, lease_root)` — 集中校验入口
- `apply_limits(policy, params)` — 资源限制裁剪

### 2. 校验逻辑详细设计

按 design.md AD-2 的分层原则，`ToolPolicyService.check()` 依次执行以下校验步骤（任一步失败立即抛出对应异常）：

1. **工具白名单校验**：`tool_type not in policy.allowed_tools` → `ToolOperationForbidden`
2. **命令黑名单校验**（仅 `shell_exec` / `run_tests`）：`params` 中的 `command` + `args` 包含 `policy.blocked_commands` 中的任一项 → `ToolOperationForbidden`
3. **域名白名单校验**（仅 `http_get`）：从 `params["url"]` 提取域名，若 `policy.allowed_domains` 非空且域名不在其中 → `ToolOperationForbidden`
4. **SSRF 防护**（仅 `http_get`）：域名解析为内网 IP（10.x / 172.16-31.x / 192.168.x / 127.x） → `ToolOperationForbidden`

**注意**：路径校验（`validate_path`）和全局命令黑名单（`validate_shell_command`）已在 `service.py` 中独立实现，`ToolPolicyService` 不重复实现，而是在 task-07 集成时由 execute() 方法在调用 check() 前后分别调用。

### 3. 资源限制裁剪

`apply_limits()` 不抛异常，只返回裁剪后的值（幂等、安全降级）：

- `effective_timeout = min(params.get("timeout", DEFAULT_TIMEOUT), policy.max_timeout)`
- `max_output = policy.max_output_size`

返回一个 `PolicyLimits` dataclass 或简单 dict 供调用方使用。

## 接口定义（代码类任务必填）

### ToolPolicyService 类

```python
# 追加到 backend/app/modules/tool_gateway/tool_policy.py

from __future__ import annotations

import ipaddress
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from app.core.errors import AppError
from app.core.logging import get_logger

log = get_logger(__name__)


class ToolOperationForbidden(AppError):
    """Re-exported for convenience — policy check uses the same error class.
    
    Alternatively, define a distinct ToolPolicyViolation error if separation
    is desired. For simplicity, reuse the existing ToolOperationForbidden
    from service.py (same module boundary).
    """
    code = "TOOL_OPERATION_FORBIDDEN"
    http_status = 403


@dataclass(frozen=True)
class PolicyLimits:
    """Resolved resource limits after applying policy constraints."""
    effective_timeout: int
    max_output_size: int


class ToolPolicyService:
    """Stateless policy validation engine.
    
    All methods are static — the policy object is passed in each call.
    No DB access is performed; the ToolPolicy instance is expected to be
    loaded by the caller (e.g., ToolGatewayService._load_policy).
    """

    # ── 内网 IP 范围（SSRF 防护） ──
    _PRIVATE_NETWORKS: list[ipaddress.IPv4Network] = [
        ipaddress.IPv4Network("10.0.0.0/8"),
        ipaddress.IPv4Network("172.16.0.0/12"),
        ipaddress.IPv4Network("192.168.0.0/16"),
        ipaddress.IPv4Network("127.0.0.0/8"),
        ipaddress.IPv4Network("169.254.0.0/16"),
        ipaddress.IPv4Network("0.0.0.0/8"),
    ]

    @staticmethod
    def check(
        policy: ToolPolicy,
        tool_type: str,
        params: dict,
        lease_root: Path | None = None,
    ) -> None:
        """Validate a tool call against the given policy.
        
        Raises:
            ToolOperationForbidden: if the tool call violates the policy.
        
        Args:
            policy: The ToolPolicy to check against.
            tool_type: The tool type being called (e.g., "shell_exec").
            params: The tool call parameters dict.
            lease_root: The worktree lease root path (for future path-based
                        policy checks). Currently unused but reserved.
        """
        # Step 1: Tool whitelist
        ToolPolicyService._check_tool_allowed(policy, tool_type)

        # Step 2: Command blacklist (shell_exec / run_tests only)
        if tool_type in ("shell_exec", "run_tests"):
            ToolPolicyService._check_command_not_blocked(policy, params)

        # Step 3: Domain whitelist (http_get only)
        if tool_type == "http_get":
            ToolPolicyService._check_domain_allowed(policy, params)

    @staticmethod
    def apply_limits(
        policy: ToolPolicy,
        params: dict,
        default_timeout: int = 30,
    ) -> PolicyLimits:
        """Compute effective resource limits from policy + params.
        
        Does NOT modify params. Returns a PolicyLimits dataclass with
        the capped values.
        
        Args:
            policy: The ToolPolicy providing max constraints.
            params: The tool params dict (may contain "timeout").
            default_timeout: Default timeout if params has no "timeout" key.
        
        Returns:
            PolicyLimits with effective_timeout and max_output_size.
        """
        requested_timeout = params.get("timeout", default_timeout)
        effective_timeout = min(requested_timeout, policy.max_timeout)
        return PolicyLimits(
            effective_timeout=effective_timeout,
            max_output_size=policy.max_output_size,
        )

    # ── Private helpers ──

    @staticmethod
    def _check_tool_allowed(policy: ToolPolicy, tool_type: str) -> None:
        """Raise ToolOperationForbidden if tool_type not in allowed_tools."""
        if tool_type not in policy.allowed_tools:
            raise ToolOperationForbidden(
                f"Tool '{tool_type}' not allowed by policy '{policy.name}'",
                details={
                    "tool_type": tool_type,
                    "allowed_tools": policy.allowed_tools,
                    "policy_name": policy.name,
                },
            )

    @staticmethod
    def _check_command_not_blocked(policy: ToolPolicy, params: dict) -> None:
        """Raise ToolOperationForbidden if command matches blocked_commands."""
        if not policy.blocked_commands:
            return

        command = params.get("command", "")
        args = params.get("args", [])
        combined = f"{command} {' '.join(args)}"

        for blocked in policy.blocked_commands:
            if blocked in combined:
                raise ToolOperationForbidden(
                    f"Command blocked by policy: '{blocked}'",
                    details={
                        "command": command,
                        "args": args,
                        "blocked_pattern": blocked,
                        "policy_name": policy.name,
                    },
                )

    @staticmethod
    def _check_domain_allowed(policy: ToolPolicy, params: dict) -> None:
        """Raise ToolOperationForbidden if domain not in allowed_domains
        or domain resolves to a private IP (SSRF protection).
        
        Empty allowed_domains means "allow all" (no restriction).
        """
        url = params.get("url", "")
        domain = _extract_domain(url)

        # SSRF protection — always enforced regardless of allowed_domains
        ToolPolicyService._check_not_private_ip(domain, url)

        # Domain whitelist — only enforced if allowed_domains is non-empty
        if policy.allowed_domains and domain not in policy.allowed_domains:
            raise ToolOperationForbidden(
                f"Domain '{domain}' not in allowed_domains",
                details={
                    "domain": domain,
                    "allowed_domains": policy.allowed_domains,
                    "url": url,
                    "policy_name": policy.name,
                },
            )

    @staticmethod
    def _check_not_private_ip(domain: str, url: str) -> None:
        """Raise ToolOperationForbidden if domain resolves to a private/internal IP.
        
        Uses ipaddress module for range checks. Resolution is done via
        socket.getaddrinfo (may perform DNS lookup). For testability,
        the resolution is wrapped in try/except — on resolution failure,
        the request is rejected (security-first).
        """
        if not domain:
            return

        import socket

        try:
            addrinfos = socket.getaddrinfo(domain, None, socket.AF_INET)
        except (socket.gaierror, OSError):
            # Cannot resolve — reject for safety
            raise ToolOperationForbidden(
                f"Cannot resolve domain '{domain}' — rejected for safety",
                details={"domain": domain, "url": url},
            ) from None

        for _, _, _, _, addr in addrinfos:
            ip_str = addr[0]
            try:
                ip = ipaddress.ip_address(ip_str)
                for network in ToolPolicyService._PRIVATE_NETWORKS:
                    if ip in network:
                        raise ToolOperationForbidden(
                            f"Domain '{domain}' resolves to private IP '{ip_str}' — SSRF blocked",
                            details={"domain": domain, "ip": ip_str, "url": url},
                        )
            except ValueError:
                continue


def _extract_domain(url: str) -> str:
    """Extract hostname from a URL string.
    
    Returns empty string if URL is malformed or has no hostname.
    """
    try:
        parsed = urlparse(url)
        return parsed.hostname or ""
    except Exception:
        return ""
```

### PolicyLimits dataclass 使用示例

```python
# 调用方（task-07 的 execute 方法）使用方式：
limits = ToolPolicyService.apply_limits(policy, params, default_timeout=DEFAULT_TIMEOUT)
# limits.effective_timeout — 裁剪后的超时
# limits.max_output_size — 策略允许的最大输出
```

### 与 task-07 的集成约定

task-07 的 `execute()` 方法将按以下模式集成本任务的 `ToolPolicyService`：

```python
# task-07 中 execute() 的调用序列（伪代码）
policy = await self._load_policy(lease)

# 1. 策略校验（本任务产出）
ToolPolicyService.check(policy, tool_type, params, lease_root)

# 2. 资源限制裁剪（本任务产出）
limits = ToolPolicyService.apply_limits(policy, params, default_timeout=DEFAULT_TIMEOUT)

# 3. 执行 handler（使用 limits.effective_timeout）
result = await self._dispatch(tool_type, params, lease_root, allowed_paths)

# 4. 写日志时使用 limits.max_output_size 替代硬编码
op_log = ToolOperationLog(..., redacted_output=result["output"][:limits.max_output_size])
```

**重要**：task-07 的蓝图已展示内联校验逻辑。在实现时，task-07 应改为调用 `ToolPolicyService.check()` 和 `ToolPolicyService.apply_limits()`，而非重复实现校验逻辑。这是 task-03 存在的核心价值——集中策略逻辑。

## 边界处理（必填）

1. **allowed_tools 为空列表**：`tool_type not in []` 始终为 True，所有工具调用被拒绝并抛出 `ToolOperationForbidden`。这是合法配置（锁定策略），不是 bug。

2. **blocked_commands 为空列表**：`_check_command_not_blocked` 在 `blocked_commands` 为空时直接 return，不遍历空列表。策略层无额外黑名单，全局 `SHELL_BLOCKED_PATTERNS` 由 `validate_shell_command()` 独立校验，两者叠加不冲突。

3. **allowed_domains 为空列表**：表示"不限制域名"（允许所有）。`_check_domain_allowed` 中 `if policy.allowed_domains` 为空列表时条件为 False，跳过域名白名单校验。但 SSRF 防护始终执行（独立于白名单）。

4. **URL 解析失败或 hostname 为空**：`_extract_domain()` 返回空字符串。如果 `allowed_domains` 非空，空字符串不在白名单中，请求被拒绝（安全优先：无法确定域名则拒绝）。如果 `allowed_domains` 为空，空域名不做白名单校验，但 SSRF 检查中空域名直接 return 不检查（无法解析 IP 的 URL 放行）。

5. **域名 DNS 解析失败**：`socket.getaddrinfo` 抛出 `socket.gaierror` 时，捕获异常并抛出 `ToolOperationForbidden`（安全优先：无法解析域名则拒绝，防止 DNS rebinding 攻击）。

6. **params 为空 dict**：`params.get("command", "")` 返回空字符串；`params.get("url", "")` 返回空字符串；`params.get("timeout", default_timeout)` 返回默认值。所有校验正常执行不崩溃。`apply_limits` 返回 `PolicyLimits(effective_timeout=default_timeout, max_output_size=policy.max_output_size)`。

7. **params 不包含 timeout**：`apply_limits` 使用 `default_timeout` 参数（默认 30），与 `policy.max_timeout` 取 min。调用方应传入正确的 `default_timeout`（通常为 `DEFAULT_TIMEOUT = 30`）。

8. **policy 为 default_policy() 产出**：默认策略 `allowed_tools=list(ALL_TOOLS)`（全部 7 种）、`blocked_commands=[]`、`allowed_domains=[]`、`max_timeout=30`、`max_output_size=64000`。所有校验通过，不阻塞任何现有工具调用，兼容旧行为。

9. **内网 IP 检测范围**：覆盖 RFC 1918 私有地址（10.0.0.0/8、172.16.0.0/12、192.168.0.0/16）、环回地址（127.0.0.0/8）、链路本地（169.254.0.0/16）和 "this network"（0.0.0.0/8）。不覆盖 IPv6（当前仅支持 IPv4，后续可扩展）。

10. **_check_command_not_blocked 使用子字符串匹配**：`blocked in combined`，不做正则匹配。例如 `blocked="curl"` 会匹配 `"curl "` 和 `"curl\n"`，也会匹配 `"mcurl"`。如果需要精确匹配，应由调用方在 `blocked_commands` 中指定更精确的字符串（如 `"curl "` 含空格）。此行为在文档中注明，不做过度设计。

11. **ToolPolicyService 是无状态类**：所有方法为 `@staticmethod`，不需要实例化。但保留类定义（而非纯函数）以便后续扩展（如添加缓存、策略继承等），也与项目中其他 Service 类的命名约定一致。

## 非目标（本任务不做的事）

- **不修改** `backend/app/modules/tool_gateway/service.py` — execute() 流程集成由 task-07 负责
- **不创建** ToolPolicy CRUD API — 由 task-04 负责
- **不修改** `backend/app/modules/tool_gateway/schema.py` — 由 task-08 负责
- **不修改** `backend/app/modules/tool_gateway/model.py` — 由 task-08 负责
- **不修改** `backend/app/modules/agent/model.py` — AgentRun FK 由 task-02 负责
- **不创建** 新的 Alembic 迁移 — 数据库变更由 task-01 和 task-02 负责
- **不实现** 路径校验（`validate_path`）— 已在 `service.py` 中独立实现，策略引擎不重复
- **不实现** 全局命令黑名单（`validate_shell_command` / `SHELL_BLOCKED_PATTERNS`）— 已在 `service.py` 中独立实现
- **不实现** handler 方法（`_handle_run_tests` / `_handle_http_get`）— 由 task-05、task-06 负责
- **不实现** `_load_policy()` 方法（从 DB 加载策略）— 由 task-07 负责
- **不实现** 审计双写 — 由 task-07 负责

## 参考

- **ToolPolicy 模型**：`backend/app/modules/tool_gateway/tool_policy.py`（task-01 产出）— 模型字段定义和 `default_policy()` 工厂
- **design.md AD-2**：`/Users/qinyi/SillyHub/.sillyspec/changes/2026-05-30-tool-gateway/design.md` — Handler + Policy 分层决策
- **requirements.md**：FR-03~FR-06 — 策略校验需求（工具白名单、路径限制、命令黑名单、资源限制）和 FR-08（域名白名单 + SSRF 防护）
- **现有校验函数**：`backend/app/modules/tool_gateway/service.py` — `validate_path`（68-100 行）、`validate_shell_command`（103-111 行）、`SHELL_BLOCKED_PATTERNS`（35-50 行）
- **AppError 基类**：`backend/app/core/errors.py` — 自定义错误类命名和 code 命名规范
- **ipaddress 模块**：Python 标准库 — `ipaddress.ip_address()` + `ipaddress.IPv4Network` 用于 IP 范围检查
- **urlparse**：Python 标准库 `urllib.parse` — URL 解析提取 hostname

## TDD 步骤

### 测试文件：`backend/tests/modules/tool_gateway/test_tool_policy_service.py`

1. **写测试**（先写以下测试用例，确认全部失败）：

   ```python
   # === 工具白名单 ===

   def test_check_tool_allowed():
       """allowed_tools=["file_read", "shell_exec"], tool_type="file_read" → 通过"""

   def test_check_tool_blocked():
       """allowed_tools=["file_read"], tool_type="shell_exec" → 抛出 ToolOperationForbidden"""

   def test_check_tool_allowed_empty_list():
       """allowed_tools=[] → 所有 tool_type 被拒绝"""

   def test_check_tool_all_tools_default():
       """default_policy() 允许全部 7 种工具"""

   # === 命令黑名单 ===

   def test_check_command_not_blocked():
       """blocked_commands=["curl", "wget"], command="echo" → 通过"""

   def test_check_command_blocked():
       """blocked_commands=["curl", "wget"], command="curl" → 抛出 ToolOperationForbidden"""

   def test_check_command_blocked_in_args():
       """blocked_commands=["sudo"], command="", args=["sudo", "rm"] → 抛出（combined="sudo rm"）"""

   def test_check_command_empty_blocked_list():
       """blocked_commands=[], command="anything" → 通过"""

   def test_check_command_only_for_shell_exec_and_run_tests():
       """tool_type="file_read" 时, blocked_commands=["echo"], command="echo" → 通过（不做命令校验）"""

   # === 域名白名单 ===

   def test_check_domain_allowed():
       """allowed_domains=["api.github.com"], url="https://api.github.com/repos" → 通过"""

   def test_check_domain_not_allowed():
       """allowed_domains=["pypi.org"], url="https://evil.com/api" → 抛出 ToolOperationForbidden"""

   def test_check_domain_empty_allowed_allows_all():
       """allowed_domains=[], url="https://any-domain.com" → 通过（SSRF 校验除外）"""

   def test_check_domain_malformed_url():
       """url="not-a-url" → 域名提取为空, allowed_domains 非空时拒绝"""

   # === SSRF 防护 ===

   def test_ssrf_private_ip_10_x():
       """url="http://10.0.0.1/secret" → 抛出 ToolOperationForbidden（10.x 私有地址）"""

   def test_ssrf_private_ip_192_168():
       """url="http://192.168.1.1/admin" → 抛出 ToolOperationForbidden"""

   def test_ssrf_private_ip_127_x():
       """url="http://127.0.0.1:8080/internal" → 抛出 ToolOperationForbidden"""

   def test_ssrf_localhost_hostname():
       """url="http://localhost:8080/" → 抛出（localhost 解析为 127.0.0.1）"""

   def test_ssrf_public_ip_allowed():
       """url="https://api.github.com/repos" → 通过（公网 IP，域名在白名单中）"""

   # === 资源限制 ===

   def test_apply_limits_caps_timeout():
       """max_timeout=5, params.timeout=60 → effective_timeout=5"""

   def test_apply_limits_no_cap_when_within_limit():
       """max_timeout=60, params.timeout=30 → effective_timeout=30"""

   def test_apply_limits_default_timeout():
       """params 无 timeout 字段, default_timeout=30, max_timeout=120 → effective_timeout=30"""

   def test_apply_limits_max_output_size():
       """max_output_size=32000 → PolicyLimits.max_output_size=32000"""

   def test_apply_limits_does_not_modify_params():
       """apply_limits 后 params dict 内容不变"""

   # === 集成 check + apply_limits ===

   def test_check_full_workflow_pass():
       """policy 允许 shell_exec, 无 blocked_commands → check() 通过"""

   def test_check_full_workflow_reject():
       """policy 不允许 shell_exec → check() 抛出"""

   def test_check_http_get_with_domain_and_ssrf():
       """allowed_domains=["api.github.com"], url="https://api.github.com" → 通过"""

   def test_check_http_get_ssrf_blocked_even_if_domain_allowed():
       """allowed_domains=["internal.corp"], url="http://10.0.0.1/" → SSRF 拒绝优先"""

   # === default_policy 兼容性 ===

   def test_default_policy_passes_all_checks():
       """default_policy() 允许所有 7 种工具, 无命令黑名单, 无域名限制"""
   ```

2. **确认失败** — `pytest tests/modules/tool_gateway/test_tool_policy_service.py` 全红（因为 `ToolPolicyService` 类尚不存在）

3. **写代码** — 在 `tool_policy.py` 末尾追加 `ToolPolicyService`、`PolicyLimits`、`_extract_domain`

4. **确认通过** — `pytest tests/modules/tool_gateway/test_tool_policy_service.py` 全绿

5. **回归** — `pytest` 全套无回归（当前 648+ tests passed）

### SSRF 测试 Mock 策略

SSRF 测试涉及 DNS 解析，需要 mock `socket.getaddrinfo`：

```python
from unittest.mock import patch

def test_ssrf_private_ip_10_x():
    policy = _make_policy(allowed_domains=["internal.corp"])
    # mock DNS 解析返回 10.0.0.1
    with patch("socket.getaddrinfo", return_value=[
        (2, 1, 6, "", ("10.0.0.1", 0)),
    ]):
        with pytest.raises(ToolOperationForbidden, match="SSRF"):
            ToolPolicyService.check(policy, "http_get", {"url": "http://10.0.0.1/"})
```

对于不需要 DNS 的测试（如工具白名单、命令黑名单），不涉及 `_check_domain_allowed`，无需 mock。

对于公网 IP 的测试，mock `socket.getaddrinfo` 返回公网 IP（如 `93.184.216.34`）。

### 测试辅助函数

```python
def _make_policy(
    allowed_tools: list[str] | None = None,
    blocked_commands: list[str] | None = None,
    allowed_domains: list[str] | None = None,
    max_timeout: int = 30,
    max_output_size: int = 64000,
) -> ToolPolicy:
    """Create a non-persisted ToolPolicy for testing."""
    return ToolPolicy(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        name="test-policy",
        allowed_tools=allowed_tools if allowed_tools is not None else list(ALL_TOOLS),
        blocked_commands=blocked_commands if blocked_commands is not None else [],
        allowed_paths=["."],
        allowed_domains=allowed_domains if allowed_domains is not None else [],
        max_timeout=max_timeout,
        max_output_size=max_output_size,
    )
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---------|---------|
| AC-01 | `tool_policy.py` 中 `ToolPolicyService` 类存在 | 类定义存在，包含 `check`、`apply_limits` 两个 static method |
| AC-02 | `tool_policy.py` 中 `PolicyLimits` dataclass 存在 | `frozen=True`，包含 `effective_timeout: int` 和 `max_output_size: int` |
| AC-03 | `tool_policy.py` 中 `_extract_domain()` 函数存在 | 输入 URL 字符串返回 hostname，异常返回空字符串 |
| AC-04 | `ToolPolicyService.check()` 工具白名单校验生效 | tool_type 不在 allowed_tools 时抛出 `ToolOperationForbidden`，在白名单时通过 |
| AC-05 | `ToolPolicyService.check()` 命令黑名单校验生效 | 仅对 shell_exec/run_tests 生效，combined 包含 blocked_commands 中任一项时抛出 |
| AC-06 | `ToolPolicyService.check()` 域名白名单校验生效 | 仅对 http_get 生效，allowed_domains 非空且域名不在白名单时抛出 |
| AC-07 | `ToolPolicyService.check()` SSRF 防护生效 | 域名解析为内网 IP（10.x/172.16-31.x/192.168.x/127.x）时抛出，即使域名在白名单中 |
| AC-08 | `ToolPolicyService.apply_limits()` 正确裁剪 timeout | `effective_timeout = min(params.timeout, policy.max_timeout)` |
| AC-09 | `ToolPolicyService.apply_limits()` 返回 max_output_size | `PolicyLimits.max_output_size == policy.max_output_size` |
| AC-10 | `ToolPolicyService.apply_limits()` 不修改 params | 调用前后 params dict 内容一致（无副作用） |
| AC-11 | 默认策略全部通过 | `default_policy()` 对所有 7 种 tool_type 的 `check()` 不抛异常 |
| AC-12 | allowed_tools=[] 拒绝所有工具 | 空 allowed_tools 时任何 tool_type 都抛出 `ToolOperationForbidden` |
| AC-13 | allowed_domains=[] 允许所有域名 | 空 allowed_domains 时域名白名单不校验（SSRF 仍然校验） |
| AC-14 | `_PRIVATE_NETWORKS` 覆盖关键内网范围 | 包含 10.0.0.0/8、172.16.0.0/12、192.168.0.0/16、127.0.0.0/8、169.254.0.0/16 |
| AC-15 | DNS 解析失败时安全拒绝 | `socket.gaierror` 时抛出 `ToolOperationForbidden`（安全优先） |
| AC-16 | 测试文件存在且包含 ≥25 个测试 | `test_tool_policy_service.py` 存在，所有测试通过 |
| AC-17 | 全量回归无失败 | `pytest` 全套通过，无新增失败/错误 |
| AC-18 | 不引入新的 DB 依赖 | `ToolPolicyService` 所有方法为 static，不需要 session/DB 连接 |
