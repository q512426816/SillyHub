"""SkillSource CRUD + 技能库聚合/启用绑定（task-03）+ SSRF/git 探测门 + 拉取接线。

Change: 2026-09-11-skills-central-library (task-01 + task-02 接线 + task-03)

职责（design §接口定义 / task-03 taskcard）:
- create/update 改 url：``await git_fetcher.assert_source_url(url)``（SSRF
  首防线封装，委托 core/ssrf 的 **async** ``assert_public_url``——必须显式
  await，漏 await 只建 coroutine 不校验；私网/非法 scheme →
  UnsafeRepoUrl/SsrfBlocked 400 直接透传）。
- create/refresh：git 二进制探测统一走 ``await git_fetcher.probe_git_binary()``
  （which 初判 + ``git --version`` 子进程确认，R-01），缺 →
  :class:`GitBinaryMissing` 422（替换 task-01 的 shutil.which 初判，语义不变）。
- 保存即触发拉取（design D-006）：``_trigger_fetch`` 实调
  ``git_fetcher.fetch_source``——成功回写 last_commit/last_fetched_at 并清
  last_error；失败记 last_error（成功回写字段保留，描述最近一次成功）。
  整体 best-effort **永不抛**，不阻塞保存请求（HTTP 仍 2xx）。
- delete：连带清该源 user_skill_enables（skill_key 前缀 ``<source_id>:``
  匹配）+ 缓存目录 best-effort（目录可不存在）。
- toggle_enable（task-03，本人写）：``skill_key`` 格式校验（422）→ 须命中
  **启用源**的 discover_skills 结果（404）→ 绑定表 upsert/delete 幂等。
- list_library（task-03）：三源聚合——平台 sillyspec-*（扫描 skills_bundle_dir）
  + 我的 CustomSkill + 全部 enabled 源的 discover_skills 实时发现（带我的
  启用态与源信息；git 技能默认关，D-003）。
"""

from __future__ import annotations

import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.agent.skills_bundle_service import SKILLS_GLOB, _parse_skill_frontmatter
from app.modules.auth.model import User
from app.modules.skill_source import git_fetcher
from app.modules.skill_source.model import SkillSource, UserSkillEnable
from app.modules.skill_source.schema import LibrarySkillItem, LibraryView, SourceRead
from app.modules.skills.model import CustomSkill

log = get_logger(__name__)

# 缓存根约定（design 总体方案 / provides）：``<spec_data_root>/skills_git_cache/<source_id>/``。
# spec_data_root 下现有占用均为 ``{ws_id}``（UUID）子目录，固定名 skills_git_cache
# 不会与之冲突；跨平台路径一律 pathlib（CLAUDE.md 规则 13）。
SKILLS_GIT_CACHE_DIRNAME = "skills_git_cache"

# skill_key 列宽（user_skill_enables.skill_key String(200)）——超长即格式非法。
SKILL_KEY_MAX_LENGTH = 200


def skills_git_cache_root() -> Path:
    """git 技能缓存根目录（``<spec_data_root>/skills_git_cache``）。"""
    return Path(get_settings().spec_data_root) / SKILLS_GIT_CACHE_DIRNAME


def source_cache_dir(source_id: uuid.UUID) -> Path:
    """单个源的缓存目录：``skills_git_cache/<source_id>/``（task-02 fetcher 消费）。"""
    return skills_git_cache_root() / str(source_id)


async def _trigger_fetch(session: AsyncSession, source: SkillSource) -> None:
    """保存/刷新即触发拉取 + 回写（design §接口定义：失败不阻塞，**永不抛**）。

    - 成功：last_commit/last_fetched_at 回写、last_error 清空。
    - 失败：last_error 记原因（last_commit/last_fetched_at 保留——描述最近
      一次成功拉取，便于区分「从未成功」与「上次成功这次失败」）。
    - 拉取成功后顺带跑一次发现（subdir 非空时以缓存根下 subdir 为发现根，
      taskcard D-006）——验证性扫描 + 日志计数，结果不落库（library 端点
      task-03 实时发现）。
    """
    cache_dir = source_cache_dir(source.id)
    try:
        result = await git_fetcher.fetch_source(source, cache_dir)
        if result.ok:
            source.last_commit = result.commit
            source.last_fetched_at = datetime.now(UTC)
            source.last_error = None
        else:
            source.last_error = result.error
        await session.commit()
        if result.ok:
            discover_root = cache_dir / source.subdir if source.subdir else cache_dir
            discovered = git_fetcher.discover_skills(discover_root)
            log.info(
                "skill_source_fetch_done",
                source_id=str(source.id),
                commit=result.commit,
                discovered=len(discovered),
            )
    except Exception as exc:  # best-effort：拉取/回写失败不阻塞保存请求
        log.warning("skill_source_fetch_trigger_failed", source_id=str(source.id), error=str(exc))


