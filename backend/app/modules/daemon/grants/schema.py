"""平台共享智能体 DTO（change 2026-08-28-daemon-agent-share task-04 / design §5 Phase 3）。

- ``SharedAgentCreateRequest``：管理员建共享智能体的请求体（含 R-05 的显式
  ``promote_visibility`` 开关——私有/workspace 档案禁止被静默升级为全员可见）。
- ``SharedAgentView``：管理端列表/写操作的完整视图（含停用行，provides 契约
  六字段：id/agent_profile_id/pinned_runtime_id/source_workspace_id/writable_dir/
  enabled）。
- ``SharedAgentCreateResponse``：创建响应 = View + 升级提示（R-05「在响应中提示
  升级结果」），非契约增量字段 ``visibility_promoted``。
- ``SharedAgentActiveView``：active 公共端点的生效摘要（provides 契约五字段：
  id/agent_profile_id/display_name/provider/runtime_online），供全体用户会话
  选择器与守护进程页管理卡消费。

Pydantic v2 风格照 ``daemon/schema.py``（``model_config = {"from_attributes": True}``
+ Field 约束）。
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


class SharedAgentCreateRequest(BaseModel):
    """POST /daemon/shared-agents 请求体（design §7）。

    - ``writable_dir``：共享输出目录（D-002@v2——读源码不受限、写限制在此目录），
      service 层校验 ⊆ 管理员该 runtime 的 allowed_roots，防指定任意路径。
    - ``promote_visibility``：档案 visibility 非 platform 时必须显式置 true 才
      升级（R-05 禁止静默把私有档案改为全员可见），缺省 false。
    """

    agent_profile_id: uuid.UUID
    pinned_runtime_id: uuid.UUID
    source_workspace_id: uuid.UUID
    writable_dir: str = Field(min_length=1, max_length=1024)
    promote_visibility: bool = False


class SharedAgentPatchRequest(BaseModel):
    """PATCH /daemon/shared-agents/{id} 请求体——仅改 enabled（task 卡：PATCH 仅改 enabled）。"""

    enabled: bool


class SharedAgentView(BaseModel):
    """管理端完整视图（platform 行四绑定列由 service 强制非空，此处按契约声明非空）。"""

    model_config = {"from_attributes": True}

    id: uuid.UUID
    agent_profile_id: uuid.UUID
    pinned_runtime_id: uuid.UUID
    source_workspace_id: uuid.UUID
    writable_dir: str
    enabled: bool


class SharedAgentCreateResponse(SharedAgentView):
    """创建响应：View + 档案升级提示（R-05）。"""

    visibility_promoted: bool = False


class SharedAgentActiveView(BaseModel):
    """active 生效摘要（任意登录用户可见；display_name/provider 取档案，runtime_online 取钉定 runtime）。"""

    id: uuid.UUID
    agent_profile_id: uuid.UUID
    display_name: str | None = None
    provider: str | None = None
    runtime_online: bool = False
