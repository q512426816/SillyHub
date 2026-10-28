"""会话 ↔ 变更/快速修复 绑定基座（change 2026-08-25-session-spec-binding task-02）。

design §5 W1.3 / §7：命令解析（``extract_spec_bindings``）+ 两个幂等 best-effort
bind 函数，供 W2 检测写入口（run_sync 命令解析 / platform_sync agent-logs 两分支）
复用（D-003@v1 双通道）。本模块不接线任何调用方（task-05/06/08 落）。

- 解析规则：``sillyspec run quick`` 子命令无产出（其 ``--change`` 值是 CLI 内部
  quick 会话 id，D-004@v1）；其余 ``run`` 阶段支持 ``--change <名>``（空格）与
  ``--change=<名>``（等号）两形式；``名 == "default"`` 跳过（D-005@v2 解析层
  第一道）；progress/status/archive 等非 run 子命令无产出。
- thin（2026-09-25-change-center-thin-flow task-04）：``sillyspec flow
  start|done|amend-draft --change <名>`` 同样产出变更绑定——thin 派发会话的
  变更绑定**唯一**依靠本命令解析通道（派发链全程不写 change_session_links）。
- bind 事务口径：**不自行 commit**（跟随调用方事务），savepoint
  （``begin_nested``）+ flush 落行，失败仅 ``log.warning`` 不抛（best-effort
  风格；reparse 建行时的自动绑定已移除，2026-10-13-change-reparse-autobind-remove，
  本模块命令解析通道是变更-会话绑定的唯一自动来源）。
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.agent.tool_kind import iter_command_segments
from app.modules.change.model import Change, ChangeSessionLink, QuicklogSessionLink

log = get_logger(__name__)

# D-005@v2：CLI 无名操作伪键。绑定会污染变更列表（placeholder 行），解析层与
# bind_session_to_change 内部双道守卫统一跳过。
DEFAULT_CHANGE_KEY = "default"

# 2026-10-27-ghost-spec-binding-fix：CLI 对新变更名强制日期前缀（flow start 入口
# 校验，缺前缀 exit 2 拒绝——「新变更名必须形如 YYYY-MM-DD-<简短描述>」，已存在
# 的旧名变更不受影响）。查库未命中且名字不带此前缀 = 命令必被 CLI 拒绝，绑定通道
# 禁止为其建 placeholder（幽灵占位根因防护：失败命令的占位行永远无文件接管，
# 会话弹窗「进行中」长期残留实证）。校验放 bind 函数而非解析函数：纯解析查不了
# 库，无法区分「旧名已有行（合法绑定）」与「无前缀必被拒」。
_DATED_CHANGE_KEY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-")

# 段首收紧（D-002@v1）后允许 sillyspec 前置的中缀 token：iter_command_segments
# 剥包装前缀（pnpm/npx/yarn/sudo/node）后残留 ``exec`` 的合法形态（pnpm exec
# sillyspec …）。其余段中位置（引号内字面量被切段后的中文描述段等）不命中。
_ALLOWED_SPEC_INFIX = frozenset({"exec"})

# flow 命令族中携带 --change <变更名> 的子命令（2026-09-25-change-center-thin-flow
# task-04）：thin 派发会话的 2 调用协议命令。progress/status 等只读子命令无
# --change，不在其列。
_FLOW_CHANGE_SUBCOMMANDS: frozenset[str] = frozenset({"start", "done", "amend-draft"})

# 终态子命令（2026-10-28-change-usage-attribution-window）：run 族 ``archive``
# （全量流程归档）与 flow 族 ``done``（轻量 2 调用协议收口）触发时，会话
# current_change_id 应清锚——此后同会话的轮不再打锚到已终态变更（执行用量
# 归因截断的源头半边，统计侧时间窗是兜底半边）。
_TERMINAL_RUN_SUBCOMMANDS: frozenset[str] = frozenset({"archive"})
_TERMINAL_FLOW_SUBCOMMANDS: frozenset[str] = frozenset({"done"})


@dataclass(frozen=True)
class SpecCommandBinding:
    """从 sillyspec 命令解析出的会话绑定目标（design §7）。

    ``kind`` 仅 ``"change"``：quick 不经命令解析通道产出——ql_id 在命令时刻
    未知，quick 的绑定走 agent-logs 上报通道（D-004@v1）。

    ``terminal``（2026-10-28-change-usage-attribution-window）：命令是否为变更
    终态命令（run archive / flow done）。True 时调用方在绑定后**清**会话
    current_change_id 而非游走到该变更——终态后新轮无锚，不再计入已终态
    变更的执行用量。
    """

    kind: Literal["change"]
    change_key: str
    terminal: bool = False


def extract_spec_bindings(command: str) -> list[SpecCommandBinding]:
    """解析 bash 命令，逐段提取变更绑定目标（design §7 规则）。

    对 :func:`iter_command_segments` 产出的每个裸命令段判定：

    - 定位 ``sillyspec run`` token 序列。段首收紧（D-002@v1）：``sillyspec``
      必须是段首 token，或紧随 ``exec``（包装剥除后的合法中缀形态，与
      tool_kind 打标的主命令判定同源自洽）——段中其它位置不命中（引号字符串
      内的字面文本被分段后不再误解析出绑定，会话 5f088f10 幽灵实证）。
    - 紧随 ``run`` 的子命令是 ``quick`` → 无产出：quick 的 ``--change`` 值是
      CLI 内部 quick 会话 id（``quick-<hex>`` / ``default``），不作变更绑定
      （D-004@v1）。
    - 其余情况在 ``run`` 之后的 token 里找 ``--change <名>``（空格分隔）或
      ``--change=<名>``（等号）；``--change`` 的值取紧随其后的非选项 token
      （以 ``-`` 开头视为选项 → 无值不产出）。
    - ``名 == "default"`` 跳过（D-005@v2 解析层第一道，函数内还有兜底）。
    - **flow 命令族**（2026-09-25-change-center-thin-flow task-04）：定位
      ``sillyspec flow <start|done|amend-draft>`` token 序列（段首收紧同 run
      族），在其后 token 里同规则找 ``--change <名>`` —— thin 派发会话执行
      2 调用协议（``flow start`` → 干活 → ``flow done``），变更绑定**唯一**
      依靠本命令解析通道；``名 == "default"`` 同样跳过。flow 其它子命令
      （progress/status 等）无 ``--change`` 自然无产出。
    - run 与 flow 命中其一即处理（一段命令只属一族，先查 run 再查 flow）。

    边界（可接受，key 均 slug 格式）：引号内含空格的 ``--change "a b"`` 不支持
    （token 切分会把 ``"a` 当值）；本函数只做提取不做归属校验，workspace/会话
    归属由调用方（bind 函数）保证。
    """
    bindings: list[SpecCommandBinding] = []
    for segment in iter_command_segments(command):
        tokens = segment.split()
        # ── 族一：sillyspec run（quick 子命令跳过）──
        run_idx = _locate_sillyspec_subcommand(tokens, "run")
        if run_idx is not None:
            if run_idx + 2 < len(tokens) and tokens[run_idx + 2] == "quick":
                # D-004@v1：quick 子命令的 --change 是 CLI quick 会话 id，跳过。
                continue
            # 终态判定（2026-10-28-change-usage-attribution-window）：archive
            # 子命令照常产出绑定（幂等补 link），但标记 terminal 供调用方清锚。
            run_sub = tokens[run_idx + 2] if run_idx + 2 < len(tokens) else None
            change_key = _parse_change_key(tokens, start=run_idx + 2)
            if change_key is not None and change_key != DEFAULT_CHANGE_KEY:
                bindings.append(
                    SpecCommandBinding(
                        kind="change",
                        change_key=change_key,
                        terminal=run_sub in _TERMINAL_RUN_SUBCOMMANDS,
                    )
                )
            continue
        # ── 族二：sillyspec flow start|done|amend-draft（thin 2 调用协议）──
        flow_idx: int | None = None
        matched_flow_sub: str | None = None
        for sub in _FLOW_CHANGE_SUBCOMMANDS:
            flow_idx = _locate_sillyspec_subcommand(tokens, "flow", sub)
            if flow_idx is not None:
                matched_flow_sub = sub
                break
        if flow_idx is None:
            # 既非 run 也非 flow 命令族（含 progress/status/archive 等子命令、
            # grep sillyspec 等参数含字样误归）——无产出。
            continue
        change_key = _parse_change_key(tokens, start=flow_idx + 3)
        if change_key is None or change_key == DEFAULT_CHANGE_KEY:
            continue
        # 终态判定同 run 族：flow done 是轻量 2 调用协议的收口命令。
        bindings.append(
            SpecCommandBinding(
                kind="change",
                change_key=change_key,
                terminal=matched_flow_sub in _TERMINAL_FLOW_SUBCOMMANDS,
            )
        )
    return bindings


def _locate_sillyspec_subcommand(
    tokens: list[str], subcommand: str, sub_subcommand: str | None = None
) -> int | None:
    """定位 ``sillyspec <subcommand> [sub_subcommand]`` 的 sillyspec token 下标。

    段首收紧（D-002@v1，2026-10-27-ghost-spec-binding-fix）：``sillyspec`` 必须
    是段首 token，或紧随 ``exec``（iter_command_segments 剥包装前缀后残留
    ``exec`` 的合法中缀形态）。原实现允许 token 序列出现在段中任意位置——
    引号字符串内的字面文本（如 flow start ``--input`` 长文本引用的示例命令
    「sillyspec flow start --change xxx」）被分段函数切成独立段后，段首是中文
    描述 token、序列悬在段中，曾被误解析出幽灵绑定（会话 5f088f10 实证）。

    返回 sillyspec 的下标；未命中返回 None。``sub_subcommand`` 为 None 时只匹配
    两 token（run 族，quick 跳过判定由调用方做）；给出时三 token 须连续命中
    （flow 族的 start/done/amend-draft 区分）。
    """
    for i in range(len(tokens)):
        if tokens[i] != "sillyspec":
            continue
        if i != 0 and tokens[i - 1] not in _ALLOWED_SPEC_INFIX:
            continue
        if i + 1 >= len(tokens) or tokens[i + 1] != subcommand:
            continue
        if sub_subcommand is not None and (i + 2 >= len(tokens) or tokens[i + 2] != sub_subcommand):
            continue
        return i
    return None


def _parse_change_key(tokens: list[str], start: int) -> str | None:
    """自 ``start`` 起找 ``--change <名>`` / ``--change=<名>``，返回名（无则 None）。

    值取紧随 ``--change`` 的下一个非选项 token（以 ``-`` 开头视为选项 → 视为
    无值）；等号形式取 ``=`` 后非空部分。首个命中即返回（一次 run 只有一个
    --change）。
    """
    for j in range(start, len(tokens)):
        token = tokens[j]
        if token == "--change":
            if j + 1 < len(tokens) and not tokens[j + 1].startswith("-"):
                return tokens[j + 1]
            return None
        if token.startswith("--change="):
            value = token[len("--change=") :]
            return value or None
    return None


async def bind_session_to_change(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    change_key: str,
    session_id: uuid.UUID,
    effective_from: datetime | None = None,
) -> uuid.UUID | None:
    """把会话绑到变更（幂等 best-effort，design §5 W1.3 / §7）。

    - ``change_key == "default"`` 直接返回 None（D-005@v2 函数内兜底：命令解析与
      agent-logs 两写通道统一受保护，无 placeholder 行、无 link 行）。
    - 查库未命中且名字不带日期前缀 → 拒绝建 placeholder（FR-01，2026-10-27-
      ghost-spec-binding-fix）：CLI 对新变更名强制日期前缀，此类命令必被 CLI
      exit 2 拒绝，为它建占位行只会产生永远无文件接管的幽灵（会话弹窗「进行中」
      残留实证）。已有行（含历史旧格式名）不受影响，照常幂等绑 link（FR-03）。
    - 按 ``(workspace_id, change_key)`` 查 Change，不存在则建 placeholder 行
      （defaults 对齐 ``platform_sync/service.py:_ensure_change_row``：
      status="draft" / location="active" / path=f"changes/{名}" / title=名），
      待镜像同步 + reparse 后由真实扫描结果接管。
    - upsert link：查 ``ChangeSessionLink(change_id, session_id)`` 存在即返回，
      否则插入（unique 兜底并发）。``effective_from``
      （2026-10-28-change-usage-attribution-window）：新插 link 的 created_at
      取值——run_sync 命令解析通道传**本轮 run 的 started_at**（绑定自本轮起
      生效：flow start 命令在轮内执行、轮开始早于命令落库，若用落库时刻 now，
      用量归因窗口下界会误伤立项轮自身）；None（platform_sync agent-logs /
      会话创建落绑定等无 run 上下文调用方）用当前时刻，行为不变。
    - 整体 savepoint + flush，不自行 commit；失败仅 ``log.warning`` 不抛。
    - 返回值（2026-10-12-run-level-change-attribution task-02 / FR-02）：绑定
      （或既有 link）对应的变更行 id，供 run_sync 交互通道回写会话「当前变更
      上下文」（``AgentSession.current_change_id``）；default 守卫跳过或整体
      失败返回 None。其余调用方（platform_sync agent-logs W2.2）不消费返回值，
      绑定行为不变。
    """
    if change_key == DEFAULT_CHANGE_KEY:
        return None
    try:
        async with db.begin_nested():
            change = (
                await db.execute(
                    select(Change).where(
                        Change.workspace_id == workspace_id,
                        Change.change_key == change_key,
                    )
                )
            ).scalar_one_or_none()
            if change is None:
                if not _DATED_CHANGE_KEY_RE.match(change_key):
                    # FR-01：无行 + 无日期前缀 = CLI 必拒的失败命令，不建占位。
                    # 返回 None 在 savepoint 内正常返回（无脏数据）。
                    log.warning(
                        "change.spec_binding_rejected_invalid_name",
                        workspace_id=str(workspace_id),
                        change_key=change_key,
                        session_id=str(session_id),
                    )
                    return None
                change = Change(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    change_key=change_key,
                    title=change_key,
                    status="draft",
                    location="active",
                    # platform-managed 镜像扁平布局（无 .sillyspec/ 包裹），与
                    # parser rel_prefix 一致；镜像目录尚未同步时文件树为空，
                    # 属预期占位态（_ensure_change_row 同款注释）。
                    path=f"changes/{change_key}",
                    updated_at=datetime.now(UTC),
                )
                db.add(change)
                await db.flush()
                log.info(
                    "change.spec_binding_placeholder_created",
                    workspace_id=str(workspace_id),
                    change_key=change_key,
                )
            link = (
                await db.execute(
                    select(ChangeSessionLink).where(
                        ChangeSessionLink.change_id == change.id,
                        ChangeSessionLink.session_id == session_id,
                    )
                )
            ).scalar_one_or_none()
            if link is not None:
                return change.id
            db.add(
                ChangeSessionLink(
                    id=uuid.uuid4(),
                    change_id=change.id,
                    session_id=session_id,
                    # 绑定生效时刻（见 docstring）：run 通道传轮 started_at，
                    # 无上下文调用方回落当前时刻（default_factory 同值，显式
                    # 写防依赖隐式默认）。
                    created_at=effective_from or datetime.now(UTC),
                )
            )
            await db.flush()
            return change.id
    except Exception as exc:
        log.warning(
            "change.spec_session_bind_failed",
            workspace_id=str(workspace_id),
            change_key=change_key,
            session_id=str(session_id),
            error=str(exc),
        )
        return None


async def bind_session_to_quicklog(
    db: AsyncSession,
    workspace_id: uuid.UUID,
    ql_id: str,
    session_id: uuid.UUID,
) -> None:
    """把会话绑到快速修复条目（幂等 best-effort，design §5 W1.3 / §7）。

    直接 upsert ``QuicklogSessionLink``（by ``(workspace_id, ql_id, session_id)``
    自然键）。**不要求 quicklog_entries 行存在**（D-001@v1）：条目双源合并
    （DB 推送 + QUICKLOG.md 文件解析），且 agent-logs 与条目推送到达顺序不
    保证——先绑后补条目合法。同款 savepoint best-effort，不自行 commit。
    """
    try:
        async with db.begin_nested():
            link = (
                await db.execute(
                    select(QuicklogSessionLink).where(
                        QuicklogSessionLink.workspace_id == workspace_id,
                        QuicklogSessionLink.ql_id == ql_id,
                        QuicklogSessionLink.session_id == session_id,
                    )
                )
            ).scalar_one_or_none()
            if link is not None:
                return
            db.add(
                QuicklogSessionLink(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    ql_id=ql_id,
                    session_id=session_id,
                )
            )
            await db.flush()
    except Exception as exc:
        log.warning(
            "change.quicklog_session_bind_failed",
            workspace_id=str(workspace_id),
            ql_id=ql_id,
            session_id=str(session_id),
            error=str(exc),
        )
