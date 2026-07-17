"""problem 子域 4 节点审批流状态机。

问题清单审批流有两套状态:
- ``ProblemStatus``  (status 字段,1-7):业务生命周期状态
- ``ProblemNode``    (now_node 字段,10-40):流程当前审批节点

⚠️ 当前生效行为 (2026-07-17 起): 问题新建 / 编辑"提交"**不走审批**,
``submit_problem`` 直接把问题从 已保存(1) 推进到 处置中(3) 并分配给
责任人 (``now_node=None``)。下方 4 节点审批链 (申请→开发经理→项目经理
→部门经理) 仅保留给历史在审问题与审批表单 (``next_process``) 使用,
新建问题不再经过。

流转规则 (对照源 ``ProblemNode10/20/30/40`` + ``ProblemProcesssExecutor``,
design §12 存疑项已逐条核对):

节点链:申请(10) → 开发经理(20) → 项目经理(30) → 部门经理(40) → 结束
- 每个审核节点 (20/30/40) 由对应角色处理,处理完调用 nextProcess:
  - Node10 execute: 找"开发经理",推进到 Node20,status=2 审核中
  - Node20 execute: 找"项目经理",推进到 Node30,status=2 审核中
  - Node30 execute: 若 ``pro_type == bug`` 直接结束 (返回 None,跳过 40);
    否则找"部门经理"推进到 Node40,status=2 审核中
  - Node40 execute: 返回 None,结束节点,status=3 处置中
- 责任人 doneTask (completed=true):status=4 已完成 (新流程跳过验证,直接终态)
- (历史) 验证人 closeTask:status=6 待验证 → 4 已完成 / 打回 3 执行中;
  新流程已废弃,close_task 留存休眠
- 驳回 (rejectProcess,任一审核节点 20/30/40):status=5 已作废
  (源走 STATUS_SAVE;task-05.md 验收明确 reject→5,遵循 task 规范)
- 有未关闭变更 (problem_change.status != "2"):status 内存态标记 7 变更中
  (不持久化,仅列表查询时覆盖展示)

复用 ``app.modules.ppm.common.fsm`` 的 ``TransitionMap`` + helper。
设计依据:``tasks/task-05.md`` + ``design.md`` §8 + 源 ProblemNode*。
"""

from __future__ import annotations

from enum import IntEnum, StrEnum

from app.modules.ppm.common.fsm import TransitionMap


class ProblemStatus(StrEnum):
    """问题清单业务状态 (status 字段,1-7)。对齐源 ``ProblemListDO`` 常量。"""

    SAVED = "1"  # 已保存
    AUDITING = "2"  # 审核中 (历史审批流,新流程不再经过)
    DOING = "3"  # 执行中 (原"处置中";提交后直接进入,责任人处置中)
    CLOSED = "4"  # 已完成 (原"已关闭";doneTask 完成后进入,终态)
    BACK = "5"  # 已作废
    WAIT_CHECK = "6"  # 待验证 (新流程已废弃,close_task 留存休眠)
    CHANGING = "7"  # 变更中 (内存态,不持久化)


class ProblemNode(IntEnum):
    """问题审批流节点 (now_node 字段,10-40)。对齐源 ``ProblemProcessNode``。"""

    APPLY = 10  # 申请
    DEVELOP_MGR = 20  # 开发经理审批
    PM_MGR = 30  # 项目经理审批
    DEPT_MGR = 40  # 部门经理审批


# 节点序号 → 中文名 (源 ProblemProcessNode.getName)
NODE_NAMES: dict[int, str] = {
    ProblemNode.APPLY.value: "申请",
    ProblemNode.DEVELOP_MGR.value: "开发经理审批",
    ProblemNode.PM_MGR.value: "项目经理审批",
    ProblemNode.DEPT_MGR.value: "部门经理审批",
}

# 节点 → 处理该节点所需的项目角色 (源 getProjectMemberList(projectId, role))
NODE_TO_ROLE: dict[int, str] = {
    ProblemNode.DEVELOP_MGR.value: "开发经理",
    ProblemNode.PM_MGR.value: "项目经理",
    ProblemNode.DEPT_MGR.value: "部门经理",
}

# bug 类型:Node30 检测 pro_type==bug 时直接结束 (跳过部门经理 40)
BUG_TYPE = "bug"
# 问题类型常量 (源 TYPE_BUG / TYPE_CHANGE)
CHANGE_TYPE = "change"


# ===========================================================================
# status 状态机白名单
# ===========================================================================
# 业务状态合法迁移 (用于 service 层 assert_transition):
# - 1 已保存 → 2 审核中 (老的 nextProcess,仅审批表单再用) /
#               3 执行中 (新建/编辑"提交"直接生效,见 submit_problem)
# - 2 审核中 → 3 执行中 (审批通过,历史) / 5 已作废 (驳回)
# - 3 执行中 → 4 已完成 (doneTask 完工,新流程跳过验证直接终态) / 5 已作废
# - 6 待验证 → 4 已完成 / 3 执行中 (close_task,新流程已废弃,留存休眠)
# - 4 / 5 终态
# - 7 变更中是内存态,不参与持久化迁移
TRANSITIONS: TransitionMap[ProblemStatus] = {
    ProblemStatus.SAVED: {ProblemStatus.AUDITING, ProblemStatus.DOING},
    ProblemStatus.AUDITING: {
        ProblemStatus.DOING,
        ProblemStatus.BACK,
    },
    ProblemStatus.DOING: {
        ProblemStatus.CLOSED,
        ProblemStatus.BACK,
    },
    ProblemStatus.WAIT_CHECK: {
        ProblemStatus.CLOSED,
        ProblemStatus.DOING,
    },
    ProblemStatus.CLOSED: set(),
    ProblemStatus.BACK: set(),
    ProblemStatus.CHANGING: set(),  # 内存态,不可从持久化状态直接迁移到 7
}


