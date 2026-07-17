"""plan 子域里程碑明细状态机。

定义里程碑明细 (``PsPlanNodeDetail``) 的状态枚举与合法迁移白名单,
复用 ``app.modules.ppm.common.fsm`` 的 ``TransitionMap`` helper +
``StateMachine``。

状态语义 (对照源 ``PsPlanNodeDetailDO`` 的 audit/approve 流程 + 简化)：
- ``draft``     草稿 — 新建/返工,可提交审核
- ``review``    审核中 — 项目经理审核,通过→审批/驳回
- ``approve``   审批中 — 部门经理审批,通过→完成/驳回
- ``done``      已完成 — 终态
- ``rejected``  驳回 — 退回可重新进草稿返工
- ``archived``  归档 — 变更生成新版本后,旧版本归档 (终态,不再迁移)

变更 (changeProcess) 不走迁移：而是新建一条 ``parent_id`` 指向原版本
的 ``draft`` 新版本,旧版本置 ``archived`` (D-002@v1)。

设计依据：``tasks/task-04.md`` fsm.py 段 + ``design.md`` §8。
"""

from __future__ import annotations

from enum import StrEnum

from app.modules.ppm.common.fsm import TransitionMap


class PlanNodeDetailStatus(StrEnum):
    """里程碑明细状态。"""

    DRAFT = "draft"
    REVIEW = "review"
    APPROVE = "approve"
    DONE = "done"
    REJECTED = "rejected"
    ARCHIVED = "archived"


# 合法迁移白名单。
# - draft → review → approve → done (主流程)
# - review / approve 可驳回到 rejected
# - rejected → draft (返工重新提交)
# - done 不再迁移 (变更走新建版本,不改本记录状态)
# - archived 是变更归档终态,不再迁移
TRANSITIONS: TransitionMap[PlanNodeDetailStatus] = {
    PlanNodeDetailStatus.DRAFT: {PlanNodeDetailStatus.REVIEW, PlanNodeDetailStatus.DONE},
    PlanNodeDetailStatus.REVIEW: {
        PlanNodeDetailStatus.APPROVE,
        PlanNodeDetailStatus.REJECTED,
    },
    PlanNodeDetailStatus.APPROVE: {
        PlanNodeDetailStatus.DONE,
        PlanNodeDetailStatus.REJECTED,
    },
    PlanNodeDetailStatus.DONE: set(),
    PlanNodeDetailStatus.REJECTED: {PlanNodeDetailStatus.DRAFT},
    PlanNodeDetailStatus.ARCHIVED: set(),
}

# 业务类型常量 — 写入流程履历表 (``PsPlanNodeDetailProcess``)
PROCESS_BUSINESS_TYPE = "ps_plan_node_detail"


__all__ = [
    "PROCESS_BUSINESS_TYPE",
    "TRANSITIONS",
    "PlanNodeDetailStatus",
]
