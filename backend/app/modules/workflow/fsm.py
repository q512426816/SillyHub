"""Finite state machines for Change and Task lifecycles.

Change FSM:
    draft -> proposed -> reviewed -> approved -> in_progress -> completed -> merged
                    \\-> rejected -> draft (rework)

Task FSM:
    draft -> ready -> in_progress -> review -> done
                            \\-> blocked -> in_progress
                            \\-> cancelled
"""

from __future__ import annotations

from app.core.errors import AppError


class TransitionError(AppError):
    code = "FSM_INVALID_TRANSITION"
    http_status = 409


class FSM:
    """Generic finite state machine backed by an adjacency map."""

    def __init__(self, name: str, transitions: dict[str, set[str]]) -> None:
        self.name = name
        self._transitions = {
            src: set(dsts) for src, dsts in transitions.items()
        }

    @property
    def valid_states(self) -> set[str]:
        all_states: set[str] = set()
        for src, dsts in self._transitions.items():
            all_states.add(src)
            all_states.update(dsts)
        return all_states

    def allowed_transitions(self, current: str) -> set[str]:
        return self._transitions.get(current, set())

    def can_transition(self, current: str, target: str) -> bool:
        return target in self._transitions.get(current, set())

    def validate_transition(self, current: str, target: str) -> None:
        if not self.can_transition(current, target):
            allowed = self.allowed_transitions(current)
            raise TransitionError(
                f"Cannot transition {self.name} from '{current}' to '{target}'.",
                details={
                    "fsm": self.name,
                    "current": current,
                    "target": target,
                    "allowed": sorted(allowed),
                },
            )


CHANGE_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"proposed"},
    "proposed": {"reviewed", "rejected"},
    "reviewed": {"approved", "rejected"},
    "approved": {"in_progress", "rejected"},
    "in_progress": {"completed", "rejected"},
    "completed": {"merged"},
    "rejected": {"draft"},
    "merged": set(),
}

TASK_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"ready"},
    "ready": {"in_progress", "cancelled"},
    "in_progress": {"review", "blocked", "cancelled"},
    "blocked": {"in_progress", "cancelled"},
    "review": {"done", "in_progress"},
    "done": set(),
    "cancelled": set(),
}

ChangeFSM = FSM("Change", CHANGE_TRANSITIONS)
TaskFSM = FSM("Task", TASK_TRANSITIONS)
