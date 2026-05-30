---
id: task-06
title: http_get handler 实现
priority: P0
estimated_hours: 3
depends_on: [task-03]
blocks: [task-07, task-08]
allowed_paths:
  - backend/app/modules/tool_gateway/service.py
  - backend/app/modules/tool_gateway/tests/test_http_get.py
---

# task-06: http_get handler 实现

## 修改文件（必填）

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/app/modules/tool_gateway/service.py` | 修改 | 新增 `validate_url_domain()`、`_is_private_ip()`、`_handle_http_get()` |
| `backend/app/modules/tool_gateway/tests/test_http_get.py` | 新增 | http_get handler 单元测试 |

## 实现要求

在 `ToolGatewayService` 中实现 `http_get` 工具 handler，完成以下功能：

1. **域名白名单校验**：从 params 中提取 URL 的 hostname，校验是否在 `allowed_domains` 列表中（精确匹配）
2. **SSRF 防护**：对 URL 解析后的 IP 地址进行内网地址检测（RFC 1918 + loopback + link-local），拒绝访问内网 IP
3. **HTTP GET 执行**：使用 `httpx.AsyncClient` 发起 GET 请求，支持自定义 headers 和 timeout
4. **输出截断**：响应体通过 `redact_output()` 处理后截断到 `max_output_size`
5. **超时控制**：timeout 取 `min(params.timeout, max_timeout)`，默认 10s
6. **注册到 dispatch**：在 `TOOL_TYPES` 和 `_dispatch` handlers dict 中注册 `http_get`

## 接口定义（代码类任务必填）

### 新增顶层常量

```python
# backend/app/modules/tool_gateway/service.py 顶部新增

import ipaddress
from urllib.parse import urlparse

import httpx

HTTP_GET_DEFAULT_TIMEOUT = 10
```

### 新增顶层函数：validate_url_domain

```python
def validate_url_domain(url: str, allowed_domains: list[str]) -> str:
    """校验 URL 的域名是否在白名单中，返回解析后的 hostname。

    Args:
        url: 完整 URL，如 "https://api.github.com/repos/..."
        allowed_domains: 允许的域名列表，如 ["api.github.com", "pypi.org"]

    Returns:
        解析后的 hostname（小写）

    Raises:
        ToolOperationForbidden: URL 格式无效 / 域名不在白名单
    """
    # 伪代码:
    # 1. urlparse(url) 提取 hostname
    # 2. hostname 为空 → raise ToolOperationForbidden("Invalid URL: no hostname")
    # 3. hostname 不在 allowed_domains → raise ToolOperationForbidden("Domain not in allowed_domains")
    # 4. return hostname
```

### 新增顶层函数：_is_private_ip

```python
def _is_private_ip(hostname: str) -> bool:
    """检测 hostname 是否解析到内网 IP 地址。

    Args:
        hostname: 已校验通过的域名

    Returns:
        True 表示是内网 IP（应拒绝），False 表示是公网 IP

    安全说明：
        通过 socket.getaddrinfo 解析域名得到 IP 列表，
        逐个检查是否属于 RFC 1918 私网段 / loopback / link-local / 保留地址。
        注意：需要同时检查 IPv4 和 IPv6 结果。
    """
    # 伪代码:
    # 1. try: socket.getaddrinfo(hostname, None) 获取所有 IP
    # 2. 对每个 IP:
    #    a. ipaddress.ip_address(addr)
    #    b. 若 addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved → return True
    # 3. 解析失败或无结果 → return True（安全默认拒绝）
    # 4. 全部通过 → return False
