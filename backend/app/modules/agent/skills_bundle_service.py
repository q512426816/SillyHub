"""Skills bundle service: platform sillyspec skills scan, manifest, and tar.gz packaging.

Used by the daemon skill-manager (task-03) to synchronise sillyspec skills
from the backend to daemon-side ``.claude/skills/`` at start-up.

Implementation uses only Python stdlib (``tarfile`` + ``hashlib``) — no new
pip dependencies.

Change 2026-07-07-skills-mcp-management-ui (task-03): merged DB ``CustomSkill``
rows into manifest/bundle (D-001 单文件 DB). 每个 CustomSkill → ``<name>/SKILL.md``，
content = ``CustomSkill.content``。version hash 含 DB content（编辑/增删 → version
变 → daemon 重拉）。``session`` 参数可选传，不传时跳过 DB 合并（向后兼容旧调用）。

Change 2026-07-31-custom-skill-per-user (task-06, D-004/D-006): manifest/bundle
按 ``user_id`` 过滤 DB 自定义技能——每个用户的 AI 只加载系统 sillyspec-* + 自己
``created_by`` 的自定义技能。``user_id`` 为 ``None`` 时不返回任何自定义技能（向后
兼容纯代码库调用）。系统 sillyspec-* 文件系统扫描（``_collect_skill_files``）全局
共享不变（D-006）。
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import tarfile
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml
from sqlalchemy import select

from app.core.config import get_settings
from app.modules.skills.model import CustomSkill

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

SKILLS_GLOB = "sillyspec-*"
"""Glob pattern to match sillyspec skill directories under the bundle root."""

SKILLS_MAX_CONTENT_BYTES = 1 * 1024 * 1024  # 1 MiB — read_skill_md 上限（只读语义干净，不截断）


def read_skill_md(skill_name: str) -> str:
    """Read a sillyspec-* skill's SKILL.md content (whitelist + fixed file, traversal-safe).

    2026-08-05-skill-content-viewer task-01：供 daemon ``GET /skills/{skill_name}/content``
    端点只读查看。安全：``skill_name`` 必须在 ``skills_bundle_dir`` 下 ``sillyspec-*``
    目录白名单内（与 ``SKILLS_GLOB`` 同源），只读固定 ``SKILL.md``——不拼接用户传入
    path，天然防路径穿越。

    本函数保持模块「纯 stdlib」约定（不 import FastAPI）：raise 内置异常，由 router
    层 catch 转 HTTPException（404/413）。

    Raises:
        FileNotFoundError: ``skill_name`` 非白名单 或 该目录无 SKILL.md（str(exc) 区分）。
        ValueError: SKILL.md > ``SKILLS_MAX_CONTENT_BYTES``（只读语义，不截断）。
    """
    skills_dir = get_settings().skills_bundle_dir
    valid_names = {p.name for p in skills_dir.glob(SKILLS_GLOB) if p.is_dir()}
    if skill_name not in valid_names:
        raise FileNotFoundError(f"技能不存在：'{skill_name}' 不在平台技能列表内")
    skill_md_path = skills_dir / skill_name / "SKILL.md"
    if not skill_md_path.is_file():
        raise FileNotFoundError(f"技能不完整：'{skill_name}' 缺少 SKILL.md 文件")
    content = skill_md_path.read_text(encoding="utf-8")
    if len(content.encode("utf-8")) > SKILLS_MAX_CONTENT_BYTES:
        raise ValueError(f"技能内容过大：'{skill_name}' 的 SKILL.md 超过 1 MiB 上限")
    return content


def _collect_skill_files(skills_dir: Path) -> list[tuple[Path, bytes]]:
    """Recursively collect all regular files from ``sillyspec-*`` subdirectories.

    Returns a list of ``(relative_path, content_bytes)`` tuples sorted by
    relative path for deterministic ordering. Returns empty list when no
    ``sillyspec-*`` directories exist or when none of them contain files.

    Note: returns in-memory bytes (not absolute paths) so DB-backed custom
    skills (no filesystem path) can be merged into the same list uniformly.
    """
    files: list[tuple[Path, bytes]] = []
    for skill_dir in sorted(skills_dir.glob(SKILLS_GLOB)):
        if not skill_dir.is_dir():
            continue
        for fpath in sorted(skill_dir.rglob("*")):
            if fpath.is_file():
                rel_path = fpath.relative_to(skills_dir)
                files.append((rel_path, fpath.read_bytes()))
    return files


def _build_skill_md(row: CustomSkill) -> str:
    """拼装自定义技能的 SKILL.md：frontmatter（name+description）+ body。

    ``model.py`` / ``schema.py`` 注释承诺「YAML frontmatter 由业务层组装，DB
    只存 body」。本函数在打包层组装（change skills-settings-p0-fixup D-001）：
    用 DB 的 name + description 拼 YAML frontmatter 头部，DB content 作为 body
    跟在其后。一次性修复全部历史/新建自定义技能，无需数据迁移。

    防双拼（D-003）：若 content 已以 frontmatter 围栏 ``---`` 开头，视为用户已
    手写 frontmatter，原样返回 content 不再重复拼接。Claude 靠 SKILL.md 顶部
    的 description 判断何时触发该技能——不拼 frontmatter 则 AI 无法识别。
    """
    body = row.content or ""
    if body.lstrip().startswith("---"):
        return body
    return f"---\nname: {row.name}\ndescription: {row.description}\n---\n\n{body}"


async def _collect_custom_skills(
    session: "AsyncSession | None",
    user_id: uuid.UUID | None,
) -> list[tuple[Path, bytes]]:
    """Merge DB ``CustomSkill`` rows into the same ``(relpath, content)`` shape.

    Each CustomSkill → ``<name>/SKILL.md``（D-001 单文件）。SKILL.md 内容由
    :func:`_build_skill_md` 拼装（frontmatter + body，D-001）。``name`` 排序
    保证确定性。

    Per-user 过滤（change 2026-07-31-custom-skill-per-user task-06, D-004）：
    只返回 ``created_by == user_id`` 的自定义技能——每个用户的 AI 只加载系统
    sillyspec-* + 自己创建的技能。``user_id`` 为 ``None`` 或 ``session`` 为
    ``None`` 时返回空列表（向后兼容不依赖 DB 的纯代码库调用，且避免无意中把
    全表技能泄漏给未鉴权的调用方）。
    """
    if session is None or user_id is None:
        return []
    rows = (
        (
            await session.execute(
                select(CustomSkill)
                .where(CustomSkill.created_by == user_id)
                .order_by(CustomSkill.name)
            )
        )
        .scalars()
        .all()
    )
    out: list[tuple[Path, bytes]] = []
    for row in rows:
        rel_path = Path(row.name) / "SKILL.md"
        out.append((rel_path, _build_skill_md(row).encode("utf-8")))
    return out


def _compute_version(
    files: list[tuple[Path, bytes]],
    skills_dir: Path,
) -> str:
    """Compute a content-derived version string.

    Feeds each file's relative path + content into a cumulative SHA-256, then
    returns the first 12 hex characters of the final digest. This guarantees
    that any file change (incl. DB custom-skill edit/add/delete) produces a
    different version.
    """
    digest = hashlib.sha256()
    # Include the directory name itself for cross-machine determinism
    digest.update(skills_dir.name.encode("utf-8"))
    for rel_path, content in files:
        # Also hash the relative path so renames change the version
        digest.update(str(rel_path).encode("utf-8"))
        digest.update(content)
    return digest.hexdigest()[:12]


def _parse_skill_frontmatter(content: bytes) -> dict[str, str]:
    """解析 SKILL.md 开头的 YAML frontmatter，返回 ``{name, description}``（仅这两键）。

    展示用途：平台技能清单页要显示每个技能「干什么」，从 SKILL.md 顶部 frontmatter
    取 description。无法解析（无 frontmatter 围栏 / YAML 语法错 / 解码错）时返回
    空 dict，**不抛异常**——description 是展示用的锦上添花，单个坏文件不能炸掉整个
    manifest。

    SKILL.md 格式（见 ``.claude/skills/sillyspec-*/SKILL.md``）::

        ---
        name: sillyspec:archive
        description: 用于归档已验证完成的变更。适合用户说"归档、archive"……
        ---

        ## 何时使用 …
    """
    try:
        text = content.decode("utf-8")
    except (UnicodeDecodeError, AttributeError):
        return {}
    if not text.lstrip().startswith("---"):
        return {}
    lines = text.split("\n")
    # 取首尾两个 ``---`` 围栏之间的 YAML 块
    markers = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    if len(markers) < 2:
        return {}
    body = "\n".join(lines[markers[0] + 1 : markers[1]])
    try:
        data = yaml.safe_load(body) or {}
    except yaml.YAMLError:
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: str(v).strip() for k, v in data.items() if k in ("name", "description") and v}


def _summarize_skills(files: list[tuple[Path, bytes]]) -> list[dict[str, Any]]:
    """按 skill 顶层目录聚合，返回 ``[{name, description, invoke_name, file_count}]``。

    * ``name`` —— 顶层目录名（技能标识，与 daemon 同步路径、前端 ``deriveSkillGroups``
      口径一致；注意它可能与 frontmatter ``name`` 不同，如目录 ``sillyspec-archive``
      vs frontmatter ``sillyspec:archive``，展示统一用目录名）。
    * ``description`` —— 该目录下 ``SKILL.md`` 的 frontmatter description
      （:func:`_parse_skill_frontmatter`）；无 SKILL.md 或无 frontmatter 时为空串。
    * ``invoke_name`` —— 同一 frontmatter 的 ``name`` 原值（冒号名原样保留，供前端
      回填 slash 调用名）；无 SKILL.md 或 frontmatter 缺 name 时为 None（目录名兜底
      由前端 ``invoke_name ?? name`` 完成，task-06 / 2026-08-26-session-input-mention）。
    * ``file_count`` —— 该顶层目录下文件数。

    按 ``name`` 排序保证确定性（与 ``deriveSkillGroups`` 一致）。
    """
    groups: dict[str, dict[str, Any]] = {}
    for rel_path, content in files:
        parts = str(rel_path).replace("\\", "/").split("/")
        top = parts[0]
        if not top:
            continue
        grp = groups.setdefault(
            top, {"description": "", "invoke_name": None, "file_count": 0, "skill_md_parsed": False}
        )
        grp["file_count"] += 1
        # SKILL.md 在顶层目录根下：parts == [top, "SKILL.md"]
        if len(parts) == 2 and parts[1] == "SKILL.md" and not grp["skill_md_parsed"]:
            frontmatter = _parse_skill_frontmatter(content)
            grp["description"] = frontmatter.get("description", "")
            grp["invoke_name"] = frontmatter.get("name") or None
            grp["skill_md_parsed"] = True
    return [
        {
            "name": name,
            "description": grp["description"],
            "invoke_name": grp["invoke_name"],
            "file_count": grp["file_count"],
        }
        for name, grp in sorted(groups.items())
    ]


async def _gather_all_files(
    skills_dir: Path,
    session: "AsyncSession | None",
    user_id: uuid.UUID | None = None,
) -> list[tuple[Path, bytes]]:
    """Combine codebase sillyspec-* files + DB custom skills (deterministic order).

    Both lists are individually sorted; codebase files first, then DB custom
    skills (so a codebase-only caller with ``session=None`` gets the original
    ordering unchanged). ``user_id`` 透传给 :func:`_collect_custom_skills`
    做 per-user 过滤（D-004）。
    """
    fs_files = await asyncio.to_thread(_collect_skill_files, skills_dir)
    db_files = await _collect_custom_skills(session, user_id)
    return fs_files + db_files


async def build_skills_manifest(
    skills_dir: Path | None = None,
    session: "AsyncSession | None" = None,
    user_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Scan ``skills_dir`` + DB ``CustomSkill`` rows and return a manifest dict.

    The manifest contains:

    * ``version`` — content-derived SHA-256 prefix (12 hex chars); empty string
      when no skills are found.
    * ``files`` — list of ``{path, sha256}`` entries, one per file.
    * ``message`` — informational string (only present on error/empty states).
    * ``skills`` — list of ``{name, description, invoke_name, file_count}`` summaries
      for the platform skills list UI（展示用：解析每个顶层 skill 目录下 ``SKILL.md``
      的 frontmatter ``description`` 与 ``name`` 原值）。``files`` 为空时为空列表。

    When ``skills_dir`` is ``None`` (default) the value from
    ``Settings.skills_bundle_dir`` is used. When the directory does not exist
    an empty manifest is returned (non-error) so the daemon side can detect
    "no skills" vs "error". ``session`` is optional — when ``None`` the DB
    custom-skills merge is skipped (backward-compatible pure-codebase behavior).

    Per-user 过滤（change 2026-07-31-custom-skill-per-user task-06, D-004）：
    ``user_id`` 透传到 :func:`_collect_custom_skills`，manifest 只含系统
    sillyspec-* 技能 + 该 user ``created_by`` 的自定义技能。``user_id`` 为
    ``None`` 时不含任何自定义技能（仅系统技能）。
    """
    if skills_dir is None:
        skills_dir = get_settings().skills_bundle_dir

    if not skills_dir.is_dir():
        # Directory missing is an error state regardless of DB content — daemon
        # expects codebase skills to exist; do not silently fall back to DB-only.
        return {
            "version": "",
            "files": [],
            "message": "未找到技能目录，请检查平台 skills_bundle_dir 配置",
        }

    files = await _gather_all_files(skills_dir, session, user_id)
    if not files:
        return {"version": "", "files": [], "message": "未找到任何 sillyspec 技能"}

    file_entries: list[dict[str, str]] = []
    for rel_path, content in files:
        file_hash = hashlib.sha256(content).hexdigest()
        file_entries.append(
            {
                "path": str(rel_path).replace("\\", "/"),
                "sha256": file_hash,
            }
        )

    version = _compute_version(files, skills_dir)
    skill_summaries = _summarize_skills(files)
    return {"version": version, "files": file_entries, "skills": skill_summaries}


