"""SSRF 统一入口（façade）。

三个「让后端替用户发外部请求」的入口（mcp webhook 回调 / worktree git clone /
http_get 工具）经此校验，复用 ``tool_gateway.tool_policy`` 已落地的 IP 原语
（``assert_public_hostname``：IPv4+IPv6+``asyncio.to_thread`` 防 DNS 阻塞），
不重复造轮子（design D-003）。

- :func:`assert_public_url`：全量校验（scheme 白名单 + host 解析到公网）。
- :func:`assert_safe_repo_url`：git 仓库 URL 协议白名单（不查 IP，允许内网 git）。

把 IP 原语整体从 tool_policy 搬到 core 是 follow-up（design §11 / R-02），本 change
控范围，仅做 façade 复用。
"""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import status

from app.core.errors import AppError
from app.modules.tool_gateway.tool_policy import SsrfBlocked, ToolPolicyService

__all__ = ["SsrfBlocked", "UnsafeRepoUrl", "assert_public_url", "assert_safe_repo_url"]


class UnsafeRepoUrl(AppError):
    """URL 协议 / 形态不安全（非 scheme 白名单、危险 git 形态）。HTTP 400。"""

    code = "HTTP_400_UNSAFE_REPO_URL"
    http_status = status.HTTP_400_BAD_REQUEST


async def assert_public_url(
    url: str, *, allowed_schemes: tuple[str, ...] = ("http", "https")
) -> None:
    """全量 SSRF 校验：scheme 白名单 + 解析 host + ``assert_public_hostname``（IPv4+IPv6）。

    - 非法 scheme（不在 ``allowed_schemes``）→ :class:`UnsafeRepoUrl`（400）。
    - host 为空 / 不可解析 / 解析到私网或保留地址 → :class:`SsrfBlocked`（400，
      由 :meth:`ToolPolicyService.assert_public_hostname` 抛出）。

    用于「后端替用户发 HTTP 请求」的入口（mcp webhook 注册/投递、http_get 每跳复查）。
    每次调用都重新解析域名，防止注册后 DNS 重绑定 / 解析变更绕过。
    """
    parsed = urlparse(url)
    if parsed.scheme not in allowed_schemes:
        raise UnsafeRepoUrl(
            f"Unsupported URL scheme: {parsed.scheme!r}",
            details={"url": url, "scheme": parsed.scheme},
        )
    # 空 host / 不可解析 / 私网或保留地址 → SsrfBlocked（assert_public_hostname 内部抛）。
    await ToolPolicyService.assert_public_hostname(parsed.hostname)


def assert_safe_repo_url(repo_url: str) -> None:
    """git 仓库 URL 协议白名单（同步、不查 IP，允许内网 git）。

    放行正常 git 远端三类形态（design D-004 / R-03）：

    - 含 ``://``：``urlparse`` 出的 scheme ∈ {https, ssh, git} 放行
      （``ssh://host:port/path``、``git://host/path`` 均放行；``file://`` / 其它 → 拒）。
    - scp-like（无 ``://``、含 ``:`` 且首个 ``:`` 前无 ``/``，如
      ``git@host:path`` / ``host:path``）→ 放行。
    - 其余（裸路径 ``/abs``、``./rel``、``..``、空）→ 拒（git 会视同本地路径，等同 file）。

    绝对拒绝：

    - ``ext::`` 前缀（git remote helper，容器内 RCE）。
    - Windows 盘符 ``C:\\...``（首个 ``:`` 前是单字母盘符 → 本地路径，拒）。

    Raises:
        UnsafeRepoUrl: 协议 / 形态不在白名单。
    """
    if repo_url.startswith("ext::"):
        raise UnsafeRepoUrl(
            "git 'ext::' remote helper is forbidden (RCE risk).",
            details={"repo_url": repo_url},
        )

    if "://" in repo_url:
        scheme = urlparse(repo_url).scheme.lower()
        if scheme in {"https", "ssh", "git"}:
            return
        raise UnsafeRepoUrl(
            f"Unsupported git URL scheme: {scheme!r}",
            details={"repo_url": repo_url, "scheme": scheme},
        )

    # scp-like：host:path（无 '://'，含 ':'，且首个 ':' 前无 '/'）。
    colon = repo_url.find(":")
    slash = repo_url.find("/")
    if colon != -1 and (slash == -1 or colon < slash):
        host_part = repo_url[:colon]
        # Windows 盘符（C:\... / C:/...）：host 段长度 1 且是字母 → 本地路径，拒。
        if len(host_part) == 1 and host_part.isalpha():
            raise UnsafeRepoUrl(
                "Local filesystem path is not a valid git remote (file:// forbidden).",
                details={"repo_url": repo_url},
            )
        return

    raise UnsafeRepoUrl(
        "Bare path or unsupported git URL form (use https://, ssh://, git:// or git@host:path).",
        details={"repo_url": repo_url},
    )
