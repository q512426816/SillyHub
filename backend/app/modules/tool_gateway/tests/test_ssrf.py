"""http_get SSRF 逐跳复查（design §5 B4 / D-005 / R-04）。

覆盖：
- assert_public_url 单元：scheme 白名单（UnsafeRepoUrl）+ IPv4/IPv6 私网拒绝（SsrfBlocked）；
- _handle_http_get 直接请求云元数据 / loopback / IPv6 私网 → SSRF blocked；
- _handle_http_get 重定向到私网（302→127.0.0.1）被逐跳复查拦下（D-005 核心缺口）；
- 公网正常请求 + 重定向链（≤3 跳）放行。

IP 字面量经真实 ``getaddrinfo`` 离线本地解析（不联网），故拒绝用例 hermetic。
"""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from app.core.ssrf import UnsafeRepoUrl, assert_public_url
from app.modules.tool_gateway.service import ToolGatewayService
from app.modules.tool_gateway.tool_policy import SsrfBlocked

# ── assert_public_url 单元 ─────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "ftp://files.example.com/data",
        "gopher://host/x",
        "file:///etc/passwd",
        "no-scheme-host",  # urlparse 出 scheme=""
    ],
)
async def test_assert_public_url_rejects_bad_scheme(url: str):
    with pytest.raises(UnsafeRepoUrl):
        await assert_public_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/x",
        "http://10.0.0.1/x",
        "http://192.168.1.1/x",
        "http://172.16.0.1/x",
        "http://169.254.169.254/latest/meta-data/",  # 云元数据
        "http://[::1]/x",  # IPv6 loopback
        "http://[fc00::1]/x",  # IPv6 ULA
        "http://[fe80::1]/x",  # IPv6 link-local
    ],
)
async def test_assert_public_url_rejects_private_ips(url: str):
    with pytest.raises(SsrfBlocked):
        await assert_public_url(url)


async def test_assert_public_url_allows_public_ip_literal():
    """公网 IP 字面量放行（离线 getaddrinfo 本地解析，无 DNS）。"""
    await assert_public_url("http://8.8.8.8/health")  # 不抛


# ── _handle_http_get 集成（httpx MockTransport）─────────────────────────────


def _patch_http_client(monkeypatch: pytest.MonkeyPatch, handler) -> None:
    """把 _handle_http_get 用的 httpx.AsyncClient 注入 MockTransport（hermetic）。"""
    transport = httpx.MockTransport(handler)

    class _Client(httpx.AsyncClient):
        # 直接继承 httpx.AsyncClient：class 定义在下方 monkeypatch.setattr 之前求值，
        # 此时 httpx.AsyncClient 仍是原始类，_Client.__bases__=(原始 AsyncClient,)。
        # 不用 real_client 变量中转——mypy 不接受非 Final 变量作基类（Invalid base class）。
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", _Client)


def _svc() -> ToolGatewayService:
    return ToolGatewayService.__new__(ToolGatewayService)


async def test_http_get_blocks_cloud_metadata(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    def handler(request: httpx.Request):  # 不应到达
        return httpx.Response(200, text="META")

    _patch_http_client(monkeypatch, handler)
    result = await _svc()._handle_http_get(
        {"url": "http://169.254.169.254/latest/meta-data/iam/"}, tmp_path
    )
    assert result["result_code"] == 1
    assert "SSRF blocked" in result["output"]


async def test_http_get_blocks_redirect_to_private(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """公网入口 302 跳到 127.0.0.1：逐跳复查拦下第二跳（D-005 重定向绕过缺口）。"""

    def handler(request: httpx.Request):
        if str(request.url).startswith("http://8.8.8.8/"):
            return httpx.Response(302, headers={"location": "http://127.0.0.1/secret"})
        return httpx.Response(200, text="LEAK")  # 私网目标不应到达

    _patch_http_client(monkeypatch, handler)
    result = await _svc()._handle_http_get({"url": "http://8.8.8.8/start"}, tmp_path)
    assert result["result_code"] == 1
    assert "SSRF blocked" in result["output"]


async def test_http_get_blocks_ipv6_loopback(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    _patch_http_client(monkeypatch, lambda r: httpx.Response(200, text="x"))
    result = await _svc()._handle_http_get({"url": "http://[::1]/"}, tmp_path)
    assert result["result_code"] == 1
    assert "SSRF blocked" in result["output"]


async def test_http_get_allows_public_and_returns_status(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    _patch_http_client(monkeypatch, lambda r: httpx.Response(200, text="ok"))
    result = await _svc()._handle_http_get({"url": "http://8.8.8.8/health"}, tmp_path)
    assert result["result_code"] == 200
    assert "ok" in result["output"]


async def test_http_get_follows_safe_redirect_chain(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """公网→公网重定向链（≤3 跳）放行，取最终响应。"""

    def handler(request: httpx.Request):
        if request.url.path == "/a":
            return httpx.Response(302, headers={"location": "http://8.8.8.8/b"})
        return httpx.Response(200, text="final")

    _patch_http_client(monkeypatch, handler)
    result = await _svc()._handle_http_get({"url": "http://8.8.8.8/a"}, tmp_path)
    assert result["result_code"] == 200
    assert "final" in result["output"]
