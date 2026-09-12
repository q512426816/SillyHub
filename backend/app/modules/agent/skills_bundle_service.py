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

Change 2026-09-11-skills-central-library (task-03, D-005/D-010): ``_gather_all_files``
追加第三源——``user_skill_enables`` 命中的 git 缓存技能（``skills_git_cache/<source_id>/``
文件系统为源，本体不进 DB）。同名优先级 sillyspec-* > CustomSkill > git 源
（source_id 升序），先到先得、后到跳过 + log warn（D-010，skill-manager 扁平解压
同名静默覆盖实证）。manifest ``files`` 条目增可选 ``source`` 标记
（sillyspec/custom/git），daemon 只消费 version/sha256 向后兼容（D-005：version
算法不动）。

Change 2026-09-11-workspace-asset-bridges (task-01, D-002/D-010): ``user_skill_enables``
扩 workspace_id 列（单表双 scope）。收集谓词双口径：``workspace_id=None``（缺省）
显式 ``workspace_id IS NULL``——user-only 行为逐字不变（无绑定 version hash 零变化）；
非 ``None`` 渲染 user ∪ workspace 并集（``(user_id=:u AND workspace_id IS NULL) OR
workspace_id=:w``）。``build_skills_manifest``/``build_skills_bundle`` 透传可选
``workspace_id``（daemon 端点接参归 task-04，本卡调用方零改动）。
"""

from __future__ import annotations

import asyncio
import hashlib
import io
import os
import tarfile
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

import yaml
from sqlalchemy import select

from app.core.config import get_settings
from app.core.logging import get_logger
from app.modules.skills.model import CustomSkill

log = get_logger(__name__)

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


def _read_skill_dir_files(skill_dir: Path, top_name: str) -> list[tuple[Path, bytes]]:
    """同步收集单个 git 技能目录的文件集（排除 ``.git``，D-010/D-007）。

    ``rel_path`` 以技能目录名原样为顶层（D-010：与 CustomSkill 的 ``<name>/SKILL.md``
    同层，daemon 扁平解压后同名会静默覆盖——去重交由 :func:`_dedup_by_top_dir`）。
    目录不存在返回空列表（悬空绑定跳过语义）。按路径排序保证确定性。
    """
    if not skill_dir.is_dir():
        return []
    paths: list[Path] = []
    for root, dirs, file_names in os.walk(skill_dir):
        dirs[:] = [d for d in dirs if d != ".git"]
        for fname in file_names:
            fpath = Path(root) / fname
            if fpath.is_symlink():
                # POSIX 恶意仓可 checkout 出指向缓存外（如 /etc/passwd）的文件
                # symlink，read_bytes 跟随链接即越界读——链接文件一律不进 bundle
                # （Windows git 默认物化链接为纯文本，无此面）。
                continue
            paths.append(fpath)
    files: list[tuple[Path, bytes]] = []
    for fpath in sorted(paths):
        rel_path = Path(top_name) / fpath.relative_to(skill_dir)
        files.append((rel_path, fpath.read_bytes()))
    return files


async def _collect_enabled_git_skills(
    session: "AsyncSession | None",
    user_id: uuid.UUID | None,
    workspace_id: uuid.UUID | None = None,
) -> list[tuple[Path, bytes, str]]:
    """第三源（task-03）：``user_skill_enables`` 命中的 git 缓存技能文件集。

    链路（taskcard 权威）：查当前用户的启用绑定 → skill_key 解析
    ``<source_id>:<目录名>`` → 源须存在且 enabled → 映射缓存根
    ``skills_git_cache/<source_id>/[subdir/]<目录名>``（与 task-02 发现根同口径）
    → 目录不存在跳过（**悬空绑定保留**，刷新后技能回来即自动恢复）→ 收集目录
    文件集（排除 ``.git``，rel_path=目录名原样，D-010）。

    双 scope 谓词（bridges task-01，D-002/D-010）：``workspace_id=None``（缺省）
    显式 ``user_id=:u AND workspace_id IS NULL``——与旧全表 user 行为逐字一致
    （无绑定 user bundle version hash 零变化）；非 ``None`` 取并集
    ``(user_id=:u AND workspace_id IS NULL) OR workspace_id=:w``（ws 行不限
    user_id——绑定共享，user_id 仅操作者审计）。

    每条附 origin 标签 ``git:<source_id>``——供 :func:`_dedup_by_top_dir` 区分
    git 源之间的同源/异源（同源重复保留旧语义、异源同名先到先得）。遍历顺序
    按 ``(str(source_id), skill_key)`` 升序——D-010 同名优先级里 git 源之间的
    次序依据。``session`` 或 ``user_id`` 为 ``None`` 时返回空列表（向后兼容纯
    代码库调用）。仅遍历启用命中的目录（R-05）。
    """
    if session is None or user_id is None:
        return []
    # 延迟导入：skill_source.git_fetcher 顶层 import 本模块的 _parse_skill_frontmatter，
    # 模块级反向 import 会成环（daemon_rpc.py 函数内 import 同款先例）。
    from app.modules.skill_source.model import SkillSource, UserSkillEnable
    from app.modules.skill_source.service import safe_discovery_root

    # D-010：user 维度显式 IS NULL（ws 行不混入——version hash 零回归底线）；
    # D-002：workspace 维度并集（OR 分支不限 user_id）。
    enable_filter = (UserSkillEnable.user_id == user_id) & (UserSkillEnable.workspace_id.is_(None))
    if workspace_id is not None:
        enable_filter = enable_filter | (UserSkillEnable.workspace_id == workspace_id)
    enables = list(
        (await session.execute(select(UserSkillEnable).where(enable_filter))).scalars().all()
    )
    if not enables:
        return []
    sources = (
        (await session.execute(select(SkillSource).where(SkillSource.enabled.is_(True))))
        .scalars()
        .all()
    )
    source_map = {source.id: source for source in sources}

    out: list[tuple[Path, bytes, str]] = []
    # source_id 升序（str 比较确定序）→ skill_key 次序稳定；键本身序无关紧要。
    for enable in sorted(enables, key=lambda e: (_skill_key_source_part(e.skill_key), e.skill_key)):
        source_id_str, sep, dir_name = enable.skill_key.partition(":")
        if not sep or not dir_name:
            log.warning("skill_bundle_invalid_skill_key_skipped", skill_key=enable.skill_key)
            continue
        try:
            source_id = uuid.UUID(source_id_str)
        except ValueError:
            log.warning("skill_bundle_invalid_skill_key_skipped", skill_key=enable.skill_key)
            continue
        source = source_map.get(source_id)
        if source is None:
            # 源已删除（绑定本应被 service 删源连带清理，容错）或已停用——跳过。
            continue
        # 安全发现根（H-1 纵深）：subdir 越界（存量脏数据）→ None，跳过该绑定，
        # 绝不把收集根引出 skills_git_cache。
        discovery_root = safe_discovery_root(source)
        if discovery_root is None:
            log.warning("skill_bundle_unsafe_subdir_skipped", skill_key=enable.skill_key)
            continue
        skill_dir = discovery_root / dir_name
        if not await asyncio.to_thread(skill_dir.is_dir):
            # 悬空绑定：目录不存在（刷新后技能目录消失）——跳过但绑定保留。
            log.warning("skill_bundle_dangling_binding_skipped", skill_key=enable.skill_key)
            continue
        origin = f"git:{source.id}"
        out.extend(
            (rel_path, content, origin)
            for rel_path, content in await asyncio.to_thread(
                _read_skill_dir_files, skill_dir, dir_name
            )
        )
    return out


def _skill_key_source_part(skill_key: str) -> str:
    """skill_key 的 source_id 段（无冒号/坏格式返回原串，排序容错不抛）。"""
    return skill_key.partition(":")[0]


def _dedup_by_top_dir(
    files: list[tuple[Path, bytes, str]],
) -> list[tuple[Path, bytes, str]]:
    """D-010 同名去重：按 rel_path 顶层目录先到先得，后到跳过 + log warn。

    入参顺序即优先级序（sillyspec-* → CustomSkill → git 源 source_id 升序，
    由 :func:`_gather_all_files` 拼接保证）；输出保序（首次出现位次）。同名
    静默覆盖的实证来自 skill-manager 扁平解压（Grill B-2），故后到者必须显式
    跳过并留痕。每个撞名顶层目录只 warn 一次。

    origin 标签区分来源粒度（``sillyspec`` / ``custom`` / ``git:<source_id>``）：
    仅当顶层目录已被**不同 origin** 占用时跳过——同一 origin 内的同名重复
    （如历史 CustomSkill 同名行）维持旧透传语义不动，零回归。
    """
    seen: dict[str, str] = {}
    warned: set[str] = set()
    out: list[tuple[Path, bytes, str]] = []
    for rel_path, content, origin in files:
        top = str(rel_path).replace("\\", "/").split("/")[0]
        prev_origin = seen.get(top)
        if prev_origin is not None and prev_origin != origin:
            if top not in warned:
                log.warning(
                    "skill_bundle_name_conflict_skipped",
                    skill=top,
                    kept_origin=prev_origin,
                    skipped_origin=origin,
                )
                warned.add(top)
            continue
        seen[top] = origin
        out.append((rel_path, content, origin))
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
    workspace_id: uuid.UUID | None = None,
) -> list[tuple[Path, bytes, str]]:
    """Combine three skill sources (deterministic order + D-010 name dedup).

    收集顺序即同名优先级（D-010）：codebase sillyspec-* → DB CustomSkill →
    user 启用的 git 缓存技能（source_id 升序）。各段内部已排序；拼接后经
    :func:`_dedup_by_top_dir` 按 rel_path 顶层目录先到先得去重（后到跳过 +
    log warn）。每个条目附带来源标记（sillyspec/custom/git，供 manifest 展示）。

    ``workspace_id`` 透传到 :func:`_collect_enabled_git_skills`（bridges
    task-01，D-002）：``None`` = user-only（显式 IS NULL），非 ``None`` =
    user ∪ workspace 并集。

    兼容保证：``session=None``（纯代码库）或无启用绑定时，git 段为空、DB 段
    为空/不变，输出与两源时代的 ``(rel_path, content)`` 序列逐字一致（version
    hash 不变，D-005）。
    """
    fs_files = await asyncio.to_thread(_collect_skill_files, skills_dir)
    db_files = await _collect_custom_skills(session, user_id)
    git_files = await _collect_enabled_git_skills(session, user_id, workspace_id)
    combined: list[tuple[Path, bytes, str]] = (
        [(rel_path, content, "sillyspec") for rel_path, content in fs_files]
        + [(rel_path, content, "custom") for rel_path, content in db_files]
        + git_files  # 已带 git:<source_id> origin 标签
    )
    return _dedup_by_top_dir(combined)


async def build_skills_manifest(
    skills_dir: Path | None = None,
    session: "AsyncSession | None" = None,
    user_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Scan ``skills_dir`` + DB ``CustomSkill`` rows and return a manifest dict.

    The manifest contains:

    * ``version`` — content-derived SHA-256 prefix (12 hex chars); empty string
      when no skills are found.
    * ``files`` — list of ``{path, sha256, source}`` entries, one per file
      (``source`` 为可选来源标记 sillyspec/custom/git，task-03；daemon 不消费)。
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

    task-03（D-010）：追加该 user ``user_skill_enables`` 命中的 git 缓存技能
    （第三源）；同名去重优先级 sillyspec-* > CustomSkill > git 源。

    bridges task-01（D-002/D-010）：可选 ``workspace_id`` 透传到收集层——
    ``None``（缺省）显式 ``workspace_id IS NULL`` 谓词（user-only，行为
    逐字不变）；非 ``None`` 渲染 user ∪ workspace 并集（daemon 端点接参归
    bridges task-04）。
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

    files = await _gather_all_files(skills_dir, session, user_id, workspace_id)
    if not files:
        return {"version": "", "files": [], "message": "未找到任何 sillyspec 技能"}

    # 兼容层：_compute_version / _summarize_skills 维持两元组形态（D-005 算法不动）。
    pair_files = [(rel_path, content) for rel_path, content, _origin in files]
    file_entries: list[dict[str, str]] = []
    for rel_path, content, origin in files:
        file_hash = hashlib.sha256(content).hexdigest()
        file_entries.append(
            {
                "path": str(rel_path).replace("\\", "/"),
                "sha256": file_hash,
                # task-03：可选来源标记（sillyspec/custom/git；git 的 origin 还带
                # source_id 后缀，对外统一截断成 "git"）——daemon 只消费
                # version/sha256，未知字段向后兼容零改动（design 兼容策略）。
                "source": origin.split(":", 1)[0],
            }
        )

    version = _compute_version(pair_files, skills_dir)
    skill_summaries = _summarize_skills(pair_files)
    return {"version": version, "files": file_entries, "skills": skill_summaries}


async def build_skills_bundle(
    skills_dir: Path | None = None,
    session: "AsyncSession | None" = None,
    user_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
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

    task-03（D-010）：追加该 user 启用的 git 缓存技能；tar 内顶层目录经
    同名去重后唯一。

    bridges task-01（D-002/D-010）：可选 ``workspace_id`` 透传到收集层——
    ``None``（缺省）user-only（显式 IS NULL），非 ``None`` user ∪ workspace
    并集；与 :func:`build_skills_manifest` 同口径。
    """
    if skills_dir is None:
        skills_dir = get_settings().skills_bundle_dir

    if not skills_dir.is_dir():
        return b""

    files = await _gather_all_files(skills_dir, session, user_id, workspace_id)
    if not files:
        return b""

    # 兼容层：_build_tar_gz 维持两元组形态；去重已在 _gather_all_files 完成。
    pair_files = [(rel_path, content) for rel_path, content, _origin in files]
    return await asyncio.to_thread(_build_tar_gz, pair_files)


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
