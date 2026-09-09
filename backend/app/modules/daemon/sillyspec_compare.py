"""sillyspec 冲突对比编排 service（2026-09-07-conflict-diff-compare task-04 / D-001@v1 方案A）.

职责（design §5 Phase 2.2）：并行拉取 daemon 侧冲突快照（RPC
``sillyspec_conflict_snapshot``，§7.1）与平台侧事实源（spec_root 文件树 /
platform_sync 进度表），归一化成对比响应（§7.2）——router 只做参数校验/权限/
响应组装，本模块承载全部编排与 diff 计算（difflib，零新依赖）。

关键契约（task-03 测试钉定）：

* RPC 显式 ``timeout=15``（send_rpc 默认 RPC_DEFAULT_TIMEOUT=10s 对 183 文件级
  快照不够用）；离线/超时异常原样上抛（既有 504 家族形态，daemon/router.py
  机器级先例同款）。
* spec-tree 文件清单顺序沿用 daemon 快照序（信噪比排序在 daemon 侧完成，平台
  不重排）；四分类 modified/local_only/platform_only/identical；双侧均缺失路径
  剔除并计数 ``dropped_paths``。
* containment（Grill B3，spec_workspace/service.py:1486-1504 同款范式）：daemon
  是半可信端，回报路径逐条校验（拒 ``..`` 段、resolve 落点必须在 spec_root
  内），越界按平台侧缺失处理不读取。
* 截断护栏（design §8）：单文件 diff 行 ≤5000（超出置该文件 ``diff_truncated``
  并截断）；整响应 JSON ≤2MB（超出置 ``response_truncated`` 并按文件倒序丢
  ``diff_rows``）。
* progress 白名单六字段（当前阶段/阶段标签/步骤进度/最近活跃/ql_id/ghost），
  缺失值显式「—」。
"""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import PermissionDenied
from app.core.logging import get_logger
from app.modules.auth.model import UserWorkspaceRole
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcRemoteGatewayError,
)
from app.modules.platform_sync.service import PlatformSyncService
from app.modules.spec_workspace.service import SpecWorkspaceService

log = get_logger(__name__)

# RPC 腿（design §7.1）：method + params 形态由 task-03 测试逐项钉定。
SNAPSHOT_RPC_METHOD = "sillyspec_conflict_snapshot"
SNAPSHOT_RPC_TIMEOUT_SECONDS = 15

# 双截断护栏（design §5 Phase 2 / §8）。
DIFF_ROW_CAP_PER_FILE = 5000
RESPONSE_BYTE_CAP = 2 * 1024 * 1024

# progress 白名单字段缺省占位（design §7.2：本地/平台缺失字段显式「—」）。
MISSING_VALUE = "—"

CompareKind = Literal["spec-tree", "progress"]


# ── 平台侧单文件读取结果 ──────────────────────────────────────────────────────


@dataclass
class _PlatformFileHit:
    """spec_root 下单条路径的平台侧读取结果（exists=False 即按平台缺失处理）。"""

    exists: bool = False
    content: str | None = None
    mtime_ts: float | None = None
    mtime_iso: str | None = None
    # 平台侧非 utf8 → 无法文本对比（与本地 binary 同一占位语义，design §3 非目标）。
    binary: bool = False


def _read_platform_file(
    spec_root: Path, spec_root_resolved: Path, rel_path: str
) -> _PlatformFileHit:
    """按 containment 校验后读平台侧单文件；任何不满足 → 平台缺失（不读取）。

    范式对齐 spec_workspace/service.py:1486-1504 ``_validate_op_path``：拒绝对
    路径 / 盘符 / ``..`` 逃逸段 / resolve 落点越出 spec_root（Windows 下
    ``Path.resolve`` 同样收敛符号链接与 ``..``）。区别在错误形态：同步 op 越界
    抛 422 拒整个包，此处越界仅该路径按平台侧缺失处理（对比是只读视图，单条
    越界不应让整个对比失败，Grill B3）。
    """
    normalized = rel_path.replace("\\", "/")
    if normalized.startswith("/") or (len(normalized) > 1 and normalized[1] == ":"):
        return _PlatformFileHit()
    if any(segment == ".." for segment in normalized.split("/")):
        return _PlatformFileHit()
    try:
        target = (spec_root / normalized).resolve()
        target.relative_to(spec_root_resolved)
    except (ValueError, OSError):
        return _PlatformFileHit()
    if not target.is_file():
        return _PlatformFileHit()
    hit = _PlatformFileHit(exists=True)
    try:
        stat = target.stat()
        hit.mtime_ts = stat.st_mtime
        hit.mtime_iso = datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat()
        hit.content = target.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        hit.binary = True
        hit.content = None
    except OSError:
        return _PlatformFileHit()
    return hit


