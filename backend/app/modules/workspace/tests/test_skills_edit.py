"""工作区 skills 编辑写接口（POST/DELETE skills + GET/PUT/DELETE files）测试。

2026-08-26-workspace-skill-edit task-03 / requirements FR-01/02/03/05（GWT）：
- CRUD（FR-01/02）：新建 201 + ``skills/<名>/SKILL.md`` 落盘（frontmatter
  name/description）+ 响应列表含新 skill；重名 409；非法名 422 矩阵（含
  ``/`` ``\\`` ``..`` 空格 中文 冒号 空串）；删 skill 目录整体消失；文件读
  （内容+size）/写（内容落盘 + 新建含父目录 ``scripts/x.sh``）/删（文件消失）
- 路径穿越变体矩阵（FR-03）：``../``、URL 编码变体（``..%2F``/``%2e%2e``/
  ``%2F``）、绝对路径、Windows 盘符 ``C:\\``、多层深层路径、空路径 → 全部
  422 且 specDir 树前后快照一致（磁盘零接触）。注意 httpx 会对 URL 里的
  裸 ``..`` 段做规范化折叠，穿越用例一律用编码变体送达（真实攻击面）。
- 约束（FR-03）：二进制文件读 415（预置 ``\\xff\\xfe`` 字节）；>512KB 读/写
  两向 413（写向传 513KB content 且不落盘）；恰好 512KB 双向放行（边界）
- 入口保护：SKILL.md 删除 409 HTTP_409_SKILL_ENTRY_PROTECTED
- 审计（FR-05）：四类写操作各落行（workspace_skill.create/delete/
  update_file/delete_file），details_json 含 skill 名/文件路径、不含文件内容
- 权限：非成员 / 只读成员写 → 403（错误 message 中文断言）；只读成员读 200
- symlink 防护：skill 目录内符号链接条目 → delete_skill 422 拒绝且目录原样
  （Windows 无特权创建 symlink 时按 test_sync_incremental.py 先例 skip）

fixture 构造沿用 test_mcp_config_write.py 的直插模式（workspace / spec_ws 行
直接插入，specDir 用 tmp_path 建真实目录），不 mock 被测端点与 service，
断言真实 HTTP 响应与磁盘副作用。
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workflow.model import AuditLog
from app.modules.workspace.model import Workspace

_LIMIT = 512 * 1024
"""单文件读/写大小上限（与实现 _SKILL_MAX_FILE_BYTES 对齐，512KB）。"""

# ── helpers（沿用 test_mcp_config_write.py 的直插模式）──────────────────────


async def _create_user(
    session: AsyncSession,
    *,
    is_platform_admin: bool = False,
    email: str | None = None,
) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=email or f"user-{uid}@example.com",
        password_hash="irrelevant",
        display_name=f"User-{str(uid)[:4]}",
        status="active",
        is_platform_admin=is_platform_admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _token_for(user: User) -> str:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=settings,
    )
    return token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _grant_workspace_permission(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    permission: Permission,
) -> None:
    """建一个只含单个权限的角色并授予该 workspace 成员（参照 test_probe_endpoint 模式）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"test-ws-{permission.value}-{uuid.uuid4().hex[:6]}",
        name=f"test {permission.value}",
    )
    session.add(role)
    await session.flush()
    session.add(RolePermission(role_id=role.id, permission=permission.value))
    session.add(UserWorkspaceRole(user_id=user_id, workspace_id=workspace_id, role_id=role.id))
    await session.commit()


async def _create_workspace(
    session: AsyncSession,
    *,
    created_by: uuid.UUID,
    root_path: str,
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
        created_by=created_by,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_spec_workspace(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    spec_root: str,
) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        spec_root=spec_root,
        strategy="platform-managed",
        sync_status="synced",
    )
    session.add(spec_ws)
    await session.commit()
    await session.refresh(spec_ws)
    return spec_ws


async def _setup_skills_workspace(session: AsyncSession, tmp_path: Path) -> tuple[Workspace, Path]:
    """建 owner + workspace + spec 工作区（specDir = tmp_path/spec，skills/ 按需创建）。"""
    owner = await _create_user(session)
    spec_root = tmp_path / "spec"
    spec_root.mkdir()
    ws = await _create_workspace(session, created_by=owner.id, root_path=str(spec_root))
    await _create_spec_workspace(session, workspace_id=ws.id, spec_root=str(spec_root))
    return ws, spec_root / "skills"


