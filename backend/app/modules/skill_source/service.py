"""SkillSource CRUD 业务逻辑 + SSRF/git 探测门 + 删除连带清理。

Change: 2026-09-11-skills-central-library (task-01)

职责（design §接口定义 / task-01 implementation）:
- create/update：``await assert_public_url(url)``（core/ssrf.py:34-53 为
  **async**——必须显式 await，漏 await 只建 coroutine 不校验；私网/非法
  scheme → UnsafeRepoUrl/SsrfBlocked 400 直接透传）。
- create/refresh：git 二进制探测（R-01）——本卡 ``shutil.which("git")``
  初判，缺 → :class:`GitBinaryMissing` 422；task-02 ``probe_git_binary``
  统一后替换接线。
- 保存即触发拉取（design D-006）：``_trigger_fetch`` 为接线点占位——task-02
  的 git_fetcher 未落地，ImportError 容忍 no-op；落地后失败写 last_error
  不阻塞保存请求。
- delete：连带清该源 user_skill_enables（skill_key 前缀 ``<source_id>:``
  匹配）+ 缓存目录 best-effort（目录可不存在）。
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
from app.core.ssrf import assert_public_url
from app.modules.skill_source.model import SkillSource, UserSkillEnable

log = get_logger(__name__)

# 缓存根约定（design 总体方案 / provides）：``<spec_data_root>/skills_git_cache/<source_id>/``。
# spec_data_root 下现有占用均为 ``{ws_id}``（UUID）子目录，固定名 skills_git_cache
# 不会与之冲突；跨平台路径一律 pathlib（CLAUDE.md 规则 13）。
SKILLS_GIT_CACHE_DIRNAME = "skills_git_cache"


def skills_git_cache_root() -> Path:
    """git 技能缓存根目录（``<spec_data_root>/skills_git_cache``）。"""
    return Path(get_settings().spec_data_root) / SKILLS_GIT_CACHE_DIRNAME


def source_cache_dir(source_id: uuid.UUID) -> Path:
    """单个源的缓存目录：``skills_git_cache/<source_id>/``（task-02 fetcher 消费）。"""
    return skills_git_cache_root() / str(source_id)


def _git_binary_available() -> bool:
    """git 二进制探测（R-01）——本卡 shutil.which 初判，跨平台不硬编码路径。"""
    return shutil.which("git") is not None


def _trigger_fetch(source: SkillSource) -> None:
    """保存/刷新即触发拉取的接线点占位（design §接口定义：失败不阻塞）。

    task-02 的 git_fetcher 尚未落地——模块缺失时 ImportError 容忍 no-op。
    """
    try:
        # task-02 落地后：此 import 命中即改为异步触发
        # ``fetch_source(source, source_cache_dir(source.id))``，结果回写
        # last_commit/last_fetched_at/last_error（失败不阻塞调用方）。
        from app.modules.skill_source import git_fetcher  # noqa: F401
    except ImportError:
        return


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


class SkillSourceService:
    """skill_sources 的 admin CRUD 业务层（router 薄封装转调，权限门在 router）。"""

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
        """创建源（SSRF await + git 探测 + url 查重，保存即触发拉取占位）。"""
        # SSRF 校验（async——显式 await，plan-review 修正点）：私网/非法 scheme
        # 抛 UnsafeRepoUrl/SsrfBlocked（400）直接透传给全局异常处理器。
        await assert_public_url(url)
        self._require_git_binary()

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

        # 保存即触发拉取（task-02 接线点；失败不阻塞——见 _trigger_fetch）。
        _trigger_fetch(source)
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
            await assert_public_url(url)
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
            _trigger_fetch(source)
        return source

    async def refresh(self, source_id: uuid.UUID) -> SkillSource:
        """手动刷新（admin）：git 探测 + 触发拉取占位（task-02 落真实 fetch）。"""
        source = await self.get(source_id)
        self._require_git_binary()
        _trigger_fetch(source)
        # task-02 接线后：fetch 结果回写 last_commit/last_fetched_at/last_error
        # 并 commit；本卡占位直接返回当前状态。
        return source

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
    def _require_git_binary() -> None:
        """git 二进制探测门（create/refresh 前调，缺 → 422 明确提示，R-01）。"""
        if not _git_binary_available():
            raise GitBinaryMissing(
                "当前部署环境缺少 git 可执行文件，无法保存/刷新 git 技能源，请先安装 git。",
                details={"hint": "shutil.which('git') 未找到 git 二进制"},
            )