# ── diff 计算（纯函数）──────────────────────────────────────────────────────


def _aligned_diff_rows(local_text: str, platform_text: str) -> list[dict[str, Any]]:
    """difflib.SequenceMatcher 出对齐行（design §5 Phase 2 / §7.2）。

    行粒度（``splitlines`` 去行尾），replace 段展开为相邻 delete+insert（delete
    在前）；双侧 lineno 从 1 起，对侧缺失为 null。``autojunk=False``——行 diff
    语义下不希望 SequenceMatcher 把高频行当 junk 吞掉（大文件截断护栏测试的
    6000 行全异场景依赖诚实对齐）。
    """
    local_lines = local_text.splitlines()
    platform_lines = platform_text.splitlines()
    matcher = SequenceMatcher(a=local_lines, b=platform_lines, autojunk=False)
    rows: list[dict[str, Any]] = []

    def _delete(lineno: int, text: str) -> dict[str, Any]:
        return {
            "type": "delete",
            "local_lineno": lineno,
            "local_text": text,
            "platform_lineno": None,
            "platform_text": None,
        }

    def _insert(lineno: int, text: str) -> dict[str, Any]:
        return {
            "type": "insert",
            "local_lineno": None,
            "local_text": None,
            "platform_lineno": lineno,
            "platform_text": text,
        }

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(i2 - i1):
                rows.append(
                    {
                        "type": "equal",
                        "local_lineno": i1 + offset + 1,
                        "local_text": local_lines[i1 + offset],
                        "platform_lineno": j1 + offset + 1,
                        "platform_text": platform_lines[j1 + offset],
                    }
                )
        elif tag == "delete":
            for offset in range(i2 - i1):
                rows.append(_delete(i1 + offset + 1, local_lines[i1 + offset]))
        elif tag == "insert":
            for offset in range(j2 - j1):
                rows.append(_insert(j1 + offset + 1, platform_lines[j1 + offset]))
        else:  # replace → 先 delete 后 insert（相邻成段）
            for offset in range(i2 - i1):
                rows.append(_delete(i1 + offset + 1, local_lines[i1 + offset]))
            for offset in range(j2 - j1):
                rows.append(_insert(j1 + offset + 1, platform_lines[j1 + offset]))
    return rows


# ── progress 归一化（纯函数）────────────────────────────────────────────────


def _display_text(value: Any) -> str:
    """进度字段值 → 展示字符串；None/空串 → 「—」（bool 走 true/false 字面量）。"""
    if value is None:
        return MISSING_VALUE
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value if value else MISSING_VALUE
    return str(value)


def _steps_value(steps: Any) -> str:
    """steps {completed, total} → ``completed/total``；结构/键缺失 → 「—」。"""
    if not isinstance(steps, dict):
        return MISSING_VALUE
    completed = steps.get("completed")
    total = steps.get("total")
    if completed is None or total is None:
        return MISSING_VALUE
    return f"{completed}/{total}"


def _progress_row(label: str, local_value: str, platform_value: str) -> dict[str, Any]:
    return {
        "label": label,
        "local_value": local_value,
        "platform_value": platform_value,
        "differ": local_value != platform_value,
    }