```

### 新增 handler 方法：_handle_http_get

```python
async def _handle_http_get(
    self,
    params: dict,
    lease_root: Path,        # 未使用，保持签名一致性
    allowed_paths: list[str], # 未使用
    *,
    allowed_domains: list[str] = [],
    max_timeout: int = DEFAULT_TIMEOUT,
    max_output_size: int = MAX_OUTPUT_SIZE,
) -> dict:
    """执行 HTTP GET 请求。

    控制流：
    1. 提取 params["url"]，为空则返回 {"result_code": 1, "output": "Missing url."}
    2. 提取 params["headers"]，默认空 dict
    3. 提取 params["timeout"]，默认 HTTP_GET_DEFAULT_TIMEOUT
    4. 调用 validate_url_domain(url, allowed_domains) → 不通过则抛出 ToolOperationForbidden
    5. 调用 _is_private_ip(hostname) → True 则抛出 ToolOperationForbidden("SSRF protection: target resolves to private IP")
    6. effective_timeout = min(timeout, max_timeout)
    7. async with httpx.AsyncClient(timeout=effective_timeout) as client:
         response = await client.get(url, headers=headers)
    8. raw_output = response.text
    9. safe_output = redact_output(raw_output)
    10. 截断: if len(safe_output) > max_output_size → safe_output = safe_output[:max_output_size] + "\\n...[truncated]"
    11. return {"result_code": 0, "output": safe_output}
    12. httpx.TimeoutException → return {"result_code": -1, "output": f"HTTP request timed out after {effective_timeout}s."}
    13. httpx.HTTPError as e → return {"result_code": 1, "output": f"HTTP error: {e}"}
    """
```

### 修改 TOOL_TYPES 常量

```python
# service.py 第 28-30 行，在现有基础上添加
TOOL_TYPES = frozenset({
    "file_read", "file_write", "file_list", "file_search", "shell_exec",
    "http_get",
})
```

### 修改 _dispatch 方法

```python
# service.py _dispatch 方法中，handlers dict 添加:
"http_get": self._handle_http_get,

# _dispatch 调用逻辑需适配 http_get 需要额外参数的情况：
# http_get handler 需要 allowed_domains/max_timeout/max_output_size，
# 这些参数在 task-07（集成流程）中通过 policy 对象传入。
# 本 task 中，_dispatch 先用占位方式传递：
#   - allowed_domains 从 params 中不取（由 execute 传入，当前先传空列表）
#   - max_timeout 使用 DEFAULT_TIMEOUT
#   - max_output_size 使用 MAX_OUTPUT_SIZE
```

**重要说明**：本 task 只实现 handler 本身的逻辑。policy check 的调用编排（在 execute 中获取 policy、提取 allowed_domains 等）属于 task-07。本 task 中 `_dispatch` 需要注册 `"http_get"` 到 handlers dict，并在调用时传递 `allowed_domains=[]` 作为占位。task-07 会重构 `_dispatch` 签名来接收 policy 对象。

### 新增 import

```python
import ipaddress
import socket
from urllib.parse import urlparse