# ===========================================================================
# 节点跳转表 (nextNode)
# ===========================================================================
# 当前节点 → 推进后的下一节点 (None = 结束节点,流程进入处置中)。
# Node30 对 bug 类型特殊处理由 service 层 (compute_next_node) 处理,
# 本表只表达非 bug 的常规链路。
NODE_NEXT: dict[int, int | None] = {
    ProblemNode.APPLY.value: ProblemNode.DEVELOP_MGR.value,  # 10 → 20
    ProblemNode.DEVELOP_MGR.value: ProblemNode.PM_MGR.value,  # 20 → 30
    ProblemNode.PM_MGR.value: ProblemNode.DEPT_MGR.value,  # 30 → 40 (非 bug)
    ProblemNode.DEPT_MGR.value: None,  # 40 → 结束
}


def compute_next_node(now_node: int, pro_type: str | None) -> int | None:
    """计算下一节点,内嵌 bug 跳过部门经理规则。

    对照源 ``ProblemNode30.execute``:若 ``pro_type == bug``,Node30 直接
    返回 None (结束),不推进到 Node40。

    Args:
        now_node: 当前节点 (10/20/30/40)。
        pro_type: 问题类型 (bug / change / 其他)。

    Returns:
        下一节点序号;``None`` 表示流程结束 (进入处置中状态)。
    """
    # Node30 + bug → 直接结束 (跳过部门经理 40)
    if now_node == ProblemNode.PM_MGR.value and pro_type == BUG_TYPE:
        return None
    return NODE_NEXT.get(now_node)


def is_audit_node(now_node: int) -> bool:
    """是否为审核节点 (20/30/40) —— 这些节点可驳回。"""
    return now_node in (
        ProblemNode.DEVELOP_MGR.value,
        ProblemNode.PM_MGR.value,
        ProblemNode.DEPT_MGR.value,
    )


# ===========================================================================
# 问题变更审批流状态 (源 ProblemChangeDO 常量)
# ===========================================================================


class ProblemChangeStatus(StrEnum):
    """问题变更状态 (源 ProblemChangeDO):1 审核中 / 2 已完成 / 3 已作废。"""

    AUDITING = "1"
    CLOSED = "2"
    BACK = "3"


# 变更状态合法迁移:审核中 → 已完成 (next 结束) / 已作废 (reject)
CHANGE_TRANSITIONS: TransitionMap[ProblemChangeStatus] = {
    ProblemChangeStatus.AUDITING: {
        ProblemChangeStatus.CLOSED,
        ProblemChangeStatus.BACK,
    },
    ProblemChangeStatus.CLOSED: set(),
    ProblemChangeStatus.BACK: set(),
}


# ===========================================================================
# 问题变更审批流节点 (task-02:复用 ProblemNode 数值,4 节点链)
# ===========================================================================

# 变更流与问题主流同构 (申请→开发经理→项目经理→[非bug部门经理]→结束),
# 节点数值复用 ``ProblemNode`` (10/20/30/40),不单独定义新 IntEnum,
# 仅提供变更流专用的下一节点计算 helper (内嵌 bug 跳部门经理规则)。


# 变更流节点 → 下一节点 (None = 结束);bug 跳部门经理由 compute_change_next_node 处理
CHANGE_NODE_NEXT: dict[int, int | None] = {
    ProblemNode.APPLY.value: ProblemNode.DEVELOP_MGR.value,  # 10 → 20
    ProblemNode.DEVELOP_MGR.value: ProblemNode.PM_MGR.value,  # 20 → 30
    ProblemNode.PM_MGR.value: ProblemNode.DEPT_MGR.value,  # 30 → 40 (非 bug)
    ProblemNode.DEPT_MGR.value: None,  # 40 → 结束
}


def compute_change_next_node(now_node: int, pro_type: str | None) -> int | None:
    """变更流下一节点计算 (内嵌 bug 跳部门经理 40)。

    对照源 ``ProChangeProcesssExecutor``:bug 类型在 Node30 直接结束,
    跳过部门经理审批 (40)。其余类型走标准 4 节点链。

    Args:
        now_node: 当前节点 (10/20/30/40)。
        pro_type: 变更关联的问题类型 (bug / change / 其他)。

    Returns:
        下一节点序号;``None`` 表示流程结束 (status=2 已完成)。
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
    "NODE_NEXT",
    "NODE_TO_ROLE",
    "TRANSITIONS",
    "ProblemChangeStatus",
    "ProblemNode",
    "ProblemStatus",
    "compute_change_next_node",
    "compute_next_node",
    "is_audit_node",
    "is_change_audit_node",
]
