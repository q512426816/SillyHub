"""problem 子域状态机（3 态简化版，2026-07-20）。

问题清单状态机简化为 3 态，对齐任务计划 PlanTask.status：
- ``ProblemStatus`` (status 字段)：「新建 / 进行中 / 已完成」中文 3 态。
- 流转：新建 ─开始─▶ 进行中 ─提交─▶ 新建（可重复执行）
                        └─完成─▶ 已完成（终态）

历史 4 节点审批链（申请→开发经理→项目经理→部门经理）已随 3 态简化删除
（``NODE_NAMES`` / ``NODE_TO_ROLE`` / ``NODE_NEXT`` / ``compute_next_node``
/ ``is_audit_node``）。``ProblemNode`` 枚举保留——问题变更流
``CHANGE_NODE_NEXT`` 仍依赖它（D-005：problem_change 后端模块 deprecated 保留）。

问题变更（problem_change）审批流状态机 ``ProblemChangeStatus`` /
``CHANGE_TRANSITIONS`` / ``compute_change_next_node`` / ``is_change_audit_node``
保留供 deprecated 的 problem_change service 引用，前端入口已停用。

设计依据：change 2026-07-20-problem-list-align-task-plan design.md §5/§8 + decisions.md D-001/D-003/D-005。
"""

from __future__ import annotations

from enum import IntEnum, StrEnum

from app.modules.ppm.common.fsm import TransitionMap


class ProblemStatus(StrEnum):
    """问题清单业务状态 (status 字段，3 态中文，对齐 PlanTask)。

    对齐 ``backend/app/modules/ppm/task/model.py`` PlanTask.status 的中文 3 态
    （未开始/进行中/已完成），问题清单用「新建」对应「未开始」。
    """

    NEW = "新建"  # 新建（可「开始」）
    DOING = "进行中"  # 进行中（可「执行」跨天填报）
    CLOSED = "已完成"  # 已完成（终态）


class ProblemNode(IntEnum):
    """问题审批流节点 (now_node 字段，10-40)。

    主流审批链已废弃（3 态简化），枚举保留供变更流 ``CHANGE_NODE_NEXT`` 依赖
    （D-005 problem_change deprecated 模块引用）。
    """

    APPLY = 10  # 申请
    DEVELOP_MGR = 20  # 开发经理审批
    PM_MGR = 30  # 项目经理审批
    DEPT_MGR = 40  # 部门经理审批


# 问题类型常量（变更流 compute_change_next_node 判 bug 跳部门经理用）
BUG_TYPE = "bug"
CHANGE_TYPE = "change"


# 节点序号 → 中文名（源 ProblemProcessNode.getName）
# 变更流 next_change/reject_change 写履历 handle_info 时用，保留（D-005）。
NODE_NAMES: dict[int, str] = {
    ProblemNode.APPLY.value: "申请",
    ProblemNode.DEVELOP_MGR.value: "开发经理审批",
    ProblemNode.PM_MGR.value: "项目经理审批",
    ProblemNode.DEPT_MGR.value: "部门经理审批",
}

# 节点 → 处理该节点所需的项目角色（源 getProjectMemberList(projectId, role)）
# 变更流 next_change 找角色成员时用，保留（D-005）。
NODE_TO_ROLE: dict[int, str] = {
    ProblemNode.DEVELOP_MGR.value: "开发经理",
    ProblemNode.PM_MGR.value: "项目经理",
    ProblemNode.DEPT_MGR.value: "部门经理",
}


# ===========================================================================
# 问题清单 status 状态机白名单（3 态）
# ===========================================================================
# - 新建 → 进行中（开始：建 in-flight TaskExecute）
# - 进行中 → 新建（执行-提交：回新建可再次开始 = 重复执行）
#          → 已完成（执行-完成：终态）
# - 已完成 终态（不可再迁移）
TRANSITIONS: TransitionMap[ProblemStatus] = {
    ProblemStatus.NEW: {ProblemStatus.DOING},
    ProblemStatus.DOING: {ProblemStatus.NEW, ProblemStatus.CLOSED},
    ProblemStatus.CLOSED: set(),
}


# ===========================================================================
# 问题变更审批流（deprecated，D-005；problem_change 后端模块保留，前端已停用）
# ===========================================================================


class ProblemChangeStatus(StrEnum):
    """问题变更状态（源 ProblemChangeDO）：1 审核中 / 2 已完成 / 3 已作废。"""

    AUDITING = "1"
    CLOSED = "2"
    BACK = "3"


# 变更状态合法迁移：审核中 → 已完成 (next 结束) / 已作废 (reject)
CHANGE_TRANSITIONS: TransitionMap[ProblemChangeStatus] = {
    ProblemChangeStatus.AUDITING: {
        ProblemChangeStatus.CLOSED,
        ProblemChangeStatus.BACK,
    },
    ProblemChangeStatus.CLOSED: set(),
    ProblemChangeStatus.BACK: set(),
}


# 变更流节点 → 下一节点 (None = 结束)；bug 跳部门经理由 compute_change_next_node 处理
CHANGE_NODE_NEXT: dict[int, int | None] = {
    ProblemNode.APPLY.value: ProblemNode.DEVELOP_MGR.value,  # 10 → 20
    ProblemNode.DEVELOP_MGR.value: ProblemNode.PM_MGR.value,  # 20 → 30
    ProblemNode.PM_MGR.value: ProblemNode.DEPT_MGR.value,  # 30 → 40 (非 bug)
    ProblemNode.DEPT_MGR.value: None,  # 40 → 结束
}


def compute_change_next_node(now_node: int, pro_type: str | None) -> int | None:
    """变更流下一节点计算（内嵌 bug 跳部门经理 40）。

    对照源 ``ProChangeProcesssExecutor``：bug 类型在 Node30 直接结束，
    跳过部门经理审批 (40)。其余类型走标准 4 节点链。

    Args:
        now_node: 当前节点 (10/20/30/40)。
        pro_type: 变更关联的问题类型 (bug / change / 其他)。

    Returns:
        下一节点序号；``None`` 表示流程结束 (status=2 已完成)。
    """
    if now_node == ProblemNode.PM_MGR.value and pro_type == BUG_TYPE:
        return None
    return CHANGE_NODE_NEXT.get(now_node)


def is_change_audit_node(now_node: int) -> bool:
    """变更流是否处于审核节点 (20/30/40) —— 这些节点可驳回。"""
    return now_node in (
        ProblemNode.DEVELOP_MGR.value,
        ProblemNode.PM_MGR.value,
        ProblemNode.DEPT_MGR.value,
    )


__all__ = [
    "BUG_TYPE",
    "CHANGE_NODE_NEXT",
    "CHANGE_TRANSITIONS",
    "CHANGE_TYPE",
    "NODE_NAMES",
    "NODE_TO_ROLE",
    "TRANSITIONS",
    "ProblemChangeStatus",
    "ProblemNode",
    "ProblemStatus",
    "compute_change_next_node",
    "is_change_audit_node",
]