class SkillSourceNotFound(AppError):
    """技能源不存在（404）。"""

    code = "skill_source.not_found"
    http_status = 404


class SkillSourceUrlConflict(AppError):
    """url 已存在（409）。"""

    code = "skill_source.url_conflict"
    http_status = 409


class GitBinaryMissing(AppError):
    """部署环境缺 git 二进制（422，R-01/兼容策略：源保存明确报错）。"""

    code = "skill_source.git_binary_missing"
    http_status = 422


class InvalidSkillKey(AppError):
    """skill_key 格式非法（422，task-03：须为 ``<source_id>:<目录名>``）。"""

    code = "skill_source.invalid_skill_key"
    http_status = 422


class SkillNotDiscoverable(AppError):
    """skill_key 未命中启用源的 discover_skills 结果（404，task-03）。

    涵盖：源不存在 / 源已停用 / 缓存目录未拉取或技能目录已消失——统一按
    「当前不可启用」处理（enable 侧防手拼垃圾 key；悬空绑定跳过在收集层）。
    """

    code = "skill_source.skill_not_discoverable"
    http_status = 404


def parse_skill_key(skill_key: str) -> tuple[uuid.UUID, str]:
    """解析 ``<source_id>:<目录名>`` → ``(source_id, 目录名)``；非法抛 422。

    格式契约（model.py 模块 docstring / task-03 taskcard）：恰好一个冒号分隔，
    source_id 须为 UUID、目录名非空且不含路径分隔符（防穿越）。
    """
    source_part, sep, dir_part = skill_key.partition(":")
    if (
        not sep
        or not source_part
        or not dir_part
        or len(skill_key) > SKILL_KEY_MAX_LENGTH
        or "/" in dir_part
        or "\\" in dir_part
    ):
        raise InvalidSkillKey(
            f"skill_key 格式非法：{skill_key!r}（应为 <source_id>:<目录名>）",
            details={"skill_key": skill_key},
        )
    try:
        source_id = uuid.UUID(source_part)
    except ValueError as exc:
        raise InvalidSkillKey(
            f"skill_key 的 source_id 段不是合法 UUID：{skill_key!r}",
            details={"skill_key": skill_key},
        ) from exc
    return source_id, dir_part


def _discovery_root(source: SkillSource) -> Path:
    """源的技能发现根：``缓存根/[subdir]``（task-02 _trigger_fetch 同口径）。"""
    cache_dir = source_cache_dir(source.id)
    return cache_dir / source.subdir if source.subdir else cache_dir


def _sillyspec_description(skill_dir: Path) -> str:
    """平台 sillyspec-* 技能目录的 description（SKILL.md frontmatter，容错空串）。"""
    try:
        frontmatter = _parse_skill_frontmatter((skill_dir / "SKILL.md").read_bytes())
    except OSError:
        return ""
    return frontmatter.get("description", "")