def _make_skill(skills_dir: Path, name: str, files: dict[str, str] | None = None) -> Path:
    """在 specDir/skills/ 下预置一个真实 skill 目录（SKILL.md + 可选附加文件）。

    ``newline="\\n"`` 固定 LF 写盘：Windows 默认文本写会把 ``\\n`` 翻译成
    ``\\r\\n``，导致 GET 读回内容与预期不一致（读路径 read_bytes 不做行尾
    反翻译），fixture 需要跨平台字节精确。
    """
    skill_dir = skills_dir / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_text(f"---\nname: {name}\n---\n", encoding="utf-8", newline="\n")
    for rel, content in (files or {}).items():
        target = skill_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8", newline="\n")
    return skill_dir


def _file_url(ws_id: uuid.UUID, skill: str, path: str) -> str:
    return f"/api/workspaces/{ws_id}/skills/{skill}/files/{path}"


def _snapshot_tree(root: Path) -> dict[str, bytes | None]:
    """目录树快照：相对路径 → 文件内容（目录为 None，symlink 标记为哨兵字节）。"""
    snap: dict[str, bytes | None] = {}
    if not root.exists():
        return snap
    for p in sorted(root.rglob("*")):
        rel = p.relative_to(root).as_posix()
        if p.is_symlink():
            snap[rel] = b"<symlink>"
        elif p.is_file():
            snap[rel] = p.read_bytes()
        else:
            snap[rel] = None
    return snap


def _assert_cjk(message: str) -> None:
    """错误 message 必须含中文（对齐 tests/core/test_error_message_l10n.py 口径）。"""
    assert any("\u4e00" <= ch <= "\u9fff" for ch in message), message


async def _admin_headers(db_session: AsyncSession) -> dict[str, str]:
    """平台管理员请求头（has_permission 对 is_platform_admin 短路放行）。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    return _headers(_token_for(admin))


# ── 1. skill 级 CRUD（FR-01）──────────────────────────────────────────────


async def test_新建skill_201_SKILLmd落盘frontmatter_列表含新skill(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 合法名+描述 When POST /skills Then 201、SKILL.md 落盘含 name/description、列表含新 skill。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)

    # Act
    resp = await client.post(
        f"/api/workspaces/{ws.id}/skills",
        json={"name": "demo-skill", "description": "一个演示技能"},
        headers=headers,
    )

    # Assert
    assert resp.status_code == 201, resp.text
    entry = next(s for s in resp.json()["skills"] if s["name"] == "demo-skill")
    assert entry["files"] == ["SKILL.md"]
    skill_md = skills_dir / "demo-skill" / "SKILL.md"
    assert skill_md.is_file()  # 真实落盘
    text = skill_md.read_text(encoding="utf-8")
    assert text.startswith("---\n")  # frontmatter 头
    assert "name: demo-skill\n" in text
    assert "description: 一个演示技能\n" in text
    assert "\n---\n\n# demo-skill\n" in text  # frontmatter 闭合 + 正文标题
    assert "（在此编写该 skill 的使用说明）" in text
    # 跟随的列表端点也含新 skill（FR-01「列表刷新显示」）
    lst = await client.get(f"/api/workspaces/{ws.id}/skills", headers=headers)
    assert lst.status_code == 200, lst.text
    names = [s["name"] for s in lst.json()["skills"]]
    assert "demo-skill" in names


async def test_重名新建_409_原目录不受破坏(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 同名 skill 已存在 When 再次 POST Then 409 HTTP_409_SKILL_ALREADY_EXISTS（中文）且原文件不变。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    first = await client.post(
        f"/api/workspaces/{ws.id}/skills", json={"name": "dup-skill"}, headers=headers
    )
    assert first.status_code == 201, first.text
    skill_md = skills_dir / "dup-skill" / "SKILL.md"
    original = skill_md.read_text(encoding="utf-8")

    # Act
    resp = await client.post(
        f"/api/workspaces/{ws.id}/skills", json={"name": "dup-skill"}, headers=headers
    )

    # Assert
    assert resp.status_code == 409, resp.text
    payload = resp.json()
    assert payload["code"] == "HTTP_409_SKILL_ALREADY_EXISTS"
    assert "dup-skill" in payload["message"]
    _assert_cjk(payload["message"])
    assert skill_md.read_text(encoding="utf-8") == original  # 原目录不受破坏


@pytest.mark.parametrize(
    ("bad_name", "expected_code"),
    [
        ("a/b", "HTTP_422_SKILL_NAME_INVALID"),  # 分隔符 /
        ("a\\b", "HTTP_422_SKILL_NAME_INVALID"),  # 分隔符反斜杠
        ("..", "HTTP_422_SKILL_NAME_INVALID"),  # 穿越字面量
        ("my skill", "HTTP_422_SKILL_NAME_INVALID"),  # 空格
        ("技能", "HTTP_422_SKILL_NAME_INVALID"),  # 中文（白名单外）
        ("a:b", "HTTP_422_SKILL_NAME_INVALID"),  # 冒号（盘符向量）
        ("", "validation_error"),  # 空串（pydantic min_length）
    ],
    ids=["slash", "backslash", "dotdot", "space", "cjk", "colon", "empty"],
)
async def test_非法skill名矩阵_422_磁盘零接触(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    bad_name: str,
    expected_code: str,
) -> None:
    """Given skill 名不在白名单 When POST Then 422（对应错误码）且 skills/ 树不变、不落盘。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    before = _snapshot_tree(skills_dir)

    # Act
    resp = await client.post(
        f"/api/workspaces/{ws.id}/skills", json={"name": bad_name}, headers=headers
    )

    # Assert
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == expected_code
    if expected_code == "HTTP_422_SKILL_NAME_INVALID":
        _assert_cjk(resp.json()["message"])
    assert _snapshot_tree(skills_dir) == before  # 磁盘零接触


