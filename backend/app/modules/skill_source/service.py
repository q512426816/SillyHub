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
- toggle_enable（task-03 本人写；bridges task-01 双 scope）：``skill_key`` 格式
  校验（422）→ 须命中 **启用源**的 discover_skills 结果（404）→ 绑定表
  upsert/delete 幂等；可选 ``workspace_id`` 切 workspace 维度（成员校验 403，
  谓词带 scope 不互删，D-010）。
- list_library（task-03）：三源聚合——平台 sillyspec-*（扫描 skills_bundle_dir）
  + 我的 CustomSkill + 全部 enabled 源的 discover_skills 实时发现（带我的
  启用态与源信息；git 技能默认关，D-003）；user 视图启用态显式 IS NULL
  过滤（D-010），可选 ``workspace_id`` 取 user ∪ workspace 并集（D-002）。
- 收编差集 helper（bridges task-03 / D-008）：``normalize_adopt_name`` 名
  归一化（目录名 → CustomSkill 合规名）+ ``platform_skill_names`` 平台库名
  全集（CustomSkill 全体名 ∪ sillyspec-* ∪ enabled git 源 discover——
  workspace 侧 adoptable 差集排除用，本模块只供数据不加端点）。
"""

from __future__ import annotations

import asyncio
import re
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
from app.modules.auth.model import User, UserWorkspaceRole
from app.modules.skill_source import git_fetcher
from app.modules.skill_source.model import SkillSource, UserSkillEnable
from app.modules.skill_source.schema import LibrarySkillItem, LibraryView, SourceRead
from app.modules.skills.model import CustomSkill

# ql-20260912-001：顶层导入 Workspace 会触发 workspace/__init__ → router →
# skills_view_service → 本模块 的循环导入（bridges task-03 引入，直接
# `import app.modules.skill_source.service` 即炸）。照 settings 模块 lazy import
# 先例下沉到唯一消费点（_require_workspace_member 的 session.get）。
log = get_logger(__name__)

# 缓存根约定（design 总体方案 / provides）：``<spec_data_root>/skills_git_cache/<source_id>/``。
# spec_data_root 下现有占用均为 ``{ws_id}``（UUID）子目录，固定名 skills_git_cache
# 不会与之冲突；跨平台路径一律 pathlib（CLAUDE.md 规则 13）。
SKILLS_GIT_CACHE_DIRNAME = "skills_git_cache"

# skill_key 列宽（user_skill_enables.skill_key String(200)）——超长即格式非法。
SKILL_KEY_MAX_LENGTH = 200

# 收编名归一化（bridges task-03 / D-008）——与 skills/service.py:35 的 CustomSkill
# name 规则逐字对齐（^[a-z0-9-]{2,40}$ + 禁 sillyspec- 前缀）。不直接 import
# skills/service 的私有符号：本模块只镜像规则，skills 模块零改动（蓝图约束）。
_ADOPT_NAME_RE = re.compile(r"^[a-z0-9-]{2,40}$")
_ADOPT_NAME_MAX_LENGTH = 40  # CustomSkill.name String(40) 同宽
_ADOPT_RESERVED_PREFIX = "sillyspec-"


def normalize_adopt_name(raw: str) -> tuple[str, str | None]:
    """收编名归一化（D-008）：目录名 → ``(normalized_name, invalid_reason)``。

    步骤：小写 → 非 ``[a-z0-9-]`` 字符转连字符 → 压连续连字符 → 去首尾连字符 →
    超 40 截断（截断可能新引入尾连字符，再去一次）。结果仍不满足 CustomSkill
    name 规则（空 / 单字符 / 命中保留前缀 ``sillyspec-``）时返回中文
    ``invalid_reason``（此时 ``normalized_name`` 为归一化产物，可能为空串，仅供
    响应展示，**不可落库**）；合规时 ``invalid_reason`` 为 ``None``。

    validity 与 :func:`app.modules.skills.service._validate_name` 完全同口径——
    invalid 项在 adopt 落库前必被跳过，绝不触发 422 炸整批（D-008）。
    """
    normalized = re.sub(r"[^a-z0-9-]+", "-", raw.lower())
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    normalized = normalized[:_ADOPT_NAME_MAX_LENGTH].strip("-")
    if not normalized:
        return normalized, "名称归一化后为空（目录名仅含非法字符），无法收编"
    if not _ADOPT_NAME_RE.match(normalized):
        return normalized, f"名称归一化后仍不满足 [a-z0-9-]{{2,40}}：{normalized!r}"
    if normalized.startswith(_ADOPT_RESERVED_PREFIX):
        return (
            normalized,
            f"归一化后命中保留前缀 {_ADOPT_RESERVED_PREFIX!r}，与平台内置技能命名空间冲突",
        )
    return normalized, None


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
            # 发现扫描走 to_thread（全树 os.walk+逐文件 stat，同步跑会阻塞事件
            # 循环）；发现根经 safe_discovery_root（subdir 非法跳过）。
            discover_root = safe_discovery_root(source)
            discovered = (
                await asyncio.to_thread(git_fetcher.discover_skills, discover_root)
                if discover_root is not None
                else []
            )
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


class WorkspaceScopeForbidden(AppError):
    """workspace 维度操作越权（403，R-02 service 二次校验）。

    涵盖：workspace 不存在 / 当前用户非该 workspace 成员——统一按「无权以
    workspace 维度操作」处理（存在性细节不外泄，与成员不足同口径）。
    """

    code = "skill_source.workspace_scope_forbidden"
    http_status = 403


class SkillSourceSubdirInvalid(AppError):
    """subdir 非法（422，防穿越：``..`` 段 / 绝对路径 / 盘符 / 反斜杠 / 控制字符 / 空段）。"""

    code = "skill_source.invalid_subdir"
    http_status = 422


class SkillSourceBranchInvalid(AppError):
    """branch 非法（422，防 git 选项注入：``-`` 前缀 / 反斜杠 / 控制字符 / 空白 / 空串）。"""

    code = "skill_source.invalid_branch"
    http_status = 422


# subdir/branch 共用的控制字符判定（含 NUL、换行、DEL）。
_CTRL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f]")
# Windows 盘符绝对路径（C:/x、C:\x）——pathlib 在 Windows 上会把它当绝对路径替换。
_DRIVE_LETTER_RE = re.compile(r"^[A-Za-z]:")


def validate_subdir(subdir: str) -> None:
    """subdir 防穿越校验（422）——发现根/收集根拼 ``缓存根 / subdir``，值域必须
    限定在仓库相对 posix 子路径：允许 ``a/b`` 嵌套，拒绝 ``..``/``.``/空段、
    绝对路径（前导 ``/``、盘符）、反斜杠（Windows 分隔歧义）与控制字符。
    """
    if subdir == "":
        raise SkillSourceSubdirInvalid("subdir 不能为空串——仓库根请传 null")
    if _CTRL_CHARS_RE.search(subdir):
        raise SkillSourceSubdirInvalid(f"subdir 含控制字符：{subdir!r}")
    if "\\" in subdir:
        raise SkillSourceSubdirInvalid(f"subdir 不能含反斜杠（分隔符仅支持 /）：{subdir!r}")
    if subdir.startswith("/") or _DRIVE_LETTER_RE.match(subdir):
        raise SkillSourceSubdirInvalid(f"subdir 不能是绝对路径：{subdir!r}")
    bad_segments = [s for s in subdir.split("/") if s in ("", ".", "..")]
    if bad_segments:
        raise SkillSourceSubdirInvalid(
            f"subdir 含空段或 .. 段（不允许逃出仓库）：{subdir!r}",
        )


def validate_branch(branch: str) -> None:
    """branch 防选项注入校验（422）——fetch 侧 branch 是位置参数（refspec 位），
    ``-`` 前缀值会被 git parse-options 当选项（如 ``--recurse-submodules`` 可拉
    .gitmodules 里攻击者控制的 URL）；反斜杠/控制字符/空白对 git ref 名同样非法。
    """
    if (
        branch == ""
        or branch.startswith("-")
        or "\\" in branch
        or _CTRL_CHARS_RE.search(branch)
        or any(ch.isspace() for ch in branch)
    ):
        raise SkillSourceBranchInvalid(
            f"branch 非法（不允许 - 前缀 / 反斜杠 / 控制字符 / 空白 / 空串）：{branch!r}"
        )


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


def safe_discovery_root(source: SkillSource) -> Path | None:
    """源的技能发现根：``缓存根/[subdir]``；subdir 非法或逃出缓存根 → None。

    纵深防御（H-1）：保存口 :func:`validate_subdir` 已 422 拦新值，但存量行 /
    手工改库仍可能带越界 subdir——所有读路径（library 聚合、enable 校验、
    bundle 收集）统一经本函数取根，None 即跳过该源并 warn，绝不把发现/收集
    引出缓存目录。subdir 为空 = 缓存根本身（恒安全）。
    """
    cache_dir = source_cache_dir(source.id)
    if not source.subdir:
        return cache_dir
    try:
        validate_subdir(source.subdir)
    except SkillSourceSubdirInvalid as exc:
        log.warning(
            "skill_source_subdir_invalid_skipped",
            source_id=str(source.id),
            error=str(exc),
        )
        return None
    root = cache_dir / source.subdir
    # 双保险：格式合法仍以 resolve 后的包含关系兜底（防空串段绕过类残余）。
    if not root.resolve().is_relative_to(cache_dir.resolve()):
        log.warning(
            "skill_source_subdir_escapes_cache_skipped",
            source_id=str(source.id),
            subdir=source.subdir,
        )
        return None
    return root


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
        """创建源（SSRF await + git 探测 + url 查重 + branch/subdir 校验，保存即触发拉取）。"""
        # SSRF 校验（async——显式 await，plan-review 修正点）：私网/非法 scheme
        # 抛 UnsafeRepoUrl/SsrfBlocked（400）直接透传给全局异常处理器。
        await git_fetcher.assert_source_url(url)
        validate_branch(branch)
        if subdir is not None:
            validate_subdir(subdir)
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
            validate_branch(branch)
            source.branch = branch
        if subdir is not None:
            validate_subdir(subdir)
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
        """手动刷新（admin）：SSRF 复查 + git 探测 + 真实拉取 + 回写 last_* 字段。

        SSRF 复查（M-5）：保存时校验一次不足以防保存后 DNS rebinding 到内网
        （core/ssrf 基线承诺「每次调用重新解析」，webhook/http_get 每跳复查）——
        refresh 是唯一不经 create/update 的拉取入口，拉取前对当前 url 重跑
        :func:`assert_source_url`，域已 rebinding 到私网 → 400 fail-loud。
        """
        source = await self.get(source_id)
        await git_fetcher.assert_source_url(source.url)
        await self._require_git_binary()
        await _trigger_fetch(self._session, source)
        return source

    # ── 技能库 + 启用绑定（task-03；workspace 双 scope 归 bridges task-01）──

    async def toggle_enable(
        self,
        skill_key: str,
        user: User,
        *,
        enabled: bool,
        workspace_id: uuid.UUID | None = None,
    ) -> None:
        """启用/停用一个 git 技能（``user_skill_enables`` upsert/delete，幂等）。

        双 scope（D-003 单表双 scope，缺省 ``workspace_id=None`` = user 维度）：

        - **user 维度**（旧行为逐字不变）：删除/查重谓词显式带
          ``workspace_id IS NULL``（D-010——ws 行不混入，删 user 维度不误删
          ws 绑定，反之亦然）；``user_id`` 为本人。
        - **workspace 维度**：先校验 workspace 表存在 + 当前用户是成员
          （R-02 二次校验，403），删除/查重谓词按 ``workspace_id == :w``
          （共享绑定，任何成员可停用）；upsert 行 ``user_id`` 填操作者审计。

        - 格式校验（:func:`parse_skill_key`）→ 422；
        - ``enabled=True``：skill_key 须命中**启用源**的 discover_skills 结果
          （防手拼垃圾 key；源不存在/停用/目录消失统一 404）；绑定已存在则
          幂等返回（双 partial unique 兜底并发）；
        - ``enabled=False``：删绑定，无绑定也幂等成功（悬空语义归收集层，
          停用不校验技能存在性——技能已消失也允许收回启用态）。
        """
        source_id, dir_name = parse_skill_key(skill_key)

        if workspace_id is not None:
            await self._require_workspace_member(user, workspace_id)

        # D-010 删除/查重谓词带 scope：user 维度 IS NULL（不误删 ws 行），
        # workspace 维度按 :w（user_id 不入谓词——共享绑定任意成员可停）。
        if workspace_id is None:
            scope_predicate = (
                UserSkillEnable.user_id == user.id,
                UserSkillEnable.skill_key == skill_key,
                UserSkillEnable.workspace_id.is_(None),
            )
        else:
            scope_predicate = (
                UserSkillEnable.skill_key == skill_key,
                UserSkillEnable.workspace_id == workspace_id,
            )

        if not enabled:
            await self._session.execute(delete(UserSkillEnable).where(*scope_predicate))
            await self._session.commit()
            return

        source = await self._session.get(SkillSource, source_id)
        if source is None or not source.enabled:
            raise SkillNotDiscoverable(
                f"技能不可启用（源不存在或已停用）：{skill_key!r}",
                details={"skill_key": skill_key},
            )
        discovery_root = safe_discovery_root(source)
        if discovery_root is None:
            # subdir 越界（存量脏数据纵深拦截）——该源整体不可启用。
            raise SkillNotDiscoverable(
                f"技能源 subdir 非法（越界），不可启用：{skill_key!r}",
                details={"skill_key": skill_key, "source_id": str(source_id)},
            )
        discovered_names = {
            d.name for d in await asyncio.to_thread(git_fetcher.discover_skills, discovery_root)
        }
        if dir_name not in discovered_names:
            raise SkillNotDiscoverable(
                f"技能不存在于该源当前发现结果：{skill_key!r}",
                details={"skill_key": skill_key, "source_id": str(source_id)},
            )

        existing = await self._session.execute(select(UserSkillEnable).where(*scope_predicate))
        if existing.scalars().first() is not None:
            return  # 幂等：重复启用为 no-op

        # workspace 行 user_id 填操作者（审计）；user 维度 workspace_id=None。
        self._session.add(
            UserSkillEnable(user_id=user.id, skill_key=skill_key, workspace_id=workspace_id)
        )
        try:
            await self._session.commit()
        except IntegrityError:
            # 并发重复启用：scope partial unique 兜底，视为已启用。
            await self._session.rollback()

    async def list_library(
        self,
        user: User,
        *,
        workspace_id: uuid.UUID | None = None,
    ) -> LibraryView:
        """技能库三源聚合 + 启用态（design §接口定义 list_library）。

        1. 平台内置 sillyspec-*——扫 ``skills_bundle_dir`` 下 ``sillyspec-*``
           目录（name + SKILL.md description），恒启用不可 toggle；
        2. 我的 CustomSkill——本人 ``created_by`` 行（name + description），恒启用；
        3. git 技能——全部 **enabled** 源的 discover_skills **实时发现**（结果不
           落库，D-006 保存/刷新即拉取），带启用态（默认 False，D-003）与
           源信息；disabled 源不参与（R-05）。

        启用态口径（D-010）：缺省 user 视图只看 ``user_id=本人 AND
        workspace_id IS NULL``（ws 行不污染）；传 ``workspace_id`` 时校验
        成员后取并集（user 绑定 ∪ 该 workspace 绑定，D-002 注入同口径）。
        """
        sources = await self.list_()

        # D-010：显式 IS NULL——workspace 维度行不混入 user 视图启用态。
        enable_filter = (UserSkillEnable.user_id == user.id) & (
            UserSkillEnable.workspace_id.is_(None)
        )
        if workspace_id is not None:
            await self._require_workspace_member(user, workspace_id)
            # D-002 并集：user 绑定 ∪ 该 workspace 绑定（ws 行不限 user_id）。
            enable_filter = enable_filter | (UserSkillEnable.workspace_id == workspace_id)
        enabled_keys = set(
            (await self._session.execute(select(UserSkillEnable.skill_key).where(enable_filter)))
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
            discovery_root = safe_discovery_root(source)
            if discovery_root is None:
                continue  # subdir 越界（存量脏数据纵深拦截）——该源不参与发现
            for discovered in await asyncio.to_thread(git_fetcher.discover_skills, discovery_root):
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

    async def platform_skill_names(self) -> set[str]:
        """平台技能库名全集（bridges task-03 / D-008 差集三源排除用）。

        = CustomSkill **全体名**（DB 不限 owner——任何用户已建/已收编的同名技能
        都要让位，防止跨用户重复收编同名）∪ sillyspec-*（``skills_bundle_dir``
        文件扫描）∪ 全部 **enabled** 源的 discover_skills 实时发现（管理员视角
        不带 user，与 ``list_library`` 第三源同口径；disabled 源不参与，R-05）。

        消费方：workspace ``list_adoptable`` 差集（specDir 目录名 − 本集合 −
        ``sillyspec-`` 前缀）。纯读（DB 名列 + 文件系统扫描），不落任何状态。
        """
        names: set[str] = set(
            (await self._session.execute(select(CustomSkill.name))).scalars().all()
        )
        names.update(
            p.name for p in get_settings().skills_bundle_dir.glob(SKILLS_GLOB) if p.is_dir()
        )
        for source in await self.list_():
            if not source.enabled:
                continue
            discovery_root = safe_discovery_root(source)
            if discovery_root is None:
                continue  # subdir 越界（存量脏数据纵深拦截）——该源不参与差集
            names.update(
                d.name for d in await asyncio.to_thread(git_fetcher.discover_skills, discovery_root)
            )
        return names

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
        # rmtree_force：Windows 上 git 只读对象需去只读重试，否则残留非空目录
        # 卡死同名重建。
        git_fetcher.rmtree_force(source_cache_dir(source.id))

    # ── helpers ───────────────────────────────────────────────────────

    async def _require_workspace_member(self, user: User, workspace_id: uuid.UUID) -> None:
        """workspace 维度二次校验（R-02）：表存在 + 当前用户是成员，否则 403。

        成员判定走 RBAC 表 ``user_workspace_roles`` 存在性查询（profile service
        ``_is_workspace_member`` 同款——任意角色行即视为 member，不关心权限粒度；
        细粒度 WORKSPACE_WRITE 域门在后续 workspace 端点卡片）。
        """
        from app.modules.workspace.model import (
            Workspace,
        )

        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None:
            raise WorkspaceScopeForbidden(
                f"workspace 不存在或无权访问：{workspace_id}",
                details={"workspace_id": str(workspace_id)},
            )
        stmt = (
            select(UserWorkspaceRole.user_id)
            .where(UserWorkspaceRole.user_id == user.id)
            .where(UserWorkspaceRole.workspace_id == workspace_id)
            .limit(1)
        )
        if (await self._session.execute(stmt)).scalars().first() is None:
            raise WorkspaceScopeForbidden(
                f"当前用户不是该 workspace 成员：{workspace_id}",
                details={"workspace_id": str(workspace_id)},
            )

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