def _build_progress_rows(
    snapshot: dict[str, Any], platform_progress: dict[str, Any], change: str
) -> list[dict[str, Any]]:
    """白名单六字段归一化 progress_rows（design §5 Phase 2.3 / §7.2）。

    本地侧取 daemon 快照 ``progress`` 条目，平台侧取 platform_sync 六表中该
    change 的 ``changes[]`` 条目；``ql_id`` 平台侧不可得恒「—」（QUICKLOG 编号
    只在 daemon 机器 guard.json，design §1 探查结论）。
    """
    local = snapshot.get("progress") if isinstance(snapshot.get("progress"), dict) else {}
    platform_entry: dict[str, Any] = {}
    changes = platform_progress.get("changes")
    if isinstance(changes, list):
        for item in changes:
            if isinstance(item, dict) and item.get("name") == change:
                platform_entry = item
                break
    ql_id = snapshot.get("ql_id")
    return [
        _progress_row(
            "当前阶段",
            _display_text(local.get("current_stage")),
            _display_text(platform_entry.get("current_stage")),
        ),
        _progress_row(
            "阶段标签",
            _display_text(local.get("stage_label")),
            _display_text(platform_entry.get("stage_label")),
        ),
        _progress_row(
            "步骤进度", _steps_value(local.get("steps")), _steps_value(platform_entry.get("steps"))
        ),
        _progress_row(
            "最近活跃",
            _display_text(local.get("last_active")),
            _display_text(platform_entry.get("last_active")),
        ),
        _progress_row(
            "ql_id", ql_id if isinstance(ql_id, str) and ql_id else MISSING_VALUE, MISSING_VALUE
        ),
        _progress_row(
            "ghost", _display_text(local.get("ghost")), _display_text(platform_entry.get("ghost"))
        ),
    ]


# ── 响应体积护栏 ─────────────────────────────────────────────────────────────


def _json_size(value: Any) -> int:
    """与 FastAPI JSONResponse 同参数序列化后的 UTF-8 字节数（compact + 非 ASCII 直出）。

    starlette ``JSONResponse.render`` 用 ``ensure_ascii=False,
    separators=(",", ":")``；本模块 payload 全 JSON 原生类型，键序不影响总字节数，
    故此处字节数与最终 HTTP body 逐字节一致（截断护栏判定依据）。
    """
    return len(
        json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode(
            "utf-8"
        )
    )


def _enforce_response_cap(payload: dict[str, Any]) -> dict[str, Any]:
    """整响应 2MB 帽（design §5 Phase 2 / §8）：超出按文件倒序丢 diff_rows。

    清单头部（信噪比高——本变更目录在前）保住，尾部（archive 旧归档）先丢；
    每清空一个文件的 diff_rows，总字节精确减 ``len(json(rows)) - 2``（``[]``
    序列化为 2 字节）。与单文件 5000 行帽相互独立（task-03 钉定）。
    """
    total = _json_size(payload)
    if total <= RESPONSE_BYTE_CAP:
        return payload
    payload["response_truncated"] = True
    files = payload.get("files")
    if not isinstance(files, list):
        return payload
    for entry in reversed(files):
        if total <= RESPONSE_BYTE_CAP:
            break
        if not isinstance(entry, dict):
            continue
        rows = entry.get("diff_rows")
        if not rows:
            continue
        total -= _json_size(rows) - 2
        entry["diff_rows"] = []
    return payload


# ── 编排 service ─────────────────────────────────────────────────────────────


