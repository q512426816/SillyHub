"""workspace skills 反向收编（GET adoptable + POST adopt，桥④）测试。

2026-09-11-workspace-asset-bridges task-03 / FR-03 / D-005（两阶段收编语义）/
D-008（名归一化 + 差集三源排除）：
- 差集三源排除：CustomSkill 全体名（DB 不限 owner）/ sillyspec-*（bundle 目录
  文件扫描 + specDir 前缀目录）/ git enabled 源 discover —— 三源名与前缀目录
  不出现在候选；disabled 源不参与排除
- 归一化边界（纯函数 + 端点）：大写→小写、下划线/点→连字符、压连续、去首尾、
  超 40 截断（含截断引入尾连字符再去）；全非法字符清空 → invalid；单字符 →
  invalid；归一化命中 sillyspec- 保留前缀 → invalid
- frontmatter 原样 vs 拼装：有 frontmatter 逐字原样落库（``_build_skill_md``
  直通防双拼）；缺 frontmatter 按打包层同款格式拼装（再直通，防双拼）
- adopt 逐名结果：重名 409 既有语义逐名呈现（整批不炸）；invalid 跳过带原因；
  missing / 路径穿越名 / 空 names 422
- 不删源断言：收编后 specDir 源文件逐字节原样
- 权限矩阵：非成员 / 只读成员 → 两端点 403；Writer 200

fixture 构造沿用 test_mcp_import_registry.py / test_skills_edit.py 的直插模式
（workspace / spec_ws 行直接插入，specDir 用 tmp_path 建真实目录；git 源行直插 +
缓存目录手工构造——test_library_enable.py 先例，全程不触 git 二进制/外网），
不 mock 被测端点与 service，断言真实 HTTP 响应、DB 行与磁盘副作用。
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.skills_bundle_service import _build_skill_md
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.skill_source.model import SkillSource
from app.modules.skill_source.service import normalize_adopt_name, source_cache_dir
from app.modules.skills.model import CustomSkill
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

# ── helpers（沿用 test_mcp_import_registry.py 的直插模式）──────────────────


async def _create_user(
    session: AsyncSession,
    *,
    email: str | None = None,
) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=email or f"user-{uid}@example.com",
        password_hash="irrelevant",
        display_name=f"User-{str(uid)[:4]}",
        status="active",
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


async def _setup_spec_workspace(
    session: AsyncSession,
    tmp_path: Path,
    *,
    with_spec_ws: bool = True,
) -> tuple[Workspace, Path, User]:
    """建 owner + workspace +（可选）spec 工作区；返回 (ws, skills_dir, owner)。

    specDir = tmp_path/spec（platform-managed 扁平布局），skills/ 子目录预建。
    """
    owner = await _create_user(session)
    spec_root = tmp_path / "spec"
    skills_dir = spec_root / "skills"
    skills_dir.mkdir(parents=True, exist_ok=True)

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=str(spec_root),
        status="active",
        created_by=owner.id,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    if with_spec_ws:
        session.add(
            SpecWorkspace(
                id=uuid.uuid4(),
                workspace_id=ws.id,
                spec_root=str(spec_root),
                strategy="platform-managed",
                sync_status="synced",
            )
        )
        await session.commit()
    return ws, skills_dir, owner


def _make_spec_skill(
    skills_dir: Path,
    name: str,
    *,
    content: str | None = None,
    extra_files: list[str] | None = None,
) -> Path:
    """specDir/skills 下造技能目录（SKILL.md + 可选辅助文件）。

    newline 固定 LF：Windows 文本写会把 LF 翻译成 CRLF，adopt 读的是原始字节，
    断言逐字原样必须钉死换行（skills_view_service 写路径同款先例）。
    """
    skill_dir = skills_dir / name
    skill_dir.mkdir(parents=True, exist_ok=True)
    default = f"---\nname: {name}\ndescription: {name} 的演示技能\n---\n\n# {name}\n"
    (skill_dir / "SKILL.md").write_text(
        content if content is not None else default, encoding="utf-8", newline="\n"
    )
    for rel in extra_files or []:
        target = skill_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("# helper\n", encoding="utf-8", newline="\n")
    return skill_dir


async def _add_custom_skill(session: AsyncSession, *, owner: uuid.UUID, name: str) -> CustomSkill:
    """直插 CustomSkill 行（差集排除 / 重名 409 铺底）。"""
    row = CustomSkill(
        name=name,
        description="既有技能",
        content=f"---\nname: {name}\ndescription: 既有技能\n---\n\n# {name}\n",
        created_by=owner,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def _add_source(
    session: AsyncSession,
    *,
    enabled: bool = True,
) -> SkillSource:
    """直插 git 源行（绕过 create 端点：无须 git mock，缓存目录手工构造）。"""
    source = SkillSource(
        url=f"https://8.8.8.8/{uuid.uuid4().hex}.git",
        branch="main",
        enabled=enabled,
    )
    session.add(source)
    await session.commit()
    await session.refresh(source)
    return source


def _make_cached_skill(source_id: uuid.UUID, dir_name: str) -> None:
    """git 缓存根造技能目录（test_library_enable.py 同款）。"""
    skill_dir = source_cache_dir(source_id) / dir_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_bytes(
        f"---\nname: {dir_name}\ndescription: {dir_name} 的 git 技能\n---\n\n# body\n".encode()
    )


def _adoptable_url(workspace_id: uuid.UUID) -> str:
    return f"/api/workspaces/{workspace_id}/skills/adoptable"


def _adopt_url(workspace_id: uuid.UUID) -> str:
    return f"/api/workspaces/{workspace_id}/skills/adopt"


async def _adoptable_index(client: AsyncClient, ws: Workspace, writer: User) -> dict[str, dict]:
    """GET adoptable → {目录名: 候选 dict}（Writer 视角）。"""
    resp = await client.get(_adoptable_url(ws.id), headers=_headers(_token_for(writer)))
    assert resp.status_code == 200, resp.text
    return {item["name"]: item for item in resp.json()["skills"]}


# ── 0. 归一化纯函数（D-008 单测）───────────────────────────────────────────


def test_normalize_adopt_name_合规归一化矩阵() -> None:
    """Given 各类目录名 When 归一化 Then 小写/连字符化/压缩/去首尾/截断（D-008）。"""
    assert normalize_adopt_name("MyTool") == ("mytool", None)
    assert normalize_adopt_name("my_tool.v2") == ("my-tool-v2", None)
    assert normalize_adopt_name("--dup--hyphen--") == ("dup-hyphen", None)
    assert normalize_adopt_name("a" * 50) == ("a" * 40, None)  # 超 40 截断


def test_normalize_adopt_name_截断引入的尾连字符再去() -> None:
    """Given 41 字符名（第 41 位是字母）When 截断 Then 尾连字符去除后仍合规。"""
    raw = "a" * 39 + "_b"  # 归一化 → 39a + "-b"（41 字符）→ 截 40 → 39a + "-"
    assert normalize_adopt_name(raw) == ("a" * 39, None)


def test_normalize_adopt_name_清空与单字符_invalid() -> None:
    """Given 全非法字符 / 单字符 When 归一化 Then 空 / 不满足 {2,40}，均 invalid。"""
    normalized, reason = normalize_adopt_name("中文技能")
    assert normalized == ""
    assert reason is not None and "为空" in reason

    normalized, reason = normalize_adopt_name("a")
    assert normalized == "a"
    assert reason is not None and "2,40" in reason


def test_normalize_adopt_name_保留前缀_invalid() -> None:
    """Given 归一化后命中 sillyspec- When 校验 Then invalid（与平台命名空间冲突）。"""
    normalized, reason = normalize_adopt_name("SillySpec-Clone")
    assert normalized == "sillyspec-clone"
    assert reason is not None and "sillyspec-" in reason


# ── 1. 权限矩阵（非成员/只读成员 403，Writer 200）──────────────────────────


async def test_非成员_两端点_被拒_403(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 普通用户不是工作区成员 When GET adoptable / POST adopt Then 403。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    _make_spec_skill(skills_dir, "plain-skill")
    outsider = await _create_user(db_session, email="outsider@example.com")

    resp_get = await client.get(_adoptable_url(ws.id), headers=_headers(_token_for(outsider)))
    resp_post = await client.post(
        _adopt_url(ws.id),
        json={"names": ["plain-skill"]},
        headers=_headers(_token_for(outsider)),
    )

    assert resp_get.status_code == 403, resp_get.text
    assert resp_post.status_code == 403, resp_post.text


async def test_只读成员_两端点_被拒_403(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 成员只有 WORKSPACE_READ（无 WRITE）When 两端点 Then 403（收编入口需写权限）。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    _make_spec_skill(skills_dir, "plain-skill")
    reader = await _create_user(db_session, email="reader@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=reader.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_READ,
    )

    resp_get = await client.get(_adoptable_url(ws.id), headers=_headers(_token_for(reader)))
    resp_post = await client.post(
        _adopt_url(ws.id),
        json={"names": ["plain-skill"]},
        headers=_headers(_token_for(reader)),
    )

    assert resp_get.status_code == 403, resp_get.text
    assert resp_post.status_code == 403, resp_post.text
    # 只读成员被拒后不应有任何 CustomSkill 落库
    rows = (await db_session.execute(select(CustomSkill))).scalars().all()
    assert rows == []


# ── 2. 差集三源排除（D-008：CustomSkill 全体名 ∪ sillyspec-* ∪ git discover）─


async def test_差集排除_三源与sillyspec前缀(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Given 三源各有同名 When GET adoptable Then 三源名与 sillyspec- 前缀目录不出现。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )

    # 源① CustomSkill 全体名（他人技能也要排除——不限 owner）
    stranger = await _create_user(db_session, email="stranger@example.com")
    await _add_custom_skill(db_session, owner=stranger.id, name="taken-custom")
    # 源② 平台 sillyspec-*（bundle 目录文件扫描）
    fake_bundle_dir = tmp_path / "fake-bundle"
    (fake_bundle_dir / "sillyspec-demo").mkdir(parents=True)
    (fake_bundle_dir / "sillyspec-demo" / "SKILL.md").write_text(
        "---\nname: sillyspec:demo\ndescription: 平台技能\n---\n", encoding="utf-8"
    )
    monkeypatch.setattr(get_settings(), "skills_bundle_dir", fake_bundle_dir)
    # 源③ git enabled 源实时 discover（缓存目录手工构造）
    monkeypatch.setattr(get_settings(), "spec_data_root", str(tmp_path))
    source = await _add_source(db_session, enabled=True)
    _make_cached_skill(source.id, "git-skill")

    # specDir 同名目录 + 干净候选 + 前缀目录
    for name in ("taken-custom", "sillyspec-demo", "git-skill", "fresh-skill", "sillyspec-local"):
        _make_spec_skill(skills_dir, name)

    index = await _adoptable_index(client, ws, writer)

    # 差集：只列 fresh-skill；sillyspec-local 仅因前缀被排除
    assert set(index) == {"fresh-skill"}
    assert "taken-custom" not in index  # CustomSkill 全体名（他人）
    assert "sillyspec-demo" not in index  # bundle 文件扫描命中 + 前缀
    assert "git-skill" not in index  # enabled 源 discover 命中


async def test_差集排除_disabled_git源不参与(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Given disabled 源的缓存技能同名目录 When GET adoptable Then 仍可列（disabled 不参与排除）。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="writer2@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    monkeypatch.setattr(get_settings(), "spec_data_root", str(tmp_path))
    disabled_source = await _add_source(db_session, enabled=False)
    _make_cached_skill(disabled_source.id, "stale-git-skill")
    _make_spec_skill(skills_dir, "stale-git-skill")

    index = await _adoptable_index(client, ws, writer)

    assert "stale-git-skill" in index  # disabled 源不在平台库名全集（R-05 同口径）


async def test_无spec工作区_adoptable空列表(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given workspace 无 spec_ws 行 When GET adoptable Then 200 空列表（与 GET skills 同口径）。"""
    ws, _skills_dir, owner = await _setup_spec_workspace(db_session, tmp_path, with_spec_ws=False)
    await _grant_workspace_permission(
        db_session,
        user_id=owner.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    resp = await client.get(_adoptable_url(ws.id), headers=_headers(_token_for(owner)))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"skills": []}


