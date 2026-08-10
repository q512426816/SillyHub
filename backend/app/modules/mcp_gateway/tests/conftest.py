"""mcp_gateway 测试专用 fixture。

webhook 注册（``McpWebhookService.create``）经 ``assert_public_url`` 做 SSRF 校验
（design B2），其底层 ``assert_public_hostname`` 走 ``socket.getaddrinfo`` 解析域名。
离线测试环境解析任何公网域名都失败 → safe-side 抛 SsrfBlocked，会让所有用
``hooks.example.com`` 等公网域名的 webhook CRUD/投递测试在 create() 阶段误判。

对齐 ``llm_provider/tests/test_fetch_models.py`` 的做法：autouse patch getaddrinfo。

智能替身（保留 SSRF 拒绝语义，不依赖 DNS）：

- 主机名 → 返公网 IP（``93.184.216.34``），放行公网域名用例。
- IP 字面量（IPv4/IPv6）→ 透传真实 ``getaddrinfo``（离线本地解析，不联网），
  故 ``127.0.0.1`` / ``::1`` / ``169.254.169.254`` 等私网 IP 仍被真实
  ``_ip_is_private`` 判定拒绝（``test_webhook_ssrf`` 的拒绝用例可正常断言）。
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Iterator

import pytest

# example.com 真实公网 IPv4（仅测试替身用，离线放行公网域名）。
_PUBLIC_ADDRINFO = (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))
_real_getaddrinfo = socket.getaddrinfo


def _hermetic_getaddrinfo(host, *args, **kwargs):
    try:
        ipaddress.ip_address(host.split("%", 1)[0])
    except (ValueError, TypeError):
        # 主机名 → 公网放行。
        return [_PUBLIC_ADDRINFO]
    # IP 字面量 → 真实 getaddrinfo（离线本地解析，保留私网拒绝）。
    return _real_getaddrinfo(host, *args, **kwargs)


@pytest.fixture(autouse=True)
def _hermetic_dns(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setattr(
        "app.modules.tool_gateway.tool_policy.socket.getaddrinfo",
        _hermetic_getaddrinfo,
    )
    yield