async def build_skills_bundle(
    skills_dir: Path | None = None,
    session: "AsyncSession | None" = None,
    user_id: uuid.UUID | None = None,
) -> bytes:
    """Build a gzipped tar archive of all sillyspec-* skill files + DB custom skills.

    Returns the raw bytes of the ``.tar.gz`` archive. When the source directory
    does not exist or contains no skills an empty ``b""`` is returned.
    ``session`` is optional — when ``None`` the DB custom-skills merge is
    skipped (backward-compatible pure-codebase behavior).

    Per-user 过滤（change 2026-07-31-custom-skill-per-user task-06, D-004）：
    ``user_id`` 透传到 :func:`_collect_custom_skills`，tar 内只含系统技能 +
    该 user ``created_by`` 的自定义技能 ``<name>/SKILL.md``。``user_id`` 为
    ``None`` 时不含任何自定义技能（仅系统技能）。
    """
    if skills_dir is None:
        skills_dir = get_settings().skills_bundle_dir

    if not skills_dir.is_dir():
        return b""

    files = await _gather_all_files(skills_dir, session, user_id)
    if not files:
        return b""

    return await asyncio.to_thread(_build_tar_gz, files)


def _build_tar_gz(files: list[tuple[Path, bytes]]) -> bytes:
    """``build_skills_bundle`` 同步 tar 构建段（Wave C 续：移出事件循环）。"""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for rel_path, content in files:
            arcname = str(rel_path).replace("\\", "/")
            tarinfo = tarfile.TarInfo(name=arcname)
            tarinfo.size = len(content)
            tar.addfile(tarinfo, io.BytesIO(content))
    return buf.getvalue()
