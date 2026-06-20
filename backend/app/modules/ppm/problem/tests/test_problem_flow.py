"""problem 子域 service 单测 (task-05 验收)。

重点测 4 节点审批流全路径 + bug 跳过部门经理 + 驳回 + 变更标记 +
找不到处理人 fallback + ProcessLog/ProcessTask 联动。

使用根 conftest 的 in-memory SQLite ``db_session`` fixture。
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import InvalidTransition
from app.modules.ppm.common.crud import PageReq
from app.modules.ppm.problem.fsm import (
    NODE_NAMES,
    ProblemChangeStatus,
    ProblemNode,
    ProblemStatus,
    compute_change_next_node,
    compute_next_node,
)
from app.modules.ppm.problem.service import (
    ProblemError,
    ProblemNotFound,
    ProblemPendingAssignment,
    ProblemService,
)
from app.modules.ppm.project.model import PpmProjectMember

_ACTOR = ("actor-001", "张三")


# ===========================================================================
# helper: 建项目 + 成员 + 问题
# ===========================================================================


async def _make_project(
    session: AsyncSession,
    *,
    develop: bool = True,
    pm: bool = True,
    dept: bool = True,
) -> str:
    """建一个 ppm_project_maintenance + 按需配 3 个角色成员,返回 project_id 字符串。"""
    import uuid as _uuid

    from app.modules.ppm.project.model import PpmProjectMaintenance

    proj_id = _uuid.uuid4()
    session.add(
        PpmProjectMaintenance(
            id=proj_id, project_code=f"P-{proj_id.hex[:6]}", project_name="项目甲"
        )
    )
    roles: list[tuple[bool, str, str]] = [
        (develop, "开发经理", "李开发"),
        (pm, "项目经理", "王项目"),
        (dept, "部门经理", "赵部门"),
    ]
    for flag, role, name in roles:
        if flag:
            session.add(
                PpmProjectMember(
                    id=_uuid.uuid4(),
                    pm_project_id=proj_id,
                    user_id=_uuid.uuid4(),
                    user_name=name,
                    role_name=role,
                )
            )
    await session.commit()
    return str(proj_id)


async def _make_problem(
    svc: ProblemService,
    project_id: str,
    *,
    pro_type: str | None = None,
    duty_user_id: str = "duty-001",
    duty_user_name: str = "钱责任",
    audit_user_id: str | None = "audit-001",
    audit_user_name: str | None = "孙验证",
) -> object:
    return await svc.create_problem(
        {
            "project_id": project_id,
            "project_name": "项目甲",
            "pro_desc": "发现一个 bug",
            "pro_type": pro_type,
            "duty_user_id": duty_user_id,
            "duty_user_name": duty_user_name,
            "audit_user_id": audit_user_id,
            "audit_user_name": audit_user_name,
        }
    )


# ===========================================================================
# CRUD
# ===========================================================================


class TestCrud:
    async def test_create_get_update_delete(self, db_session: AsyncSession) -> None:
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        assert p.status == ProblemStatus.SAVED.value
        assert p.now_node == ProblemNode.APPLY.value

        got = await svc.get_problem(p.id)
        assert got.id == p.id

        updated = await svc.update_problem(p.id, {"pro_desc": "修改描述"})
        assert updated.pro_desc == "修改描述"

        await svc.delete_problem(p.id)
        with pytest.raises(ProblemNotFound):
            await svc.get_problem(p.id)

    async def test_list_paged_with_changing_flag(self, db_session: AsyncSession) -> None:
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        # 建一条未关闭变更 (status=1 审核中)
        await svc.create_change(
            {"resource_id": str(p.id), "project_id": proj_id, "change_reason": "x"}
        )
        page = await svc.list_problems(PageReq(page=1, page_size=10))
        assert page.total == 1
        # 有未关闭变更 → 内存态 effective_status=7 变更中
        assert page.items[0].effective_status == ProblemStatus.CHANGING.value
        # 但持久化 status 不变 (仍为 1 已保存),内存覆盖不落库
        assert page.items[0].status == ProblemStatus.SAVED.value
        fresh = await svc.get_problem(p.id)
        assert fresh.status == ProblemStatus.SAVED.value


# ===========================================================================
# 审批流:全主流程 (非 bug:10→20→30→40→处置→待验证→关闭)
# ===========================================================================


class TestFullFlow:
    async def test_non_bug_full_flow(self, db_session: AsyncSession) -> None:
        """非 bug 全路径:申请→开发经理→项目经理→部门经理→处置中→待验证→已关闭。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="requirement")
        pid = p.id

        # 10→20 开发经理审批
        p = await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert p.status == ProblemStatus.AUDITING.value
        assert p.now_node == ProblemNode.DEVELOP_MGR.value
        assert "李开发" in (p.now_handle_user_name or "")

        # 20→30 项目经理审批
        p = await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert p.now_node == ProblemNode.PM_MGR.value
        assert "王项目" in (p.now_handle_user_name or "")

        # 30→40 部门经理审批 (非 bug)
        p = await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert p.now_node == ProblemNode.DEPT_MGR.value
        assert "赵部门" in (p.now_handle_user_name or "")

        # 40→结束 (处置中)
        p = await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert p.status == ProblemStatus.DOING.value
        assert p.now_node is None
        # 处置人 = 责任人
        assert p.now_handle_user == "duty-001"

        # doneTask completed → 待验证
        p = await svc.done_task(
            pid, actor_id="duty-001", actor_name="钱责任", handle_info="已修复", completed=True
        )
        assert p.status == ProblemStatus.WAIT_CHECK.value
        assert p.now_handle_user == "audit-001"  # 切到验证人
        assert p.real_end_time is not None

        # closeTask check_result=1 → 已关闭
        p = await svc.close_task(
            pid, actor_id="audit-001", actor_name="孙验证", check_result="1", check_info="验证通过"
        )
        assert p.status == ProblemStatus.CLOSED.value
        assert p.now_handle_user is None
        assert p.check_time is not None

    async def test_bug_skips_dept_manager(self, db_session: AsyncSession) -> None:
        """bug 类型:申请→开发经理→项目经理→直接结束 (跳过部门经理 40)。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        pid = p.id

        # 10→20
        await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        # 20→30
        p = await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert p.now_node == ProblemNode.PM_MGR.value

        # 30→结束 (bug 跳过 40,直接处置中)
        p = await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert p.status == ProblemStatus.DOING.value
        assert p.now_node is None  # 未经过 40

    async def test_reject_to_back(self, db_session: AsyncSession) -> None:
        """驳回 (审核节点) → status=5 已作废。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="requirement")
        pid = p.id

        # 推进到 20 开发经理
        await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        # 在 20 节点驳回
        p = await svc.reject_process(
            pid, actor_id="dev-001", actor_name="李开发", comment="描述不清"
        )
        assert p.status == ProblemStatus.BACK.value
        assert p.now_node is None
        assert p.now_handle_user is None

    async def test_close_reject_back_to_duty(self, db_session: AsyncSession) -> None:
        """closeTask check_result != 1 → 打回责任人,处置中。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        pid = p.id

        # bug 快速到处置中 (10→20→30→结束)
        await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert p.status == ProblemStatus.DOING.value
        # doneTask → 待验证
        await svc.done_task(pid, actor_id="duty-001", actor_name="钱责任", completed=True)
        # closeTask 打回 (check_result=0)
        p = await svc.close_task(
            pid, actor_id="audit-001", actor_name="孙验证", check_result="0", check_info="未修复"
        )
        assert p.status == ProblemStatus.DOING.value
        assert p.now_handle_user == "duty-001"  # 切回责任人


# ===========================================================================
# X-003 fallback:找不到处理人
# ===========================================================================


class TestFallback:
    async def test_missing_develop_manager_pending(self, db_session: AsyncSession) -> None:
        """项目无开发经理 → next_process 推进但抛 ProblemPendingAssignment。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session, develop=False)
        p = await _make_problem(svc, proj_id, pro_type="requirement")
        pid = p.id

        # 推进应抛 ProblemPendingAssignment (X-003),但 now_node 已更新到 20
        with pytest.raises(ProblemPendingAssignment):
            await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        fresh = await svc.get_problem(pid)
        assert fresh.now_node == ProblemNode.DEVELOP_MGR.value  # 节点已推进
        assert fresh.now_handle_user is None  # 但缺处理人
        assert fresh.status == ProblemStatus.AUDITING.value

    async def test_missing_dept_manager_bug_ok(self, db_session: AsyncSession) -> None:
        """bug + 无部门经理:Node30 直接结束,不需要部门经理,不抛 pending。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session, dept=False)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        pid = p.id

        # 10→20 (有开发经理)
        await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        # 20→30 (有项目经理)
        await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        # 30→结束 (bug 跳过部门经理,即使无部门经理也 OK)
        p = await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert p.status == ProblemStatus.DOING.value

    async def test_invalid_reject_on_apply_node(self, db_session: AsyncSession) -> None:
        """申请节点 (10) 不可驳回。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        with pytest.raises(ProblemError):
            await svc.reject_process(p.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])


