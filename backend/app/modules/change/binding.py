"""会话 ↔ 变更/快速修复 绑定基座（change 2026-08-25-session-spec-binding task-02）。

design §5 W1.3 / §7：命令解析（``extract_spec_bindings``）+ 两个幂等 best-effort
bind 函数，供 W2 检测写入口（run_sync 命令解析 / platform_sync agent-logs 两分支）
复用（D-003@v1 双通道）。本模块不接线任何调用方（task-05/06/08 落）。

- 解析规则：``sillyspec run quick`` 子命令无产出（其 ``--change`` 值是 CLI 内部
  quick 会话 id，D-004@v1）；其余 ``run`` 阶段支持 ``--change <名>``（空格）与
  ``--change=<名>``（等号）两形式；``名 == "default"`` 跳过（D-005@v2 解析层
  第一道）；progress/status/archive 等非 run 子命令无产出。
- bind 事务口径：**不自行 commit**（跟随调用方事务），savepoint
  （``begin_nested``）+ flush 落行，失败仅 ``log.warning`` 不抛（对齐
  ``change/service.py:_bind_change_to_session`` 的 best-effort 风格）。
"""

from __future__ import annotations

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


@dataclass(frozen=True)
class SpecCommandBinding:
    """从 sillyspec 命令解析出的会话绑定目标（design §7）。

    ``kind`` 仅 ``"change"``：quick 不经命令解析通道产出——ql_id 在命令时刻
    未知，quick 的绑定走 agent-logs 上报通道（D-004@v1）。
    """

    kind: Literal["change"]
    change_key: str


def extract_spec_bindings(command: str) -> list[SpecCommandBinding]:
    """解析 bash 命令，逐段提取变更绑定目标（design §7 规则）。

    对 :func:`iter_command_segments` 产出的每个裸命令段判定：

    - 定位 ``sillyspec run`` token 序列（段首为主；包装剥除后残留 ``exec`` 等
      中缀时同样命中，与 tool_kind 打标的主命令判定同源自洽）。
    - 紧随 ``run`` 的子命令是 ``quick`` → 无产出：quick 的 ``--change`` 值是
      CLI 内部 quick 会话 id（``quick-<hex>`` / ``default``），不作变更绑定
      （D-004@v1）。
    - 其余情况在 ``run`` 之后的 token 里找 ``--change <名>``（空格分隔）或
      ``--change=<名>``（等号）；``--change`` 的值取紧随其后的非选项 token
      （以 ``-`` 开头视为选项 → 无值不产出）。
    - ``名 == "default"`` 跳过（D-005@v2 解析层第一道，函数内还有兜底）。

    边界（可接受，key 均 slug 格式）：引号内含空格的 ``--change "a b"`` 不支持
    （token 切分会把 ``"a` 当值）；本函数只做提取不做归属校验，workspace/会话
    归属由调用方（bind 函数）保证。
    """
    bindings: list[SpecCommandBinding] = []
    for segment in iter_command_segments(command):
        tokens = segment.split()
        run_idx: int | None = None
        for i in range(len(tokens) - 1):
            if tokens[i] == "sillyspec" and tokens[i + 1] == "run":
                run_idx = i
                break
        if run_idx is None:
            # 非 sillyspec run 命令（含 progress/status/archive 等子命令、
            # grep sillyspec 等参数含字样误归）——无产出。
            continue
        if run_idx + 2 < len(tokens) and tokens[run_idx + 2] == "quick":
            # D-004@v1：quick 子命令的 --change 是 CLI quick 会话 id，跳过。
            continue
        change_key = _parse_change_key(tokens, start=run_idx + 2)
        if change_key is None or change_key == DEFAULT_CHANGE_KEY:
            continue
        bindings.append(SpecCommandBinding(kind="change", change_key=change_key))
    return bindings


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
) -> None:
    """把会话绑到变更（幂等 best-effort，design §5 W1.3 / §7）。

    - ``change_key == "default"`` 直接返回（D-005@v2 函数内兜底：命令解析与
      agent-logs 两写通道统一受保护，无 placeholder 行、无 link 行）。
    - 按 ``(workspace_id, change_key)`` 查 Change，不存在则建 placeholder 行
      （defaults 对齐 ``platform_sync/service.py:_ensure_change_row``：
      status="draft" / location="active" / path=f"changes/{名}" / title=名），
      待镜像同步 + reparse 后由真实扫描结果接管。
    - upsert link：查 ``ChangeSessionLink(change_id, session_id)`` 存在即返回，
      否则插入（unique 兜底并发）。
    - 整体 savepoint + flush，不自行 commit；失败仅 ``log.warning`` 不抛。
    """
    if change_key == DEFAULT_CHANGE_KEY:
        return
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
                return
            db.add(
                ChangeSessionLink(
                    id=uuid.uuid4(),
                    change_id=change.id,
                    session_id=session_id,
                )
            )
            await db.flush()
    except Exception as exc:
        log.warning(
            "change.spec_session_bind_failed",
            workspace_id=str(workspace_id),
            change_key=change_key,
            session_id=str(session_id),
            error=str(exc),
        )


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