import httpx
```

## 边界处理（必填）

1. **URL 为空或缺失**：params 中无 `url` 字段 → 返回 `{"result_code": 1, "output": "Missing url."}`，不抛异常
2. **URL 格式无效**（如 `not-a-url`）：`urlparse` 无法提取 hostname → 抛出 `ToolOperationForbidden("Invalid URL: no hostname", details={"url": url})`
3. **域名不在白名单**：`allowed_domains` 为空列表时，所有请求均被拒绝 → 抛出 `ToolOperationForbidden("Domain not in allowed_domains", details={"domain": hostname, "allowed_domains": allowed_domains})`
4. **SSRF 防护 — DNS 解析失败**：`socket.getaddrinfo` 抛异常 → `_is_private_ip` 返回 `True`（安全默认拒绝）
5. **SSRF 防护 — 多 IP 解析**：域名解析出多个 IP，只要任一个是内网 IP → 拒绝整个请求
6. **超时控制**：params.timeout 缺失时默认 `HTTP_GET_DEFAULT_TIMEOUT=10`；params.timeout > max_timeout 时截断到 max_timeout
7. **headers 为空**：params 中无 `headers` 字段 → 默认 `{}`
8. **HTTP 错误（4xx/5xx）**：不是异常，正常返回 `result_code=0` + response body。只有网络级错误（连接失败、DNS 失败等 httpx.HTTPError）才走异常分支
9. **响应体超大**：先经过 `redact_output()` 处理（内部已截断到 MAX_OUTPUT_SIZE），再按 max_output_size 二次截断
10. **DNS Rebinding 防护**：域名白名单校验和 IP 检查在同一次调用中完成，先校验域名白名单，再做 IP 解析检查，防止 TOCTOU

## 非目标（本任务不做的事）

- **不实现** policy 集成到 `execute()` 流程（task-07 负责）
- **不修改** `schema.py` 添加 `http_get` 到 Literal 类型（task-08 负责）
- **不实现** 审计双写逻辑（task-07 负责）
- **不实现** POST/PUT/DELETE 等 HTTP 方法，仅 GET
- **不实现** request body / form data 发送
- **不实现** 跟随重定向控制（使用 httpx 默认行为，跟随重定向）
- **不实现** 响应头的过滤或透传，仅返回响应体
- **不处理** 旧 API 兼容问题（本项目未上线，无需兼容）

## 参考

- **handler 模式**：参照 `_handle_shell_exec` 的结构 — 参数提取 → 校验 → 执行 → 异常处理 → 返回 dict
- **校验函数模式**：参照 `validate_path()` / `validate_shell_command()` — 独立顶层函数，抛出 `ToolOperationForbidden`
- **redact_output**：`app.modules.git_gateway.service.redact_output` — 脱敏 + 截断
- **SSRF 防护**：Python 标准库 `ipaddress.ip_address()` 的 `.is_private` / `.is_loopback` / `.is_link_local` / `.is_reserved` 属性
- **HTTP 客户端**：使用 `httpx.AsyncClient`（项目已有 httpx 依赖，若无则需 pip install httpx）

## TDD 步骤

### 第一步：编写测试（tests/test_http_get.py）

```python
"""Unit tests for http_get handler in ToolGatewayService."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from app.modules.tool_gateway.service import (
    ToolGatewayService,
    validate_url_domain,
    _is_private_ip,
    ToolOperationForbidden,
)
```

测试用例清单：

| # | 测试名 | 输入 | 预期结果 |
|---|--------|------|----------|
| T01 | `test_validate_url_domain_allowed` | url="https://api.github.com/repos", allowed_domains=["api.github.com"] | 返回 "api.github.com" |
| T02 | `test_validate_url_domain_blocked` | url="https://evil.com/x", allowed_domains=["api.github.com"] | 抛出 ToolOperationForbidden |
| T03 | `test_validate_url_domain_empty_hostname` | url="not-a-url", allowed_domains=[] | 抛出 ToolOperationForbidden |
| T04 | `test_validate_url_domain_empty_allowed` | url="https://api.github.com/x", allowed_domains=[] | 抛出 ToolOperationForbidden |
| T05 | `test_is_private_ip_loopback` | hostname="127.0.0.1" | 返回 True |
| T06 | `test_is_private_ip_rfc1918` | hostname="10.0.0.1" | 返回 True |
| T07 | `test_is_private_ip_192_168` | hostname="192.168.1.1" | 返回 True |
| T08 | `test_is_private_ip_172_16` | hostname="172.16.0.1" | 返回 True |
| T09 | `test_is_private_ip_public` | hostname="93.184.216.34" (example.com) | 返回 False（mock DNS） |
| T10 | `test_is_private_ip_dns_failure` | hostname="unresolvable.invalid" | 返回 True（安全默认） |
| T11 | `test_handle_http_get_success` | mock httpx 返回 200 + "ok" | result_code=0, output 包含 "ok" |
| T12 | `test_handle_http_get_missing_url` | params={} | result_code=1, output="Missing url." |
| T13 | `test_handle_http_get_domain_not_allowed` | allowed_domains=["pypi.org"], url="https://evil.com" | 抛出 ToolOperationForbidden |
| T14 | `test_handle_http_get_ssrf_blocked` | allowed_domains=["evil.com"], url 解析到 10.0.0.1 | 抛出 ToolOperationForbidden |
| T15 | `test_handle_http_get_timeout` | mock httpx.TimeoutException | result_code=-1, output 包含 "timed out" |
| T16 | `test_handle_http_get_network_error` | mock httpx.ConnectError | result_code=1, output 包含 "HTTP error" |
| T17 | `test_handle_http_get_output_truncated` | mock 返回超大响应 | output 长度 <= max_output_size + truncation suffix |
| T18 | `test_handle_http_get_timeout_capped` | params.timeout=999, max_timeout=5 | 实际 timeout=5 |
| T19 | `test_handle_http_get_custom_headers` | params.headers={"Accept": "application/json"} | mock 验证 headers 传递 |
| T20 | `test_handle_http_get_https_enforced` | url="http://api.github.com/x"（非 https）| 正常放行（协议校验非本 task 范围，只校验域名白名单） |

### 第二步：确认测试失败

```bash
cd /Users/qinyi/SillyHub/backend && python -m pytest app/modules/tool_gateway/tests/test_http_get.py -v
# 预期：ImportError / AttributeError（handler 尚未实现）
```

### 第三步：编写实现代码

修改 `backend/app/modules/tool_gateway/service.py`：
1. 顶部新增 imports（ipaddress, socket, urlparse, httpx）
2. 新增常量 `HTTP_GET_DEFAULT_TIMEOUT = 10`
3. 实现 `validate_url_domain()` 顶层函数
4. 实现 `_is_private_ip()` 顶层函数
5. 在 `TOOL_TYPES` 中添加 `"http_get"`
6. 在 `_dispatch` 的 handlers dict 中注册 `"http_get": self._handle_http_get`
7. 实现 `_handle_http_get()` 方法
8. 适配 `_dispatch` 调用逻辑（http_get 不需要 allowed_paths，需要额外参数）

### 第四步：确认测试通过

```bash
cd /Users/qinyi/SillyHub/backend && python -m pytest app/modules/tool_gateway/tests/test_http_get.py -v
# 预期：全部 20 个测试 PASSED
```

### 第五步：回归

```bash
cd /Users/qinyi/SillyHub/backend && python -m pytest -x -q
# 预期：现有测试无回归，全部 PASSED
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | `validate_url_domain("https://api.github.com/repos", ["api.github.com"])` | 返回 `"api.github.com"` |
| AC-02 | `validate_url_domain("https://evil.com/x", ["api.github.com"])` | 抛出 `ToolOperationForbidden`，code=`TOOL_OPERATION_FORBIDDEN`，http_status=403 |
| AC-03 | `validate_url_domain("not-a-url", ["api.github.com"])` | 抛出 `ToolOperationForbidden`，message 包含 "Invalid URL" |
| AC-04 | `_is_private_ip("127.0.0.1")` | 返回 `True` |
| AC-05 | `_is_private_ip("10.0.0.1")` | 返回 `True` |
| AC-06 | `_is_private_ip("192.168.1.1")` | 返回 `True` |
| AC-07 | `_is_private_ip("172.16.0.1")` | 返回 `True` |
| AC-08 | `_is_private_ip("unresolvable.invalid")` | 返回 `True`（DNS 解析失败，安全默认拒绝） |
| AC-09 | `_is_private_ip` 对公网 IP | 返回 `False`（mock DNS 解析为公网 IP） |
| AC-10 | `_handle_http_get(params={"url": "https://api.github.com/repos"}, allowed_domains=["api.github.com"])` 正常响应 | 返回 `{"result_code": 0, "output": ...}` |
| AC-11 | `_handle_http_get(params={})` URL 缺失 | 返回 `{"result_code": 1, "output": "Missing url."}` |
| AC-12 | `_handle_http_get(params={"url": "https://evil.com"}, allowed_domains=["pypi.org"])` | 抛出 `ToolOperationForbidden`，域名不在白名单 |
| AC-13 | URL 域名在白名单但 DNS 解析为 10.0.0.1 | 抛出 `ToolOperationForbidden`，message 包含 "SSRF" |
| AC-14 | `_handle_http_get` 超时场景 | 返回 `{"result_code": -1, "output": "...timed out..."}` |
| AC-15 | `_handle_http_get` 网络错误（ConnectError） | 返回 `{"result_code": 1, "output": "HTTP error:..."}` |
| AC-16 | 响应体超过 max_output_size | output 被截断，长度 <= max_output_size + len("\\n...[truncated]") |
| AC-17 | params.timeout=999, max_timeout=5 | 实际超时 = 5s |
| AC-18 | `TOOL_TYPES` 包含 `"http_get"` | `"http_get" in TOOL_TYPES` 为 True |
| AC-19 | `_dispatch` 可路由到 `http_get` handler | handlers dict 中存在 `"http_get"` 键 |
| AC-20 | `python -m pytest app/modules/tool_gateway/tests/test_http_get.py -v` | 全部 20 个测试 PASSED |
| AC-21 | `python -m pytest -x -q` 全量回归 | 现有测试 0 failed，0 error |