# ===========================================================================
# ProcessLog / ProcessTask 联动
# ===========================================================================


class TestProcessAudit:
    async def test_each_step_writes_log_and_task(self, db_session: AsyncSession) -> None:
        """每次流转:写一行 ProcessLog + 在办 ProcessTask 删旧插新。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        pid = p.id

        # 3 次推进 (10→20→30→结束)
        for _ in range(3):
            await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        logs = await svc.list_list_logs(str(pid))
        assert len(logs) == 3  # 每次推进一行
        # 节点序号 10/20/30
        assert [log.node_key for log in logs] == ["10", "20", "30"]

        # 在办任务:最后一次推进后只剩一条 (当前节点 end/处置)
        tasks = await svc.list_list_tasks(str(pid))
        assert len(tasks) == 1
        assert tasks[0].node_key == "end"

    async def test_reject_clears_tasks(self, db_session: AsyncSession) -> None:
        """驳回后清空所有在办任务。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="requirement")
        pid = p.id

        await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])  # 到 20
        tasks = await svc.list_list_tasks(str(pid))
        assert len(tasks) == 1

        await svc.reject_process(pid, actor_id="dev-001", actor_name="李开发")
        tasks = await svc.list_list_tasks(str(pid))
        assert len(tasks) == 0

    async def test_done_appends_handle_info_and_time(self, db_session: AsyncSession) -> None:
        """doneTask 追加 handle_info + 累加 time_spent。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        pid = p.id

        # 快速到处置中
        for _ in range(3):
            await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        # 第一次 done (completed=false,追加处置情况 + 累加工时)
        p = await svc.done_task(
            pid,
            actor_id="duty-001",
            actor_name="钱责任",
            handle_info="排查中",
            time_spent=1.5,
            completed=False,
        )
        assert p.status == ProblemStatus.DOING.value
        assert "排查中" in (p.handle_info or "")
        assert float(p.time_spent or 0) == 1.5

        # 第二次 done (completed=true,再次累加)
        p = await svc.done_task(
            pid,
            actor_id="duty-001",
            actor_name="钱责任",
            handle_info="已修复",
            time_spent=0.5,
            completed=True,
        )
        assert p.status == ProblemStatus.WAIT_CHECK.value
        assert float(p.time_spent or 0) == 2.0  # 1.5 + 0.5


# ===========================================================================
# fsm 纯函数
# ===========================================================================


class TestFsmPure:
    def test_compute_next_node_chain(self) -> None:
        # 非 bug:10→20→30→40→None
        assert compute_next_node(10, "requirement") == 20
        assert compute_next_node(20, "requirement") == 30
        assert compute_next_node(30, "requirement") == 40
        assert compute_next_node(40, "requirement") is None

    def test_compute_next_node_bug_skips_40(self) -> None:
        # bug:30 直接结束 (跳过 40)
        assert compute_next_node(30, "bug") is None
        assert compute_next_node(20, "bug") == 30
        assert compute_next_node(10, "bug") == 20

    def test_node_names_cover_all(self) -> None:
        for n in (10, 20, 30, 40):
            assert n in NODE_NAMES


# ===========================================================================
# 问题变更 CRUD
# ===========================================================================


class TestProblemChange:
    async def test_change_crud(self, db_session: AsyncSession) -> None:
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)

        c = await svc.create_change(
            {
                "resource_id": str(p.id),
                "project_id": proj_id,
                "change_reason": "需求变更",
                "pro_desc": "新描述",
            }
        )
        assert c.status == ProblemChangeStatus.AUDITING.value

        got = await svc.get_change(c.id)
        assert got.change_reason == "需求变更"

        updated = await svc.update_change(c.id, {"change_reason": "重新变更"})
        assert updated.change_reason == "重新变更"

        by_resource = await svc.list_changes_by_resource(str(p.id))
        assert len(by_resource) == 1

        await svc.delete_change(c.id)
        with pytest.raises(ProblemNotFound):
            await svc.get_change(c.id)


# ===========================================================================
# 非法迁移
# ===========================================================================


class TestInvalidTransition:
    async def test_done_on_saved_rejected(self, db_session: AsyncSession) -> None:
        """非处置中状态不可 doneTask completed。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)  # status=1 已保存
        with pytest.raises(InvalidTransition):
            await svc.done_task(p.id, actor_id="duty-001", actor_name="钱责任", completed=True)

    async def test_close_on_closed_rejected(self, db_session: AsyncSession) -> None:
        """已关闭不可再 close。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        pid = p.id
        for _ in range(3):
            await svc.next_process(pid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        await svc.done_task(pid, actor_id="duty-001", actor_name="钱责任", completed=True)
        await svc.close_task(pid, actor_id="audit-001", actor_name="孙验证")
        # 再次 close → 4 是终态,非法
        with pytest.raises(InvalidTransition):
            await svc.close_task(pid, actor_id="audit-001", actor_name="孙验证")


# ===========================================================================
# 问题变更审批流 (task-02:4 节点 + bug 跳部门经理 + reject)
# ===========================================================================


async def _make_change(
    svc: ProblemService,
    project_id: str,
    resource_id: str,
    *,
    pro_type: str | None = None,
    audit_user_id: str = "audit-001",
    audit_user_name: str = "孙验证",
) -> object:
    return await svc.create_change(
        {
            "resource_id": resource_id,
            "project_id": project_id,
            "pro_type": pro_type,
            "audit_user_id": audit_user_id,
            "audit_user_name": audit_user_name,
        }
    )


class TestChangeFlow:
    """变更流 4 节点全路径 (task-02 AC-1..AC-5)。"""

    async def test_change_full_flow_non_bug(self, db_session: AsyncSession) -> None:
        """非 bug:申请(10)→开发经理(20)→项目经理(30)→部门经理(40)→结束(已完成)。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="requirement")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="requirement")
        cid = c.id

        # 10→20 开发经理审批
        c = await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert c.status == ProblemChangeStatus.AUDITING.value
        assert c.now_node == ProblemNode.DEVELOP_MGR.value
        assert "李开发" in (c.now_handle_user_name or "")

        # 20→30 项目经理审批
        c = await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert c.now_node == ProblemNode.PM_MGR.value
        assert "王项目" in (c.now_handle_user_name or "")

        # 30→40 部门经理审批 (非 bug)
        c = await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert c.now_node == ProblemNode.DEPT_MGR.value
        assert "赵部门" in (c.now_handle_user_name or "")

        # 40→结束 (已完成)
        c = await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        assert c.status == ProblemChangeStatus.CLOSED.value
        assert c.now_node is None
        # 结束后处理人 = 验证人 (audit_user_id)
        assert c.now_handle_user == "audit-001"

    async def test_change_bug_skips_dept(self, db_session: AsyncSession) -> None:
        """bug:10→20→30→直接结束 (跳过部门经理 40)。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="bug")
        cid = c.id

        await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])  # 10→20
        await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])  # 20→30
        c = await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])  # 30→结束
        assert c.status == ProblemChangeStatus.CLOSED.value
        assert c.now_node is None  # 未经过 40

    async def test_change_reject_to_back(self, db_session: AsyncSession) -> None:
        """审核节点 (20) reject → status=3 已作废,清空在办任务。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="requirement")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="requirement")
        cid = c.id

        # 推到 20 开发经理
        await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        # 在 20 节点驳回
        c = await svc.reject_change(
            cid, actor_id="dev-001", actor_name="李开发", comment="描述不清"
        )
        assert c.status == ProblemChangeStatus.BACK.value
        assert c.now_node is None
        assert c.now_handle_user is None

        # 驳回后清空所有在办任务
        tasks = await svc.list_change_tasks(str(cid))
        assert len(tasks) == 0

    async def test_change_reject_on_apply_rejected(self, db_session: AsyncSession) -> None:
        """申请节点 (10) 不可驳回。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id)
        c = await _make_change(svc, proj_id, str(p.id))
        with pytest.raises(ProblemError):
            await svc.reject_change(c.id, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

    async def test_change_missing_role_pending(self, db_session: AsyncSession) -> None:
        """项目无项目经理 → next_change 推进到 30 但抛 ProblemPendingAssignment。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session, pm=False)
        p = await _make_problem(svc, proj_id, pro_type="requirement")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="requirement")
        cid = c.id

        # 10→20 (有开发经理)
        await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])
        # 20→30 (无项目经理 → 抛 pending,但 now_node 已推进)
        with pytest.raises(ProblemPendingAssignment):
            await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        fresh = await svc.get_change(cid)
        assert fresh.now_node == ProblemNode.PM_MGR.value  # 节点已推进
        assert fresh.now_handle_user is None  # 但缺处理人
        assert fresh.status == ProblemChangeStatus.AUDITING.value

    async def test_change_each_step_writes_log(self, db_session: AsyncSession) -> None:
        """每次 next_change:写一行 ChangeProcessLog + 删旧插新 ChangeProcessTask。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="bug")
        cid = c.id

        # 3 次推进 (10→20→30→结束)
        for _ in range(3):
            await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        logs = await svc.list_change_logs(str(cid))
        assert len(logs) == 3  # 每次推进一行
        assert [log.node_key for log in logs] == ["10", "20", "30"]

        # 在办任务:最后一次推进后只剩一条 (当前节点 end/已完成)
        tasks = await svc.list_change_tasks(str(cid))
        assert len(tasks) == 1
        assert tasks[0].node_key == "end"

    async def test_change_next_on_closed_rejected(self, db_session: AsyncSession) -> None:
        """已完成 (2) / 已作废 (3) 终态再 next → ProblemError。"""
        svc = ProblemService(db_session)
        proj_id = await _make_project(db_session)
        p = await _make_problem(svc, proj_id, pro_type="bug")
        c = await _make_change(svc, proj_id, str(p.id), pro_type="bug")
        cid = c.id

        # bug 三次推进到已完成
        for _ in range(3):
            await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])

        # 再次 next → 终态非法
        with pytest.raises(ProblemError):
            await svc.next_change(cid, actor_id=_ACTOR[0], actor_name=_ACTOR[1])


# ===========================================================================
# 变更流 fsm 纯函数
# ===========================================================================


class TestChangeFsmPure:
    def test_compute_change_next_node_chain(self) -> None:
        assert compute_change_next_node(10, "requirement") == 20
        assert compute_change_next_node(20, "requirement") == 30
        assert compute_change_next_node(30, "requirement") == 40
        assert compute_change_next_node(40, "requirement") is None

    def test_compute_change_next_node_bug_skips_40(self) -> None:
        assert compute_change_next_node(30, "bug") is None
        assert compute_change_next_node(20, "bug") == 30
        assert compute_change_next_node(10, "bug") == 20
