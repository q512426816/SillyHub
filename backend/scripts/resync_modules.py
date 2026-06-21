"""重新同步 ppm_plan_node_module —— 修 migrate_from_ruoyi 顺序 bug 后的补救脚本。

根因（QL ql-20260621-004）：migrate_from_ruoyi.py 原 main() 中 migrate_plan_node_module
在 migrate_ps_plan_node 之前执行，module 跑时 maps["ps_plan_node"] 未构建 → map_fk 全失败
→ plan_node_id 保留源数字 ID → 被 202607220900 ALTER 迁移丢弃为 NULL → 模块成孤儿，
里程碑详情页"模块"子表显示"暂无数据"。

本脚本：构建正确 maps(ps_plan_node/user/plan_node) → 重读源模块 → 正确映射
plan_node_id/duty_user_id → 幂等插回目标库。id 用 uuid5_int("module", 源id) 与原迁移一致，
先 DELETE 再 INSERT，可安全重跑。

执行（宿主机 backend 目录）：
    DATABASE_URL="postgresql+asyncpg://platform:platform@127.0.0.1:5433/platform" \
        uv run python scripts/resync_modules.py
源库默认 127.0.0.1:3306 ruoyi-vue-pro（可经 MIGRATE_SRC_* 覆盖）。

author: qinyi
created_at: 2026-06-21T14:20:00
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

# 复用 ETL 脚本的源库读取 + 确定性 ID + 脏值清理（同目录 import）
from migrate_from_ruoyi import (
    clean_str,
    is_deleted,
    src_query,
    to_dt,
    uuid5_int,
)
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.modules.ppm.plan.model import PlanNodeModule


def build_maps() -> dict[str, dict[Any, uuid.UUID]]:
    """构建重同步所需最小 maps：ps_plan_node / user / plan_node 的 源id→目标uuid。"""
    maps: dict[str, dict[Any, uuid.UUID]] = {
        "ps_plan_node": {},  # 里程碑（module.plan_node_id 实际指向它）
        "user": {},  # 责任人
        "plan_node": {},  # 模板节点（兜底）
    }
    for r in src_query("SELECT id FROM ppm_ps_plan_node ORDER BY id"):
        if not is_deleted(r):
            maps["ps_plan_node"][str(r["id"])] = uuid5_int("ps_plan_node", r["id"])
    for r in src_query("SELECT id FROM system_users ORDER BY id"):
        maps["user"][str(r["id"])] = uuid5_int("user", r["id"])
    for r in src_query("SELECT id FROM ppm_plan_node ORDER BY id"):
        maps["plan_node"][str(r["id"])] = uuid5_int("plan_node", r["id"])
    return maps


def map_uuid(maps: dict[str, dict[Any, uuid.UUID]], key: str, src: Any) -> uuid.UUID | None:
    """源 ID → 目标 UUID；失败返回 None（目标列已是 uuid 类型，不保留源值）。"""
    if src is None:
        return None
    s = str(src).strip()
    if not s or s == "0":
        return None
    m = maps.get(key, {})
    return m.get(src) or m.get(s)


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True, future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    print("==> [1] 构建 maps (ps_plan_node / user / plan_node)")
    maps = build_maps()
    print(
        f"    ps_plan_node={len(maps['ps_plan_node'])} "
        f"user={len(maps['user'])} plan_node={len(maps['plan_node'])}"
    )

    print("==> [2] 重读源 ppm_ps_plan_node_module")
    rows = src_query("SELECT * FROM ppm_ps_plan_node_module ORDER BY id")
    print(f"    源模块数={len(rows)}")

    objs: list[PlanNodeModule] = []
    skipped = 0
    null_pn = 0
    null_user = 0
    for r in rows:
        if is_deleted(r):
            skipped += 1
            continue
        plan_node_id = map_uuid(maps, "ps_plan_node", r["plan_node_id"]) or map_uuid(
            maps, "plan_node", r["plan_node_id"]
        )
        duty_user_id = map_uuid(maps, "user", r["duty_user_id"])
        if plan_node_id is None:
            null_pn += 1
        if duty_user_id is None:
            null_user += 1
        objs.append(
            PlanNodeModule(
                id=uuid5_int("module", r["id"]),
                plan_node_id=plan_node_id,
                module_name=clean_str(r["module_name"], 255),
                plan_workload=clean_str(r["plan_workload"], 64),
                plan_begin_time=to_dt(r["plan_begin_time"]),
                plan_complete_time=to_dt(r["plan_complete_time"]),
                duty_user_id=duty_user_id,
            )
        )
    print(
        f"    待插入={len(objs)} 跳过(已删)={skipped} "
        f"plan_node未映射={null_pn} duty_user未映射={null_user}"
    )

    async with factory() as db:
        print("==> [3] 清空目标 ppm_plan_node_module（幂等）")
        await db.execute(text("DELETE FROM ppm_plan_node_module"))
        print("==> [4] 批量插入")
        db.add_all(objs)
        await db.commit()

        print("==> [5] 验证")
        total = (await db.execute(select(func.count()).select_from(PlanNodeModule))).scalar()
        with_fk = (
            await db.execute(
                select(func.count())
                .select_from(PlanNodeModule)
                .where(PlanNodeModule.plan_node_id.isnot(None))
            )
        ).scalar()
        print(f"    总数={total} 有plan_node_id={with_fk} NULL={total - with_fk}")
        sample = (
            await db.execute(
                select(PlanNodeModule.module_name)
                .where(PlanNodeModule.plan_node_id.isnot(None))
                .limit(3)
            )
        ).all()
        print(f"    抽样模块名: {[r[0] for r in sample]}")


if __name__ == "__main__":
    asyncio.run(main())
