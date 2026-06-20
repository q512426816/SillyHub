"""轻量状态机基类 —— ppm 各子域审批流/里程碑状态机共用。

参照 ``app.modules.change.model`` 的 ``StageEnum`` + ``TRANSITIONS`` 白名单
模式：状态用枚举/字符串表示，合法迁移以 ``dict[state, set[state]]`` (或
``dict[state, dict[state, list[action]]]``) 描述，非白名单迁移抛
``InvalidTransition`` (409/422 由 errors.py 统一映射)。

各子域 (problem 4 节点审批流 / milestone / task 等) 自行定义自己的
``TRANSITIONS`` 字典 + 状态枚举，调用本模块的 helper 完成校验，而非各自
重写状态机逻辑。

设计依据：
- ``design.md`` §5 (状态机参照 change.TRANSITIONS)
- ``change/model.py`` 的 TRANSITIONS 白名单 + can_transition
- ``core/errors.py`` 的 InvalidTransition (HTTP_422)
"""

from __future__ import annotations

from app.core.errors import InvalidTransition

# 两条等价出口：``InvalidTransition`` 是 errors.py 的正式 AppError 子类
# (统一错误码 HTTP_422_INVALID_TRANSITION)；``IllegalTransition`` 别名
# 与设计文档 / task-01.md 命名一致，调用方可择一使用。
IllegalTransition = InvalidTransition

# 合法迁移白名单。``S`` 是状态类型 (通常是 ``str`` 或 ``StrEnum`` 子类)。
# value 可为：
#   - set[S] / list[S] / tuple[S, ...]  : 仅校验目标状态可达 (角色无关)
#   - dict[S, list[str]]               : 目标状态 → 允许触发该迁移的 action 列表
type TransitionMap[S] = dict[S, "set[S] | list[S] | tuple[S, ...] | dict[S, list[str]]"]


def can_transition[S](
    current: S,
    target: S,
    transitions: TransitionMap[S],
) -> bool:
    """检查从 ``current`` 到 ``target`` 是否存在合法迁移边 (仅校验边存在性)。"""
    next_set = transitions.get(current)
    if next_set is None:
        return False
    if isinstance(next_set, dict):
        return target in next_set
    return target in next_set


def next_states[S](current: S, transitions: TransitionMap[S]) -> list[S]:
    """列出从 ``current`` 可达的下一状态集合。"""
    next_set = transitions.get(current)
    if next_set is None:
        return []
    if isinstance(next_set, dict):
        return list(next_set.keys())
    return list(next_set)


def assert_transition[S](
    current: S,
    target: S,
    transitions: TransitionMap[S],
    *,
    entity: str = "entity",
    entity_id: object = None,
) -> None:
    """校验迁移合法性，非法时抛 :class:`InvalidTransition`。

    Args:
        current: 当前状态。
        target: 目标状态。
        transitions: 合法迁移白名单。
        entity: 业务实体名 (用于错误消息，如 "problem_list")。
        entity_id: 业务实体 ID (写入错误 details，便于排查)。

    Raises:
        InvalidTransition: ``current`` → ``target`` 不在白名单时。
    """
    if not can_transition(current, target, transitions):
        raise InvalidTransition(
            f"{entity} 不支持的状态迁移：{current} → {target}",
            details={
                "entity": entity,
                "entity_id": str(entity_id) if entity_id is not None else None,
                "current_state": str(current),
                "target_state": str(target),
                "allowed": [str(s) for s in next_states(current, transitions)],
            },
        )


class StateMachine[S]:
    """绑定状态 + 迁移表的有状态状态机 helper。

    用法 (子域 service 内)::

        TRANSITIONS: TransitionMap[str] = {
            "draft": {"submitting"},
            "submitting": {"approving", "rejected"},
            ...
        }
        fsm = StateMachine(problem.status, TRANSITIONS, entity="problem_list",
                           entity_id=problem.id)
        fsm.transition("approving")   # 合法则就地推进，非法抛 InvalidTransition
        problem.status = fsm.current

    无状态场景直接用模块级 :func:`can_transition` / :func:`assert_transition`。

    Note:
        不定义 ``__slots__`` —— 本类实例量小 (每个待推进实体一个)，且单测
        不依赖属性密封性，内存与正确性都不受影响。
    """

    def __init__(
        self,
        current: S,
        transitions: TransitionMap[S],
        *,
        entity: str = "entity",
        entity_id: object = None,
    ) -> None:
        self._current: S = current
        self._transitions: TransitionMap[S] = transitions
        self._entity: str = entity
        self._entity_id: object = entity_id

    @property
    def current(self) -> S:
        """当前状态。"""
        return self._current

    def can_transition(self, target: S) -> bool:
        """当前状态能否迁移到 ``target``。"""
        return can_transition(self._current, target, self._transitions)

    def next_states(self) -> list[S]:
        """从当前状态可达的下一状态列表。"""
        return next_states(self._current, self._transitions)

    def transition(self, target: S) -> S:
        """校验并推进状态；非法迁移抛 :class:`InvalidTransition`。

        推进后 :attr:`current` 更新为 ``target`` 并返回之。注意本方法不
        持久化 —— 调用方负责把新状态写回 ORM 模型并 ``commit``。
        """
        assert_transition(
            self._current,
            target,
            self._transitions,
            entity=self._entity,
            entity_id=self._entity_id,
        )
        self._current = target
        return target


__all__ = [
    "IllegalTransition",
    "StateMachine",
    "TransitionMap",
    "assert_transition",
    "can_transition",
    "next_states",
]
