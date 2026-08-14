"""git_identity 入口 DTO 校验测试（security-audit-remediation task-10 / FR-11）。

覆盖 ``GitIdentityCreate`` 的 ``git_username`` / ``git_email`` pattern 校验：
  - git_username 含换行 / 回车 → 422（gitconfig 换行注入主阻断面）；
  - git_username 含 ``[`` / ``]`` → 422（伪造 gitconfig 段头）；
  - git_username 含其它控制字符（如 ``\x00``）→ 422；
  - git_username 超长（>64）→ 422；
  - git_email 含换行 / 非 email 格式 → 422；
  - 合法值（``testuser``、``A.B-C dev``、``a.b@example.com``）回归通过。

校验只加在 GitIdentityCreate（入口），GitIdentityRead（出参）不动——存量
历史数据读取不受影响。
"""

from __future__ import annotations

from httpx import AsyncClient

_CREATE_URL = "/api/git/identities"

_VALID_BASE = {
    "provider": "github",
    "credential_type": "pat",
    "credential": "ghp_testsecret123",
}


async def _create(client: AsyncClient, headers: dict[str, str], payload: dict) -> int:
    resp = await client.post(_CREATE_URL, json=payload, headers=headers)
    return resp.status_code


async def test_username_with_newline_rejected(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """git_username 含 \\n（注入新 gitconfig 行/段）→ 422。"""
    status = await _create(
        client,
        auth_headers,
        {**_VALID_BASE, "git_username": "octocat\n[credential]\thelper = !rm -rf /"},
    )
    assert status == 422


async def test_username_with_carriage_return_rejected(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """git_username 含 \\r → 422。"""
    status = await _create(client, auth_headers, {**_VALID_BASE, "git_username": "octocat\r\nx"})
    assert status == 422


async def test_username_with_brackets_rejected(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """git_username 含 [ / ]（伪造 gitconfig 段头语法）→ 422。"""
    for bad in ("[user]", "octo[cat", "octo]cat"):
        status = await _create(client, auth_headers, {**_VALID_BASE, "git_username": bad})
        assert status == 422, f"username {bad!r} should be rejected"


async def test_username_with_control_char_rejected(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """git_username 含其它控制字符（NUL / ESC / TAB）→ 422。"""
    for bad in ("octo\x00cat", "octo\x1bcat", "octo\tcat"):
        status = await _create(client, auth_headers, {**_VALID_BASE, "git_username": bad})
        assert status == 422, f"username with ctrl char {bad!r} should be rejected"


async def test_username_too_long_rejected(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """git_username 超 64 字符 → 422。"""
    status = await _create(client, auth_headers, {**_VALID_BASE, "git_username": "a" * 65})
    assert status == 422


async def test_email_with_newline_rejected(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """git_email 含换行 → 422。"""
    status = await _create(
        client,
        auth_headers,
        {**_VALID_BASE, "git_email": "a@example.com\n[core]\tfsmonitor = false"},
    )
    assert status == 422


async def test_email_invalid_format_rejected(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """git_email 非 email 格式（无 @ / 空串 / 纯本地部分）→ 422。"""
    for bad in ("not-an-email", "", "local@", "@example.com", "a b@example.com"):
        status = await _create(client, auth_headers, {**_VALID_BASE, "git_email": bad})
        assert status == 422, f"email {bad!r} should be rejected"


async def test_valid_username_and_email_accepted(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """合法值回归：字母数字 + 点/横线/下划线/空格的用户名、标准 email → 201。"""
    for good_username in ("testuser", "A.B-C_dev", "Ada Lovelace", "dev."):
        resp = await client.post(
            _CREATE_URL,
            json={**_VALID_BASE, "git_username": good_username, "git_email": "a.b@example.com"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, f"username {good_username!r} should pass: {resp.text}"


async def test_optional_fields_still_nullable(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """git_username / git_email 可缺省（None）——校验不强制必填。"""
    resp = await client.post(_CREATE_URL, json={**_VALID_BASE}, headers=auth_headers)
    assert resp.status_code == 201, resp.text
