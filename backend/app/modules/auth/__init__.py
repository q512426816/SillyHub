"""Authentication & RBAC module.

See ``tasks/task-04a-auth.md``. Models are imported eagerly so that
``BaseModel.metadata`` picks them up for autogenerate / create_all.
"""

from app.modules.auth.model import Role, RolePermission, Session, User, UserWorkspaceRole

__all__ = [
    "Role",
    "RolePermission",
    "Session",
    "User",
    "UserWorkspaceRole",
]