class SkillSourceService:
    """skill_sources admin CRUD + 技能库/启用绑定业务层（router 薄封装转调，权限门在 router）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 查询 ──────────────────────────────────────────────────────────

    async def list_(self) -> list[SkillSource]:
        """全部源列表（按 created_at asc，源稳定序供收集遍历）。"""
        stmt = select(SkillSource).order_by(SkillSource.created_at.asc(), SkillSource.id.asc())
        return list((await self._session.execute(stmt)).scalars().all())

    async def get(self, source_id: uuid.UUID) -> SkillSource:
        """按 id 取源，不存在抛 :class:`SkillSourceNotFound`（404）。"""
        source = await self._session.get(SkillSource, source_id)
        if source is None:
            raise SkillSourceNotFound(
                f"技能源不存在：{source_id}",
                details={"source_id": str(source_id)},
            )
        return source

    # ── 写入 ──────────────────────────────────────────────────────────

    async def create(
        self,
        *,
        url: str,
        branch: str = "main",
        subdir: str | None = None,
    ) -> SkillSource:
        """创建源（SSRF await + git 探测 + url 查重，保存即触发拉取）。"""
        # SSRF 校验（async——显式 await，plan-review 修正点）：私网/非法 scheme
        # 抛 UnsafeRepoUrl/SsrfBlocked（400）直接透传给全局异常处理器。
        await git_fetcher.assert_source_url(url)
        await self._require_git_binary()

        existing = await self._get_by_url(url)
        if existing is not None:
            raise SkillSourceUrlConflict(
                f"技能源 URL 已存在：{url!r}",
                details={"url": url, "conflict_id": str(existing.id)},
            )

        source = SkillSource(url=url, branch=branch, subdir=subdir)
        self._session.add(source)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            # 并发场景兜底：检查与 commit 之间被插入同 url 记录。
            await self._session.rollback()
            raise SkillSourceUrlConflict(
                f"技能源 URL 已存在（并发）：{url!r}",
                details={"url": url},
            ) from exc
        await self._session.refresh(source)

        # 保存即触发拉取（task-02 接线；失败不阻塞——见 _trigger_fetch）。
        await _trigger_fetch(self._session, source)
        return source

    async def update(
        self,
        source_id: uuid.UUID,
        *,
        url: str | None = None,
        branch: str | None = None,
        subdir: str | None = None,
        enabled: bool | None = None,
    ) -> SkillSource:
        """部分更新（改 url 时重新过 SSRF 校验 + 查重；url/branch 变更重触发拉取）。"""
        source = await self.get(source_id)
        if url is not None and url != source.url:
            await git_fetcher.assert_source_url(url)
            existing = await self._get_by_url(url)
            if existing is not None and existing.id != source.id:
                raise SkillSourceUrlConflict(
                    f"技能源 URL 已存在：{url!r}",
                    details={"url": url, "conflict_id": str(existing.id)},
                )
            source.url = url
        if branch is not None:
            source.branch = branch
        if subdir is not None:
            source.subdir = subdir
        if enabled is not None:
            source.enabled = enabled

        source.updated_at = datetime.now(UTC)
        self._session.add(source)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise SkillSourceUrlConflict(
                f"技能源 URL 已存在（并发）：{source.url!r}",
                details={"url": source.url},
            ) from exc
        await self._session.refresh(source)

        if url is not None or branch is not None:
            await _trigger_fetch(self._session, source)
        return source

    async def refresh(self, source_id: uuid.UUID) -> SkillSource:
        """手动刷新（admin）：git 探测 + 真实拉取 + 回写 last_* 字段。"""
        source = await self.get(source_id)
        await self._require_git_binary()
        await _trigger_fetch(self._session, source)
        return source

    # ── 技能库 + 启用绑定（task-03）──────────────────────────────────

    async def toggle_enable(self, skill_key: str, user: User, *, enabled: bool) -> None:
        """本人启用/停用一个 git 技能（``user_skill_enables`` upsert/delete，幂等）。

        - 格式校验（:func:`parse_skill_key`）→ 422；
        - ``enabled=True``：skill_key 须命中**启用源**的 discover_skills 结果
          （taskcard 权威——防手拼垃圾 key；源不存在/停用/目录消失统一 404）；
          绑定已存在则幂等返回（UNIQUE(user_id, skill_key) 兜底并发）；
        - ``enabled=False``：删绑定，无绑定也幂等成功（悬空语义归收集层，
          停用不校验技能存在性——技能已消失也允许收回启用态）。
        """
        source_id, dir_name = parse_skill_key(skill_key)

        if not enabled:
            await self._session.execute(
                delete(UserSkillEnable).where(
                    UserSkillEnable.user_id == user.id,
                    UserSkillEnable.skill_key == skill_key,
                )
            )
            await self._session.commit()
            return

        source = await self._session.get(SkillSource, source_id)
        if source is None or not source.enabled:
            raise SkillNotDiscoverable(
                f"技能不可启用（源不存在或已停用）：{skill_key!r}",
                details={"skill_key": skill_key},
            )
        discovered_names = {d.name for d in git_fetcher.discover_skills(_discovery_root(source))}
        if dir_name not in discovered_names:
            raise SkillNotDiscoverable(
                f"技能不存在于该源当前发现结果：{skill_key!r}",
                details={"skill_key": skill_key, "source_id": str(source_id)},
            )

        existing = await self._session.execute(
            select(UserSkillEnable).where(
                UserSkillEnable.user_id == user.id,
                UserSkillEnable.skill_key == skill_key,
            )
        )
        if existing.scalars().first() is not None:
            return  # 幂等：重复启用为 no-op

        self._session.add(UserSkillEnable(user_id=user.id, skill_key=skill_key))
        try:
            await self._session.commit()
        except IntegrityError:
            # 并发重复启用：UNIQUE(user_id, skill_key) 兜底，视为已启用。
            await self._session.rollback()

    async def list_library(self, user: User) -> LibraryView:
        """技能库三源聚合 + 我的启用态（design §接口定义 list_library）。

        1. 平台内置 sillyspec-*——扫 ``skills_bundle_dir`` 下 ``sillyspec-*``
           目录（name + SKILL.md description），恒启用不可 toggle；
        2. 我的 CustomSkill——本人 ``created_by`` 行（name + description），恒启用；
        3. git 技能——全部 **enabled** 源的 discover_skills **实时发现**（结果不
           落库，D-006 保存/刷新即拉取），带我的启用态（默认 False，D-003）与
           源信息；disabled 源不参与（R-05）。
        """
        sources = await self.list_()
        enabled_keys = set(
            (
                await self._session.execute(
                    select(UserSkillEnable.skill_key).where(UserSkillEnable.user_id == user.id)
                )
            )
            .scalars()
            .all()
        )

        skills: list[LibrarySkillItem] = []

        # 1. 平台内置 sillyspec-*（文件系统扫描，全局共享与 user 无关）
        for skill_dir in sorted(get_settings().skills_bundle_dir.glob(SKILLS_GLOB)):
            if not skill_dir.is_dir():
                continue
            skills.append(
                LibrarySkillItem(
                    skill_key=skill_dir.name,
                    name=skill_dir.name,
                    description=_sillyspec_description(skill_dir),
                    source="sillyspec",
                    enabled=True,
                )
            )

        # 2. 我的 CustomSkill（per-user，恒在本人 bundle 内）
        custom_rows = (
            (
                await self._session.execute(
                    select(CustomSkill)
                    .where(CustomSkill.created_by == user.id)
                    .order_by(CustomSkill.name)
                )
            )
            .scalars()
            .all()
        )
        for row in custom_rows:
            skills.append(
                LibrarySkillItem(
                    skill_key=row.name,
                    name=row.name,
                    description=row.description or "",
                    source="custom",
                    enabled=True,
                )
            )

        # 3. git 技能（enabled 源实时发现；顺序=list_ 的 created_at asc 稳定序）
        for source in sources:
            if not source.enabled:
                continue
            for discovered in git_fetcher.discover_skills(_discovery_root(source)):
                skill_key = f"{source.id}:{discovered.name}"
                skills.append(
                    LibrarySkillItem(
                        skill_key=skill_key,
                        name=discovered.name,
                        description=discovered.description,
                        source="git",
                        enabled=skill_key in enabled_keys,
                        source_id=source.id,
                    )
                )

        return LibraryView(
            sources=[SourceRead.model_validate(s) for s in sources],
            skills=skills,
        )

    async def delete(self, source_id: uuid.UUID) -> None:
        """删除源——连带清该源 user_skill_enables（前缀匹配）+ 缓存目录 best-effort。

        绑定按 skill_key 前缀 ``<source_id>:`` 匹配清理（skill_key 刻意不做 FK，
        见 model.py 模块 docstring）；缓存目录不存在时静默跳过（兼容策略：
        源删除 → 技能从 bundle 消失 → version 变化 → daemon 重拉，链路自洽）。
        """
        source = await self.get(source_id)
        prefix = f"{source.id}:"
        await self._session.execute(
            delete(UserSkillEnable).where(UserSkillEnable.skill_key.startswith(prefix))
        )
        await self._session.delete(source)
        await self._session.commit()

        # 缓存目录清理 best-effort：目录可能从未拉取过（task-02 前必不存在）。
        shutil.rmtree(source_cache_dir(source.id), ignore_errors=True)

    # ── helpers ───────────────────────────────────────────────────────

    async def _get_by_url(self, url: str) -> SkillSource | None:
        stmt = select(SkillSource).where(SkillSource.url == url)
        return (await self._session.execute(stmt)).scalars().first()

    @staticmethod
    async def _require_git_binary() -> None:
        """git 二进制探测门（create/refresh 前调，缺 → 422 明确提示，R-01）。"""
        if not await git_fetcher.probe_git_binary():
            raise GitBinaryMissing(
                "当前部署环境缺少 git 可执行文件，无法保存/刷新 git 技能源，请先安装 git。",
                details={
                    "hint": "probe_git_binary 探测失败（shutil.which 未找到或 git --version 异常）"
                },
            )