class SillySpecCompareService:
    """compare 端点的编排 service（design §5 Phase 2.2；router 只做校验与组装）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def compare(
        self,
        *,
        instance_id: uuid.UUID,
        user_id: uuid.UUID,
        change: str,
        kind: CompareKind,
        workspace_id: uuid.UUID,
    ) -> dict[str, Any]:
        """产出 §7.2 对比响应 dict（JSON 原生类型，router 直接 model_validate）。

        顺序：workspace 成员校验 → 平台侧事实源定位（session 查询，**先于 RPC 顺序执行**）
        → daemon 快照 RPC（长等待）→ 按 kind 归一化比对。

        不并行说明（task-10 实机验收实证 2026-09-07）：gather(RPC, session 查询) 在
        真实环境触发 asyncpg「another operation is in progress / manually started
        transaction」并发连接冲突（单测 mock RPC 立即返回，交叠窗口趋零未暴露）——
        平台侧定位是单行主键查询（毫秒级），并行收益可忽略，顺序化彻底消除
        同请求 session 并发面。
        """
        await self._ensure_workspace_member(user_id, workspace_id)
        if kind == "progress":
            platform_progress = await self._load_platform_progress(workspace_id, change)
            snapshot = await self._fetch_snapshot(instance_id, change, kind)
            payload = await asyncio.to_thread(
                self._build_progress_compare, change, snapshot, platform_progress
            )
        else:
            spec_root = await self._load_spec_root(workspace_id)
            snapshot = await self._fetch_snapshot(instance_id, change, kind)
            # ql-20260909-012：比对全程同步 FS IO（逐文件 stat+read_text 全量读）+
            # difflib（大文件最坏 O(n²)）——spec 树几百文件时阻塞事件循环数百 ms
            # 至秒级，丢线程池解放并发请求（纯函数不改共享状态，线程安全）。
            payload = await asyncio.to_thread(
                self._build_spec_tree_compare, change, snapshot, spec_root
            )
        # 体积护栏对整个 payload 反复 json.dumps 测字节（上限 2MB+），同丢线程池。
        return await asyncio.to_thread(_enforce_response_cap, payload)

    # ── 权限 / RPC / 平台侧定位 ─────────────────────────────────────────────

    async def _ensure_workspace_member(self, user_id: uuid.UUID, workspace_id: uuid.UUID) -> None:
        """校验当前用户是该 workspace 成员（design §5 Phase 2.1）。

        平台侧 spec_root / platform_sync 行按 workspace 定位，非成员不得经
        compare 侧读其内容。UserWorkspaceRole 行即成员资格（角色零权限亦可，
        test_sillyspec_compare 同款判定）。
        """
        stmt = select(col(UserWorkspaceRole.user_id)).where(
            col(UserWorkspaceRole.user_id) == user_id,
            col(UserWorkspaceRole.workspace_id) == workspace_id,
        )
        row = (await self._session.execute(stmt)).first()
        if row is None:
            raise PermissionDenied(
                "仅工作区成员可查看该冲突对比。",
                details={"workspace_id": str(workspace_id)},
            )

    async def _fetch_snapshot(
        self, instance_id: uuid.UUID, change: str, kind: CompareKind
    ) -> dict[str, Any]:
        """RPC 拉取 daemon 侧冲突快照（§7.1；机器级以 instance_id 作 daemon_id 路由）。

        ``get_daemon_ws_hub`` 懒导入（explorer/_send_explorer_rpc:288 同款理由：
        测试按单例访问器/类级 patch，模块顶层 import 会绑死陈旧引用）。
        DaemonRuntimeOffline / DaemonRpcTimeout 原样上抛（既有 504 家族，AppError
        handler 直接序列化）；DaemonRpcRemoteError 是内部信号 Exception，映射为
        502 网关错误防裸 500（daemon 侧 no_spec_root 等业务失败面）。
        """
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        try:
            return await hub.send_rpc(
                instance_id,
                SNAPSHOT_RPC_METHOD,
                {"change": change, "kind": kind},
                timeout=SNAPSHOT_RPC_TIMEOUT_SECONDS,
            )
        except DaemonRpcRemoteError as exc:
            raise DaemonRpcRemoteGatewayError(
                "读取机器侧冲突快照失败，请稍后重试。",
                details={
                    "daemon_instance_id": str(instance_id),
                    "method": SNAPSHOT_RPC_METHOD,
                    "daemon_code": exc.code,
                    "daemon_message": exc.message,
                },
            ) from exc

    async def _load_platform_progress(self, workspace_id: uuid.UUID, change: str) -> dict[str, Any]:
        """平台侧进度（PlatformSyncService.get_progress，platform_sync/router.py:313 同款）。

        行不存在 / 占位行守卫 → {}（进度条目缺失字段归一化为「—」，对比是只读
        视图不因平台侧无行而 404）。
        """
        progress = await PlatformSyncService(self._session).get_progress(
            workspace_id=workspace_id, name=change
        )
        return progress if isinstance(progress, dict) else {}

    async def _load_spec_root(self, workspace_id: uuid.UUID) -> Path:
        """平台侧 spec 树根（SpecWorkspaceService.get → spec_root 列）。

        行不存在 → SpecWorkspaceNotFound（404）原样上抛——没有 spec 容器的
        workspace 无从比对。
        """
        spec_ws = await SpecWorkspaceService(self._session).get(workspace_id)
        return Path(spec_ws.spec_root)

    # ── spec-tree 比对 ──────────────────────────────────────────────────────

    def _build_spec_tree_compare(
        self, change: str, snapshot: dict[str, Any], spec_root: Path
    ) -> dict[str, Any]:
        """四分类 + diff_rows + dropped_paths（design §5 Phase 2 / Grill B4）。

        清单顺序沿用 daemon 快照序（平台不重排）；双侧均缺失路径剔除并计数。
        本地 truncated/binary 无 content 的文件不出 diff_rows（status 仍按元信息
        分类，避免全 insert 的方向信号失真——Grill 复审残留 gap）。
        """
        spec_root_resolved = spec_root.resolve()
        files_out: list[dict[str, Any]] = []
        dropped_paths = 0
        platform_mtimes: list[float] = []

        raw_files = snapshot.get("files")
        for entry in raw_files if isinstance(raw_files, list) else []:
            if not isinstance(entry, dict):
                continue
            path = entry.get("path")
            if not isinstance(path, str) or not path:
                continue
            local_missing = bool(entry.get("missing"))
            local_mtime = None if local_missing else entry.get("mtime")
            local_content = entry.get("content") if isinstance(entry.get("content"), str) else None
            local_binary = bool(entry.get("binary"))
            platform = _read_platform_file(spec_root, spec_root_resolved, path)
            if platform.exists and platform.mtime_ts is not None:
                platform_mtimes.append(platform.mtime_ts)
            binary = local_binary or platform.binary

            diff_rows: list[dict[str, Any]] = []
            diff_truncated = False
            if local_missing and not platform.exists:
                # 双侧均缺失：剔除计数（B4 修订）——冲突清单是 daemon 侧历史记录，
                # 双方都已不存在的内容没有对比意义。
                dropped_paths += 1
                continue
            if local_missing:
                status = "platform_only"
            elif not platform.exists:
                # 含 containment 拒绝的越界路径（Grill B3：按平台侧缺失处理）。
                status = "local_only"
            elif local_content is None or platform.content is None or binary:
                # 双侧都在但无法文本对比（本地截断/二进制、平台非 utf8）——按元
                # 信息分类为 modified，不出 diff_rows。
                status = "modified"
            elif local_content == platform.content:
                status = "identical"
            else:
                status = "modified"
                rows = _aligned_diff_rows(local_content, platform.content)
                if len(rows) > DIFF_ROW_CAP_PER_FILE:
                    rows = rows[:DIFF_ROW_CAP_PER_FILE]
                    diff_truncated = True
                diff_rows = rows
            files_out.append(
                {
                    "path": path,
                    "status": status,
                    "local_mtime": local_mtime,
                    "platform_mtime": platform.mtime_iso,
                    "local_truncated": bool(entry.get("truncated")),
                    "local_missing": local_missing,
                    "diff_rows": diff_rows,
                    "diff_truncated": diff_truncated,
                    "binary": binary,
                }
            )

        return {
            "change": change,
            "kind": "spec-tree",
            "ql_id": snapshot.get("ql_id"),
            "conflict_created_at": snapshot.get("conflict_created_at"),
            "local_updated_at": snapshot.get("local_updated_at"),
            "platform_updated_at": (
                datetime.fromtimestamp(max(platform_mtimes), tz=UTC).isoformat()
                if platform_mtimes
                else None
            ),
            "response_truncated": False,
            "dropped_paths": dropped_paths,
            "files": files_out,
            "progress_rows": [],
        }

    # ── progress 比对 ───────────────────────────────────────────────────────

    def _build_progress_compare(
        self, change: str, snapshot: dict[str, Any], platform_progress: dict[str, Any]
    ) -> dict[str, Any]:
        """progress 模式（D-003@v1 对比表）：platform_updated_at 取 last_pushed_at。"""
        return {
            "change": change,
            "kind": "progress",
            "ql_id": snapshot.get("ql_id"),
            "conflict_created_at": snapshot.get("conflict_created_at"),
            "local_updated_at": snapshot.get("local_updated_at"),
            "platform_updated_at": platform_progress.get("last_pushed_at"),
            "response_truncated": False,
            "dropped_paths": 0,
            "files": [],
            "progress_rows": _build_progress_rows(snapshot, platform_progress, change),
        }
