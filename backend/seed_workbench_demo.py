"""工作台演示数据种子脚本（幂等）。

为 admin 用户造一批真实 PPM 业务数据，覆盖个人工作台 profile / summary /
calendar + 个人任务表的各口径，便于验证工作台聚合是否正确。

幂等：重跑前先按 content / pro_desc / execute_info 前缀 '【工作台演示】'
清理旧数据，再重新造；组织/关联/admin 属性为 upsert。

运行（容器内，复用 app 的 async engine）:
    docker exec multi-agent-platform-backend-1 python /tmp/seed_workbench_demo.py

数据设计（假设今天是 2026-07-14 周二；本周一=07-13，本月=[07-01,08-01)）:
  PlanTask:
    T1 已完成   start=07-10  (本月已完成 1)
    T2 进行中   start=07-13  end=07-20  (本月+本周，未延期)
    T3 进行中   start=07-08  end=07-11  (本月，已延期 1)
    T4 未开始   start=07-16  end=07-18  (本月+本周)
    T5 已完成   start=06-20  end=06-25  (仅 all 口径)
    T6 进行中   start=07-05  end=07-25  (本月，未延期)
  TaskExecute (工时, execute_user=admin):
    E1 3.5h  actual=07-10   (本月)
    E2 4.0h  actual=今天     (本月+本周)
    E3 99h   actual=06-15   (区间外，不计)
  PpmProblemList (duty_user=admin):
    P1 status=3(处置中) now_handle 含 admin  → defect + 待办
    P2 status=4(已关闭)                      → 不计
    P3 status=2(审核中) now_handle 他人       → defect，但不进待办

预期:
  range=month: task_count=5 completion=0.2 delay=0.2 work_hours=7.5 defect=2
  range=week : task_count=2 completion=0   delay=0   work_hours=4.0 defect=2
  range=all  : task_count=6 completion=2/6 delay=1/6 work_hours=106.5 defect=2
  todos      : problem×1(P1) + plan_task×4(T2,T3,T4,T6) = 5
  calendar   : 07-08/10/13/16/05 各 1 条；07-08 alert=over(T3 延期)
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select

from app.core.db import get_session_factory
from app.modules.admin.model import Organization, UserOrganization
from app.modules.auth.model import User
from app.modules.ppm.problem.model import PpmProblemList
from app.modules.ppm.task.model import PlanTask, TaskExecute

ADMIN_ID = uuid.UUID(
    "cd487ba2-f52c-4bec-9e4f-1673b510044b"
)  # admin 用户 id（参考值；运行时按 username 取，避免 uuid 抄错）
TAG = "【工作台演示】"
ORG_CODE = "DEMO-PPM-DEV"


def _day(year: int, month: int, day: int, hour: int = 9) -> datetime:
    return datetime(year, month, day, hour, 0, 0, tzinfo=UTC)


async def main() -> None:
    factory = get_session_factory()
    async with factory() as session:
        # ---------------- 0. 幂等清理旧演示数据 ----------------
        await session.execute(delete(TaskExecute).where(TaskExecute.execute_info.like(f"{TAG}%")))
        await session.execute(delete(PlanTask).where(PlanTask.content.like(f"{TAG}%")))
        await session.execute(delete(PpmProblemList).where(PpmProblemList.pro_desc.like(f"{TAG}%")))
        org_ids_subq = select(Organization.id).where(Organization.code == ORG_CODE)
        await session.execute(
            delete(UserOrganization).where(UserOrganization.organization_id.in_(org_ids_subq))
        )
        await session.execute(delete(Organization).where(Organization.code == ORG_CODE))
        await session.flush()

        # ---------------- 1. 补 admin 业务属性 ----------------
        # 按 username 取 admin（不硬编码 uuid，避免抄错 id）。
        admin = (
            await session.execute(select(User).where(User.username == "admin"))
        ).scalar_one_or_none()
        if admin is None:
            raise SystemExit("admin user not found")
        admin.display_name = "李明哲"
        admin.employee_no = "EMP-0001"

        # ---------------- 2. 建组织 + 关联 admin ----------------
        org = Organization(name="产品研发中心", code=ORG_CODE, status="active")
        session.add(org)
        await session.flush()
        session.add(UserOrganization(user_id=ADMIN_ID, organization_id=org.id))

        # ---------------- 3. 造 PlanTask（覆盖各口径）----------------
        now = datetime.now(UTC)
        y, m = now.year, now.month
        prev_m = m - 1 if m > 1 else 12
        prev_y = y if m > 1 else y - 1
        monday = now.date() - timedelta(days=now.weekday())  # 本周一
        week_monday = datetime(monday.year, monday.month, monday.day, 9, 0, 0, tzinfo=UTC)
        thursday = week_monday + timedelta(days=3)  # 本周四

        def mk_plan(status, start, end, proj, mod, tag):
            return PlanTask(
                user_id=ADMIN_ID,
                user_name="李明哲",
                status=status,
                start_time=start,
                end_time=end,
                project_name=f"{TAG}{proj}",
                module_name=mod,
                content=f"{TAG}{tag}",
            )

        plans = [
            mk_plan(
                "已完成", _day(y, m, 10), _day(y, m, 9), "智能看板", "前端", "T1-已完成(本月10号)"
            ),
            mk_plan(
                "进行中",
                week_monday,
                week_monday + timedelta(days=7),
                "智能看板",
                "后端",
                "T2-进行中未延期(本周一开,下周一截止)",
            ),
            mk_plan(
                "进行中",
                _day(y, m, 8),
                _day(y, m, 11),
                "缺陷管理",
                "后端",
                "T3-进行中已延期(本月8号开,11号截止)",
            ),
            mk_plan(
                "未开始",
                thursday,
                thursday + timedelta(days=2),
                "个人工作台",
                "前端",
                "T4-未开始(本周四开)",
            ),
            mk_plan(
                "已完成",
                _day(prev_y, prev_m, 20),
                _day(prev_y, prev_m, 25),
                "里程碑",
                "产品",
                "T5-已完成(上月,仅all口径)",
            ),
            mk_plan(
                "进行中",
                _day(y, m, 5),
                _day(y, m, 25),
                "缺陷管理",
                "前端",
                "T6-进行中未延期(本月5号开,25号截止)",
            ),
        ]
        for p in plans:
            session.add(p)
        await session.flush()

        # ---------------- 4. 造 TaskExecute（工时）----------------
        today_10 = now.replace(hour=10, minute=0, second=0, microsecond=0)
        today_13 = now.replace(hour=13, minute=0, second=0, microsecond=0)
        executes = [
            TaskExecute(
                execute_user_id=ADMIN_ID,
                time_spent=3.5,
                actual_start_time=_day(y, m, 10, 10),
                actual_end_time=_day(y, m, 10, 13),
                execute_info=f"{TAG}E1-本月工时3.5h",
            ),
            TaskExecute(
                execute_user_id=ADMIN_ID,
                time_spent=4.0,
                actual_start_time=today_10,
                actual_end_time=today_13,
                execute_info=f"{TAG}E2-本周工时4.0h",
            ),
            TaskExecute(
                execute_user_id=ADMIN_ID,
                time_spent=99.0,
                actual_start_time=_day(prev_y, prev_m, 15, 10),
                actual_end_time=_day(prev_y, prev_m, 15, 13),
                execute_info=f"{TAG}E3-上月工时(区间外不计)",
            ),
        ]
        for e in executes:
            session.add(e)

        # ---------------- 5. 造 PpmProblemList（缺陷/待办）----------------
        problems = [
            PpmProblemList(
                project_id=uuid.uuid4(),
                project_name=f"{TAG}智能看板",
                pro_desc=f"{TAG}P1-处置中缺陷(待我处理)",
                duty_user_id=ADMIN_ID,
                status="3",
                now_handle_user=str(ADMIN_ID),
            ),
            PpmProblemList(
                project_id=uuid.uuid4(),
                project_name=f"{TAG}缺陷管理",
                pro_desc=f"{TAG}P2-已关闭缺陷",
                duty_user_id=ADMIN_ID,
                status="4",
                now_handle_user=str(ADMIN_ID),
            ),
            PpmProblemList(
                project_id=uuid.uuid4(),
                project_name=f"{TAG}里程碑",
                pro_desc=f"{TAG}P3-审核中缺陷(非我处理)",
                duty_user_id=ADMIN_ID,
                status="2",
                now_handle_user=str(uuid.uuid4()),
            ),
        ]
        for p in problems:
            session.add(p)

        await session.commit()

        # ---------------- 汇总 ----------------
        pt = (
            (await session.execute(select(PlanTask).where(PlanTask.content.like(f"{TAG}%"))))
            .scalars()
            .all()
        )
        te = (
            (
                await session.execute(
                    select(TaskExecute).where(TaskExecute.execute_info.like(f"{TAG}%"))
                )
            )
            .scalars()
            .all()
        )
        pp = (
            (
                await session.execute(
                    select(PpmProblemList).where(PpmProblemList.pro_desc.like(f"{TAG}%"))
                )
            )
            .scalars()
            .all()
        )
        print(f"✅ 已造演示数据: PlanTask={len(pt)} TaskExecute={len(te)} PpmProblemList={len(pp)}")
        print(f"   admin.display_name={admin.display_name} employee_no={admin.employee_no}")
        print(f"   组织={org.name}({org.code}) now={now.isoformat()} 本周一={week_monday.date()}")


if __name__ == "__main__":
    asyncio.run(main())