# ── 3. 归一化边界与 description（via 端点）─────────────────────────────────


async def test_归一化边界_via端点(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 大写/下划线/点/超长/全中文目录 When GET adoptable Then 归一化名与 valid 如 D-008。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="norm-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    _make_spec_skill(skills_dir, "MyTool")
    _make_spec_skill(skills_dir, "my_tool.v2")
    _make_spec_skill(skills_dir, "a" * 50)
    _make_spec_skill(skills_dir, "中文技能")

    index = await _adoptable_index(client, ws, writer)

    assert index["MyTool"]["normalized_name"] == "mytool"
    assert index["MyTool"]["valid"] is True
    assert index["my_tool.v2"]["normalized_name"] == "my-tool-v2"
    assert index["my_tool.v2"]["valid"] is True
    assert index["a" * 50]["normalized_name"] == "a" * 40  # 超 40 截断
    assert index["a" * 50]["valid"] is True
    assert index["中文技能"]["valid"] is False  # 清空 → invalid
    assert index["中文技能"]["invalid_reason"] is not None
    assert "为空" in index["中文技能"]["invalid_reason"]


async def test_description_截断200与缺省兜底(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 超长/缺失 frontmatter description When GET adoptable Then 截 200 / 中文兜底。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="desc-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    _make_spec_skill(
        skills_dir,
        "long-desc",
        content=f"---\nname: long-desc\ndescription: {'长' * 250}\n---\n\n# body\n",
    )
    _make_spec_skill(skills_dir, "no-desc", content="---\nname: no-desc\n---\n\n# body\n")
    _make_spec_skill(skills_dir, "no-front", content="# 只有正文\n")

    index = await _adoptable_index(client, ws, writer)

    assert index["long-desc"]["description"] == "长" * 200  # 截 200（DB 列宽同款）
    assert index["no-desc"]["description"] == "从 workspace 收编"  # 缺省兜底
    assert index["no-front"]["description"] == "从 workspace 收编"  # 无 frontmatter 同兜底


async def test_has_extra_files标记与缺SKILL_md的invalid(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 多文件 / 单文件 / 缺入口技能 When GET adoptable Then 标记与 invalid 如约。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="files-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    _make_spec_skill(skills_dir, "multi-file", extra_files=["run.py", "scripts/x.sh"])
    _make_spec_skill(skills_dir, "single-file")
    broken_dir = skills_dir / "no-entry"
    broken_dir.mkdir()
    (broken_dir / "README.md").write_text("no SKILL.md\n", encoding="utf-8")

    index = await _adoptable_index(client, ws, writer)

    assert index["multi-file"]["has_extra_files"] is True
    assert index["single-file"]["has_extra_files"] is False
    assert index["no-entry"]["valid"] is False
    assert index["no-entry"]["invalid_reason"] is not None
    assert "SKILL.md" in index["no-entry"]["invalid_reason"]


# ── 4. adopt 落库：frontmatter 原样 / 缺则拼装（D-005）──────────────────────


async def _make_writer(db_session: AsyncSession, ws: Workspace, *, email: str) -> User:
    writer = await _create_user(db_session, email=email)
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    return writer


async def test_adopt_frontmatter原样落库_打包层直通(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given SKILL.md 已带 frontmatter When adopt Then CustomSkill 内容逐字原样（防双拼）。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _make_writer(db_session, ws, email="adopt-writer@example.com")
    original = (
        "---\nname: whatever-front-name\ndescription: 原有描述保留\n---\n\n# 标题\n\n正文。\n"
    )
    _make_spec_skill(skills_dir, "with-front", content=original)

    resp = await client.post(
        _adopt_url(ws.id),
        json={"names": ["with-front"]},
        headers=_headers(_token_for(writer)),
    )

    assert resp.status_code == 200, resp.text
    (result,) = resp.json()["results"]
    assert result["status"] == "adopted"
    assert result["normalized_name"] == "with-front"
    row = (
        (await db_session.execute(select(CustomSkill).where(CustomSkill.name == "with-front")))
        .scalars()
        .one()
    )
    assert row.created_by == writer.id  # 归属操作者（D-005）
    assert row.content == original  # frontmatter 原样（逐字）
    assert row.description == "原有描述保留"
    # 打包层直通：_build_skill_md 检测围栏不再二次拼 frontmatter（防双拼）
    assert _build_skill_md(row) == original


async def test_adopt_缺frontmatter_按打包层口径拼装(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given SKILL.md 无 frontmatter When adopt Then 拼装头 + 原文 body，打包层再直通。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _make_writer(db_session, ws, email="assemble-writer@example.com")
    body = "# 只有正文\n\n内容。\n"
    _make_spec_skill(skills_dir, "no-front", content=body)

    resp = await client.post(
        _adopt_url(ws.id),
        json={"names": ["no-front"]},
        headers=_headers(_token_for(writer)),
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["results"][0]["status"] == "adopted"
    row = (
        (await db_session.execute(select(CustomSkill).where(CustomSkill.name == "no-front")))
        .scalars()
        .one()
    )
    expected = (
        "---\nname: no-front\ndescription: 从 workspace 收编\n---\n\n" + body
    )  # _build_skill_md 同款格式（name/description + body）
    assert row.content == expected
    assert row.description == "从 workspace 收编"
    # 拼装后的 content 已带围栏 → 打包层直通，不再双拼
    assert _build_skill_md(row) == expected


async def test_adopt_不删源_文件逐字节原样(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 收编成功 When adopt 完成后 Then specDir 源目录与文件逐字节原样（D-005 不删源）。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _make_writer(db_session, ws, email="keep-writer@example.com")
    skill_dir = _make_spec_skill(skills_dir, "kept-skill", extra_files=["scripts/run.py"])
    frozen_skill_md = (skill_dir / "SKILL.md").read_bytes()
    frozen_helper = (skill_dir / "scripts" / "run.py").read_bytes()

    resp = await client.post(
        _adopt_url(ws.id),
        json={"names": ["kept-skill"]},
        headers=_headers(_token_for(writer)),
    )

    assert resp.status_code == 200, resp.text
    assert resp.json()["results"][0]["status"] == "adopted"
    assert (skill_dir / "SKILL.md").read_bytes() == frozen_skill_md  # 逐字节原样
    assert (skill_dir / "scripts" / "run.py").read_bytes() == frozen_helper
    assert skill_dir.is_dir()  # 源目录不删（用户自清）


# ── 5. adopt 逐名结果：invalid 跳过 / missing / 重名 409 / 整批不炸 ──────────


async def test_adopt_invalid跳过_其余成功_整批不炸(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 批内含归一化非法名 When adopt Then 该名跳过带原因、其余成功（不炸整批）。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _make_writer(db_session, ws, email="batch-writer@example.com")
    _make_spec_skill(skills_dir, "中文技能")
    _make_spec_skill(skills_dir, "ok-skill")

    resp = await client.post(
        _adopt_url(ws.id),
        json={"names": ["中文技能", "ok-skill"]},
        headers=_headers(_token_for(writer)),
    )

    assert resp.status_code == 200, resp.text
    results = {r["name"]: r for r in resp.json()["results"]}
    assert results["中文技能"]["status"] == "invalid"
    assert results["中文技能"]["reason"] is not None
    assert results["ok-skill"]["status"] == "adopted"
    names = {
        row.name
        for row in (
            await db_session.execute(select(CustomSkill).where(CustomSkill.created_by == writer.id))
        ).scalars()
    }
    assert names == {"ok-skill"}  # invalid 未落库，成功项已落库


async def test_adopt_重名409_逐名结果_既有409语义(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 本人已有同名 CustomSkill（原始名大小写不同）When adopt Then 该名 conflict（409 语义）其余成功。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _make_writer(db_session, ws, email="conflict-writer@example.com")
    await _add_custom_skill(db_session, owner=writer.id, name="foo")  # 归一化撞名目标
    _make_spec_skill(skills_dir, "Foo")  # 原始名 "Foo" != "foo" → 差集不排除
    _make_spec_skill(skills_dir, "good-one")

    resp = await client.post(
        _adopt_url(ws.id),
        json={"names": ["Foo", "good-one"]},
        headers=_headers(_token_for(writer)),
    )

    assert resp.status_code == 200, resp.text  # 逐名结果，不炸整批
    results = {r["name"]: r for r in resp.json()["results"]}
    assert results["Foo"]["status"] == "conflict"
    assert results["Foo"]["normalized_name"] == "foo"
    assert "409" in results["Foo"]["reason"]
    assert results["good-one"]["status"] == "adopted"
    # 既有 foo 行原样，good-one 新增
    rows = {
        row.name: row
        for row in (
            await db_session.execute(select(CustomSkill).where(CustomSkill.created_by == writer.id))
        ).scalars()
    }
    assert set(rows) == {"foo", "good-one"}
    assert rows["foo"].description == "既有技能"  # 未被覆盖


async def test_adopt_missing与路径穿越名_逐名安全(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 不存在名与穿越名 When adopt Then missing / invalid 逐名结果，不触盘外。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _make_writer(db_session, ws, email="safety-writer@example.com")
    _make_spec_skill(skills_dir, "real-skill")

    resp = await client.post(
        _adopt_url(ws.id),
        json={"names": ["ghost", "../outside", "real-skill"]},
        headers=_headers(_token_for(writer)),
    )

    assert resp.status_code == 200, resp.text
    results = {r["name"]: r for r in resp.json()["results"]}
    assert results["ghost"]["status"] == "missing"
    assert results["../outside"]["status"] == "invalid"  # 段白名单拒绝（防穿越）
    assert results["real-skill"]["status"] == "adopted"
    assert not (tmp_path / "outside").exists()  # 盘外零接触


async def test_adopt_非UTF8文本_逐名invalid(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given SKILL.md 是二进制垃圾 When adopt Then invalid 带原因（不炸整批）。"""
    ws, skills_dir, _owner = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _make_writer(db_session, ws, email="binary-writer@example.com")
    skill_dir = skills_dir / "binary-skill"
    skill_dir.mkdir()
    (skill_dir / "SKILL.md").write_bytes(b"\xff\xfe\x00binary")

    resp = await client.post(
        _adopt_url(ws.id),
        json={"names": ["binary-skill"]},
        headers=_headers(_token_for(writer)),
    )

    assert resp.status_code == 200, resp.text
    (result,) = resp.json()["results"]
    assert result["status"] == "invalid"
    assert "UTF-8" in result["reason"]


async def test_adopt_names空数组_422(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given names 空数组 When POST adopt Then 422（请求体校验）。"""
    ws, _skills_dir, owner = await _setup_spec_workspace(db_session, tmp_path)
    await _grant_workspace_permission(
        db_session,
        user_id=owner.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    resp = await client.post(
        _adopt_url(ws.id), json={"names": []}, headers=_headers(_token_for(owner))
    )
    assert resp.status_code == 422, resp.text
