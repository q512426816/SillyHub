"""漂移探针 + 容器内存水位周期任务（2026-10-27-archive-reparse-oom-governance
task-05 / FR-04 / D-008）。

- :func:`check_drift_once`：抽样核对 changes 行 location 与磁盘 spec 镜像目录
  形态一致性（active → ``spec_root/changes/<key>`` 在场；archive →
  ``spec_root/changes/archive/<key>`` 在场）。**只读只告警**（D-008）：发现
  不一致仅 ``log.warning``，零写操作、不自动触发任何 reparse——修复通道是
  人工调既有手动 reparse 端点（D-006 rejected 边界：不做定时全量对账/自动
  修复，尊重 knowledge「拒全量对账常态化」先例——Windows bind mount stat
  断崖 + 全量 93s 超时史）。
- :func:`log_memory_watermark`：读 cgroup 内存水位（v2 ``memory.current`` /
  ``memory.max``，v1 ``memory.usage_in_bytes`` / ``memory.limit_in_bytes``）
  周期落日志，超 ``_WATERMARK_HIGH_RATIO``（0.8）告警——OOM 前可预警
  （2026-10-27 生产实证：anon-rss≈2.37G 顶爆 2500m memcg 被杀前零信号）。
  无 cgroup 环境（本地 dev/Windows）静默跳过（debug 一次），不报错。
- :func:`drift_probe_loop`：常驻循环（main.py lifespan create_task 挂载），
  模式与关停契约同 ``scheduled_send_sweeper``——每轮独立短 session、单轮异常
  ``log.exception`` 吞掉不崩循环、``asyncio.sleep`` 处 CancelledError 透传。

自灭条件（非功能生命周期面，design 风险登记 R-03/R-06）：唯一常驻资源 =
asyncio task，随 lifespan cancel + await gather 死；无文件锁/子进程/句柄。
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger

log = get_logger(__name__)

# 探针周期（秒）。抽样核对 + 水位各一轮内顺跑；5 分钟粒度平衡「漂移发现
# 时效」与「只读探针自身开销」（每轮 ≤50 行 SELECT + ≤50 次 stat）。
DRIFT_PROBE_INTERVAL_SEC = 300.0
# 单轮抽样上限（FR-04：≤50 行/轮——按 updated_at 倒序取最新活动面，覆盖最
# 可能漂移的近期变更；全量核对属 D-006 rejected 的「全量对账常态化」禁区）。
DRIFT_SAMPLE_LIMIT = 50
# 水位告警阈值（current/limit 比例，超 0.8 告警——留 20% 缓冲给打包/重扫峰）。
_WATERMARK_HIGH_RATIO = 0.8

# cgroup 文件候选（v2 在前、v1 兜底；均缺失 = 无 cgroup 环境静默跳过）。
_CGROUP_CURRENT_FILES = (
    "/sys/fs/cgroup/memory.current",
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
)
_CGROUP_LIMIT_FILES = (
    # v2 限制文件是 memory.max（统一层级无 memory.limit——2026-10-28-cgroup-v2-
    # watermark-fix 修正：此前误写 memory.limit 致 v2 宿主 limit 恒 None、告警
    # 静默失效）。无限制时内容为字面量 "max"，int() 抛 ValueError 被捕获 →
    # 按「候选不可用」落回 v1 兜底，v1 亦无则 None 静默跳过（无限制即无水位）。
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
)

_watermark_env_missing_logged = False


def _read_first_existing(paths: tuple[str, ...]) -> int | None:
    for p in paths:
        try:
            text = Path(p).read_text(encoding="utf-8").strip()
            return int(text)
        except (OSError, ValueError):
            continue
    return None


async def check_drift_once(db: AsyncSession) -> int:
    """抽样核对行 location vs 磁盘目录形态（只读），返回发现的漂移行数。

    漂移定义（最常见两类）：location='active' 但活跃目录不在场（归档未收敛/
    目录误删）；location='archive' 但归档目录不在场（un-archive 未收敛/目录
    误删）。软删行（location='deleted'，平台删除锚点保活）与无 spec_root 的
    工作区跳过。stat 走 ``asyncio.to_thread``（Windows bind mount stat 慢的
    先例——不占事件循环）。
    """
    from app.modules.change.model import Change
    from app.modules.spec_workspace.model import SpecWorkspace

    rows = (
        await db.execute(
            select(Change.change_key, Change.location, Change.workspace_id)
            .where(Change.location.in_(("active", "archive")))
            .order_by(Change.updated_at.desc())
            .limit(DRIFT_SAMPLE_LIMIT)
        )
    ).all()
    if not rows:
        return 0
    spec_roots: dict = {}
    ws_rows = (await db.execute(select(SpecWorkspace.workspace_id, SpecWorkspace.spec_root))).all()
    for ws_id, root in ws_rows:
        if root:
            spec_roots[ws_id] = Path(root)

    # 逐工作区批量 stat 入线程（一批一次性投递，避免逐行 to_thread 往返）。
    def _check_all() -> list[tuple[str, str, str]]:
        findings: list[tuple[str, str, str]] = []
        for key, location, ws_id in rows:
            root = spec_roots.get(ws_id)
            if root is None:
                continue
            expected = (
                root / "changes" / "archive" / key
                if location == "archive"
                else root / "changes" / key
            )
            if not expected.is_dir():
                findings.append((key, location, str(ws_id)))
        return findings

    drifts = await asyncio.to_thread(_check_all)
    for key, location, ws_id in drifts:
        log.warning(
            "spec_workspace.drift_detected",
            change_key=key,
            location=location,
            workspace_id=ws_id,
            hint="行 location 与磁盘目录不一致——人工核对后可调手动 reparse 端点收敛（探针只告警不自愈，D-008）",
        )
    return len(drifts)


def log_memory_watermark() -> float | None:
    """读 cgroup 内存水位落日志；返回使用比例（无 cgroup 环境 None）。

    超 ``_WATERMARK_HIGH_RATIO`` 告警（warning），否则周期性 info（可观测基线）；
    无 cgroup 环境仅首次 debug 提示后静默（本地 dev/Windows 兼容，R-05）。
    """
    global _watermark_env_missing_logged
    current = _read_first_existing(_CGROUP_CURRENT_FILES)
    limit = _read_first_existing(_CGROUP_LIMIT_FILES)
    if current is None or limit is None or limit <= 0:
        if not _watermark_env_missing_logged:
            _watermark_env_missing_logged = True
            log.debug("spec_workspace.watermark_env_missing", current=current, limit=limit)
        return None
    ratio = current / limit
    if ratio > _WATERMARK_HIGH_RATIO:
        log.warning(
            "spec_workspace.memory_watermark_high",
            ratio=round(ratio, 3),
            current_mb=round(current / 1024 / 1024, 1),
            limit_mb=round(limit / 1024 / 1024, 1),
        )
    else:
        log.info(
            "spec_workspace.memory_watermark",
            ratio=round(ratio, 3),
            current_mb=round(current / 1024 / 1024, 1),
            limit_mb=round(limit / 1024 / 1024, 1),
        )
    return ratio


async def drift_probe_loop(interval: float = DRIFT_PROBE_INTERVAL_SEC) -> None:
    """常驻探针循环（main.py lifespan ``create_task`` 消费）。

    仿 ``scheduled_send_sweeper``：每轮独立短 session（轮间不占连接池）、
    单轮异常 ``log.exception`` 吞掉不崩循环、``asyncio.sleep`` 处
    CancelledError 透传保证 lifespan 的 cancel + await gather 干净落地。
    """
    from app.core.db import get_session_factory

    session_factory = get_session_factory()
    while True:
        try:
            async with session_factory() as db:
                drifts = await check_drift_once(db)
                if drifts:
                    log.info("spec_workspace.drift_probe_round", drifts=drifts)
            log_memory_watermark()
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("spec_workspace.drift_probe_round_failed")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