async def test_删除skill_200_目录整体消失(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given skill 含嵌套文件 When DELETE /skills/{name} Then 200 deleted=true、目录整体消失、列表移除。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    skill_dir = _make_skill(
        skills_dir, "gone-skill", {"scripts/run.sh": "echo hi", "notes.md": "x"}
    )

    # Act
    resp = await client.delete(f"/api/workspaces/{ws.id}/skills/gone-skill", headers=headers)

    # Assert
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"deleted": True}
    assert not skill_dir.exists()  # 整个目录（含子目录）从磁盘消失
    lst = await client.get(f"/api/workspaces/{ws.id}/skills", headers=headers)
    assert "gone-skill" not in [s["name"] for s in lst.json()["skills"]]


async def test_删除不存在的skill_404(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given skill 不存在 When DELETE Then 404 HTTP_404_SKILL_NOT_FOUND（中文）。"""
    # Arrange
    ws, _skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)

    # Act
    resp = await client.delete(f"/api/workspaces/{ws.id}/skills/ghost", headers=headers)

    # Assert
    assert resp.status_code == 404, resp.text
    payload = resp.json()
    assert payload["code"] == "HTTP_404_SKILL_NOT_FOUND"
    _assert_cjk(payload["message"])


# ── 2. 文件级 CRUD（FR-02）───────────────────────────────────────────────


async def test_读文件_返回内容与size(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given skill 内有 UTF-8 文本文件 When GET files/{path} Then 200 返回 path/content/size（字节数）。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    content = "# 笔记\n中文内容 line2\n"
    _make_skill(skills_dir, "reader", {"notes.md": content})

    # Act
    resp = await client.get(_file_url(ws.id, "reader", "notes.md"), headers=headers)

    # Assert
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["path"] == "notes.md"
    assert body["content"] == content  # 中文原样（UTF-8 roundtrip）
    assert body["size"] == len(content.encode("utf-8"))


async def test_读不存在的文件_404(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 文件不存在 When GET Then 404 HTTP_404_SKILL_NOT_FOUND（中文）。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    _make_skill(skills_dir, "reader")

    # Act
    resp = await client.get(_file_url(ws.id, "reader", "missing.md"), headers=headers)

    # Assert
    assert resp.status_code == 404, resp.text
    payload = resp.json()
    assert payload["code"] == "HTTP_404_SKILL_NOT_FOUND"
    _assert_cjk(payload["message"])


async def test_写文件_覆盖已有_内容落盘(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given skill 内已有文件 When PUT 新内容 Then 200、磁盘内容更新、size 为字节数。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    _make_skill(skills_dir, "editor", {"notes.md": "旧内容"})
    new_content = "新内容-覆盖\n"

    # Act
    resp = await client.put(
        _file_url(ws.id, "editor", "notes.md"), json={"content": new_content}, headers=headers
    )

    # Assert
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["path"] == "notes.md"
    assert body["size"] == len(new_content.encode("utf-8"))
    on_disk = (skills_dir / "editor" / "notes.md").read_text(encoding="utf-8")
    assert on_disk == new_content  # 真实落盘断言


async def test_写文件_新建含父目录_scripts(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 两层内合法路径 When PUT Then 200、父目录自动创建、文件树清单反映变化。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    _make_skill(skills_dir, "scripted")
    content = "#!/bin/sh\necho 中文\n"

    # Act
    resp = await client.put(
        _file_url(ws.id, "scripted", "scripts/x.sh"), json={"content": content}, headers=headers
    )

    # Assert
    assert resp.status_code == 200, resp.text
    target = skills_dir / "scripted" / "scripts" / "x.sh"
    assert target.is_file()  # 父目录自动创建 + 文件落盘
    assert target.read_text(encoding="utf-8") == content
    lst = await client.get(f"/api/workspaces/{ws.id}/skills", headers=headers)
    entry = next(s for s in lst.json()["skills"] if s["name"] == "scripted")
    assert "scripts/x.sh" in entry["files"]  # 文件树刷新可见


async def test_写文件_skill不存在_404(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given skill 不存在 When PUT 文件 Then 404（不静默建 skill 目录）。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)

    # Act
    resp = await client.put(
        _file_url(ws.id, "ghost", "notes.md"), json={"content": "x"}, headers=headers
    )

    # Assert
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_SKILL_NOT_FOUND"
    assert not (skills_dir / "ghost").exists()  # 未静默创建 skill 目录


async def test_删文件_200_文件消失(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given skill 内有附加文件 When DELETE files/{path} Then 200、文件从磁盘消失、SKILL.md 保留。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    skill_dir = _make_skill(skills_dir, "trimmer", {"old.md": "x"})

    # Act
    resp = await client.delete(_file_url(ws.id, "trimmer", "old.md"), headers=headers)

    # Assert
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"deleted": True}
    assert not (skill_dir / "old.md").exists()
    assert (skill_dir / "SKILL.md").is_file()  # 入口文件不受影响


async def test_删不存在的文件_404(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 文件不存在 When DELETE Then 404 HTTP_404_SKILL_NOT_FOUND。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    _make_skill(skills_dir, "trimmer")

    # Act
    resp = await client.delete(_file_url(ws.id, "trimmer", "missing.md"), headers=headers)

    # Assert
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_SKILL_NOT_FOUND"


# ── 3. 路径穿越变体矩阵（FR-03：全部 422 且磁盘零接触）────────────────────


@pytest.mark.parametrize(
    ("raw_path", "expected_code"),
    [
        ("..%2Fescape.txt", "HTTP_422_SKILL_NAME_INVALID"),  # ../（编码斜杠送达）
        ("%2e%2e/escape.txt", "HTTP_422_SKILL_NAME_INVALID"),  # ../（点全编码）
        ("..%5Cescape.txt", "HTTP_422_SKILL_NAME_INVALID"),  # ..\（编码反斜杠）
        ("%2Fetc%2Fpasswd", "HTTP_422_SKILL_PATH_INVALID"),  # 绝对路径（编码送达）
        ("C:%5Cwindows%5Csystem32.ini", "HTTP_422_SKILL_PATH_INVALID"),  # 盘符 C:\
        ("a/%2e%2e/%2e%2e/b", "HTTP_422_SKILL_PATH_INVALID"),  # a/../../b 上跳两层
        ("a/b/c.txt", "HTTP_422_SKILL_PATH_INVALID"),  # 三层深层路径
        ("", "HTTP_422_SKILL_PATH_INVALID"),  # 空路径（URL 以 /files/ 结尾）
    ],
    ids=[
        "dotdot-slash",
        "dotdot-encoded-dots",
        "dotdot-backslash",
        "absolute-path",
        "windows-drive",
        "up-two-levels",
        "three-layers",
        "empty-path",
    ],
)
async def test_路径穿越矩阵_写向全422_磁盘零接触(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    raw_path: str,
    expected_code: str,
) -> None:
    """Given 任意穿越变体 When PUT files/{path} Then 422（对应错误码）且 specDir 树前后快照一致。

    httpx 会对 URL 里裸 ``..`` 段做规范化折叠（实测 ``/../escape.txt`` 被折叠成
    ``/escape.txt``），穿越用例一律以编码变体送达——这正是绕过前端/代理直打
    后端的真实攻击面；服务端 unquote 后进入三重防线校验。
    """
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    _make_skill(skills_dir, "demo", {"SKILL.md": "---\nname: demo\n---\n"})
    # 在 specDir 外放一个诱饵文件，穿越若触盘会波及它
    outside = tmp_path / "outside"
    outside.mkdir()
    decoy = outside / "escape.txt"
    decoy.write_text("诱饵", encoding="utf-8")
    before = _snapshot_tree(skills_dir)
    before_outside = _snapshot_tree(outside)

    # Act
    resp = await client.put(
        _file_url(ws.id, "demo", raw_path), json={"content": "穿越载荷"}, headers=headers
    )

    # Assert
    assert resp.status_code == 422, resp.text
    payload = resp.json()
    assert payload["code"] == expected_code
    _assert_cjk(payload["message"])
    assert _snapshot_tree(skills_dir) == before  # skill 树零接触
    assert _snapshot_tree(outside) == before_outside  # specDir 外同样零接触
    assert decoy.read_text(encoding="utf-8") == "诱饵"


async def test_路径穿越_读向与删向_422_磁盘零接触(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 穿越变体打到读/删向 When GET/DELETE files/{path} Then 422 且 specDir 树不变。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    _make_skill(skills_dir, "demo")
    before = _snapshot_tree(skills_dir)

    # Act
    gets = [
        await client.get(_file_url(ws.id, "demo", p), headers=headers)
        for p in ("..%2Fescape.txt", "%2Fetc%2Fpasswd")
    ]
    dele = await client.delete(_file_url(ws.id, "demo", "a/%2e%2e/%2e%2e/b"), headers=headers)

    # Assert
    assert gets[0].status_code == 422, gets[0].text
    assert gets[0].json()["code"] == "HTTP_422_SKILL_NAME_INVALID"  # 段白名单防线（..）
    assert gets[1].status_code == 422, gets[1].text
    assert gets[1].json()["code"] == "HTTP_422_SKILL_PATH_INVALID"  # 绝对路径防线
    assert dele.status_code == 422, dele.text
    assert dele.json()["code"] == "HTTP_422_SKILL_PATH_INVALID"
    assert _snapshot_tree(skills_dir) == before  # 磁盘零接触


# ── 4. 约束（FR-03：二进制 415 / >512KB 413 双向 / 恰好 512KB 放行）───────


async def test_二进制文件读_415(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 文件含非 UTF-8 字节 When GET Then 415 HTTP_415_SKILL_FILE_NOT_TEXT（中文）。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    skill_dir = _make_skill(skills_dir, "binary-holder")
    (skill_dir / "blob.bin").write_bytes(b"\xff\xfe\x00\x01binary\xff")

    # Act
    resp = await client.get(_file_url(ws.id, "binary-holder", "blob.bin"), headers=headers)

    # Assert
    assert resp.status_code == 415, resp.text
    payload = resp.json()
    assert payload["code"] == "HTTP_415_SKILL_FILE_NOT_TEXT"
    _assert_cjk(payload["message"])


async def test_超大文件读_413(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 文件超过 512KB When GET Then 413 HTTP_413_SKILL_FILE_TOO_LARGE（中文）。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    skill_dir = _make_skill(skills_dir, "big-holder")
    (skill_dir / "big.txt").write_bytes(b"x" * (_LIMIT + 1))  # 512KB + 1B

    # Act
    resp = await client.get(_file_url(ws.id, "big-holder", "big.txt"), headers=headers)

    # Assert
    assert resp.status_code == 413, resp.text
    payload = resp.json()
    assert payload["code"] == "HTTP_413_SKILL_FILE_TOO_LARGE"
    _assert_cjk(payload["message"])


async def test_超大内容写_413_不落盘(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given content 超过 512KB When PUT Then 413 且目标文件不落盘。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    skill_dir = _make_skill(skills_dir, "big-writer")

    # Act
    resp = await client.put(
        _file_url(ws.id, "big-writer", "huge.txt"),
        json={"content": "x" * (_LIMIT + 1)},  # 513KB 写向载荷
        headers=headers,
    )

    # Assert
    assert resp.status_code == 413, resp.text
    assert resp.json()["code"] == "HTTP_413_SKILL_FILE_TOO_LARGE"
    assert not (skill_dir / "huge.txt").exists()  # 拒绝写，不落盘


async def test_恰好512KB_读写双向放行(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 文件/内容恰好 512KB（等于上限，未超过）When 读/写 Then 200（边界放行）。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    skill_dir = _make_skill(skills_dir, "edge")
    (skill_dir / "exact-read.txt").write_bytes(b"y" * _LIMIT)

    # Act
    read_resp = await client.get(_file_url(ws.id, "edge", "exact-read.txt"), headers=headers)
    write_resp = await client.put(
        _file_url(ws.id, "edge", "exact-write.txt"),
        json={"content": "z" * _LIMIT},
        headers=headers,
    )

    # Assert
    assert read_resp.status_code == 200, read_resp.text
    assert read_resp.json()["size"] == _LIMIT
    assert write_resp.status_code == 200, write_resp.text
    assert (skill_dir / "exact-write.txt").stat().st_size == _LIMIT


# ── 5. 入口保护（FR-02：SKILL.md 删除被 409 拒绝）─────────────────────────


async def test_SKILLmd删除_409_入口保护(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 删除目标 is SKILL.md When DELETE files/SKILL.md Then 409 HTTP_409_SKILL_ENTRY_PROTECTED 且文件保留。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    skill_dir = _make_skill(skills_dir, "protected")

    # Act
    resp = await client.delete(_file_url(ws.id, "protected", "SKILL.md"), headers=headers)

    # Assert
    assert resp.status_code == 409, resp.text
    payload = resp.json()
    assert payload["code"] == "HTTP_409_SKILL_ENTRY_PROTECTED"
    _assert_cjk(payload["message"])
    assert (skill_dir / "SKILL.md").is_file()  # 入口文件原样保留


# ── 6. 审计（FR-05：四类写操作各落行、details 不含文件内容）──────────────


async def test_四类写操作_审计各落行_details不含文件内容(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 依次建 skill/写文件/删文件/删 skill When 各操作成功 Then audit_logs 四行（action 正确、
    actor/workspace 正确、details 含 skill 名与文件路径）且 details_json 不含文件内容。"""
    # Arrange
    ws, _skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="skill-audit-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    headers = _headers(_token_for(writer))
    marker = "绝密内容不得进审计-9f8e7d6a"

    # Act
    r1 = await client.post(
        f"/api/workspaces/{ws.id}/skills",
        json={"name": "audit-demo", "description": "审计演示"},
        headers=headers,
    )
    r2 = await client.put(
        _file_url(ws.id, "audit-demo", "notes.md"), json={"content": marker}, headers=headers
    )
    r3 = await client.delete(_file_url(ws.id, "audit-demo", "notes.md"), headers=headers)
    r4 = await client.delete(f"/api/workspaces/{ws.id}/skills/audit-demo", headers=headers)

    # Assert
    assert r1.status_code == 201, r1.text
    assert r2.status_code == 200, r2.text
    assert r3.status_code == 200, r3.text
    assert r4.status_code == 200, r4.text

    rows = (
        (await db_session.execute(select(AuditLog).where(AuditLog.workspace_id == ws.id)))
        .scalars()
        .all()
    )
    actions = {r.action for r in rows}
    assert actions == {
        "workspace_skill.create",
        "workspace_skill.update_file",
        "workspace_skill.delete_file",
        "workspace_skill.delete",
    }
    assert all(r.actor_id == writer.id for r in rows)
    assert all(r.resource_type == "workspace_skill" for r in rows)
    by_action = {r.action: r for r in rows}
    assert json.loads(by_action["workspace_skill.create"].details_json) == {
        "skill": "audit-demo",
        "path": "SKILL.md",
    }
    assert json.loads(by_action["workspace_skill.update_file"].details_json) == {
        "skill": "audit-demo",
        "path": "notes.md",
    }
    assert json.loads(by_action["workspace_skill.delete_file"].details_json) == {
        "skill": "audit-demo",
        "path": "notes.md",
    }
    assert json.loads(by_action["workspace_skill.delete"].details_json) == {
        "skill": "audit-demo",
        "path": None,
    }
    for r in rows:  # 文件内容绝不进审计（FR-05）
        assert marker not in (r.details_json or "")


# ── 7. 权限（FR-01：非成员/只读成员写 → 403；只读成员读 → 200）────────────


async def test_非成员_新建skill_403_中文文案(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 普通用户不是工作区成员 When POST /skills Then 403（中文 message）且磁盘零接触。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    outsider = await _create_user(db_session, email="skill-outsider@example.com")
    before = _snapshot_tree(skills_dir)

    # Act
    resp = await client.post(
        f"/api/workspaces/{ws.id}/skills",
        json={"name": "nope"},
        headers=_headers(_token_for(outsider)),
    )

    # Assert
    assert resp.status_code == 403, resp.text
    payload = resp.json()
    assert payload["code"] == "HTTP_403_PERMISSION_DENIED"
    _assert_cjk(payload["message"])
    assert _snapshot_tree(skills_dir) == before


async def test_只读成员_写skill_403(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 成员只有 WORKSPACE_READ（无 WRITE）When POST /skills Then 403。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    reader = await _create_user(db_session, email="skill-reader@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=reader.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_READ,
    )
    before = _snapshot_tree(skills_dir)

    # Act
    resp = await client.post(
        f"/api/workspaces/{ws.id}/skills",
        json={"name": "nope"},
        headers=_headers(_token_for(reader)),
    )

    # Assert
    assert resp.status_code == 403, resp.text
    _assert_cjk(resp.json()["message"])
    assert _snapshot_tree(skills_dir) == before


async def test_只读成员_写文件_403(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 成员只有 WORKSPACE_READ When PUT files/{path} Then 403 且文件不变。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    reader = await _create_user(db_session, email="file-reader@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=reader.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_READ,
    )
    _make_skill(skills_dir, "demo", {"notes.md": "原文"})
    before = _snapshot_tree(skills_dir)

    # Act
    resp = await client.put(
        _file_url(ws.id, "demo", "notes.md"),
        json={"content": "越权写入"},
        headers=_headers(_token_for(reader)),
    )

    # Assert
    assert resp.status_code == 403, resp.text
    assert _snapshot_tree(skills_dir) == before


async def test_只读成员_读文件_200(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 成员持有 WORKSPACE_READ When GET files/{path} Then 200 正常读（读端点不要求 WRITE）。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    reader = await _create_user(db_session, email="can-read@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=reader.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_READ,
    )
    _make_skill(skills_dir, "demo", {"notes.md": "可读内容"})

    # Act
    resp = await client.get(
        _file_url(ws.id, "demo", "notes.md"), headers=_headers(_token_for(reader))
    )

    # Assert
    assert resp.status_code == 200, resp.text
    assert resp.json()["content"] == "可读内容"


async def test_writer成员_新建skill_201(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 成员持有 WORKSPACE_WRITE When POST /skills Then 201 且落盘（权限主流程）。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="skill-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )

    # Act
    resp = await client.post(
        f"/api/workspaces/{ws.id}/skills",
        json={"name": "writer-made"},
        headers=_headers(_token_for(writer)),
    )

    # Assert
    assert resp.status_code == 201, resp.text
    assert (skills_dir / "writer-made" / "SKILL.md").is_file()


# ── 8. symlink 防护（delete_skill 拒绝含符号链接条目的目录）────────────────


async def test_目录含symlink_删除被拒_422_目录原样(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given skill 目录内有指向外部的符号链接条目 When DELETE /skills/{name}
    Then 422 HTTP_422_SKILL_PATH_INVALID、skill 目录与外部目标均原样。"""
    # Arrange
    ws, skills_dir = await _setup_skills_workspace(db_session, tmp_path)
    headers = await _admin_headers(db_session)
    skill_dir = _make_skill(skills_dir, "booby-trap")
    outside = tmp_path / "outside"
    outside.mkdir()
    victim = outside / "victim.txt"
    victim.write_text("逃逸目标", encoding="utf-8")
    link = skill_dir / "evil-link.txt"
    try:
        link.symlink_to(victim)
    except OSError as exc:  # Windows 无特权创建 symlink 时跳过（先例：test_sync_incremental.py）
        pytest.skip(f"当前平台无法创建符号链接：{exc}")
    before = _snapshot_tree(skills_dir)

    # Act
    resp = await client.delete(f"/api/workspaces/{ws.id}/skills/booby-trap", headers=headers)

    # Assert
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "HTTP_422_SKILL_PATH_INVALID"
    _assert_cjk(resp.json()["message"])
    assert _snapshot_tree(skills_dir) == before  # skill 目录原样（含 symlink 条目）
    assert victim.read_text(encoding="utf-8") == "逃逸目标"  # 外部目标未被波及
