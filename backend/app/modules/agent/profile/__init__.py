"""AgentProfile configuration submodule (design §3.1 / D-001~D-009).

智能体档案配置层：管「模型 + 系统提示词 + MCP/技能引用 + 工具策略引用」，
作为现有 dispatch spec_bundle 的增强层（非替代，profile=None 走原路径零回归）。

model 此处 eager import 以注册进 :class:`app.models.base.BaseModel` 的共享
metadata，供 alembic autogenerate / ``create_all`` 发现 ``agent_profiles`` 表
（与 auth / daemon.audit 子模块同模式）。
"""

from __future__ import annotations

from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility

__all__ = ["AgentProfile", "AgentProfileVisibility"]
