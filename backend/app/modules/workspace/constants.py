"""Workspace type 受控词表——单一事实源。

author: qinyi
created_at: 2026-08-19
change: 2026-08-18-workspace-role-type

D-002@v1：type 收成 8 值受控词表（拒绝自由文本与父子两层）。消费方：
- schema.py——WorkspaceCreate/WorkspaceUpdate 与列表 ``?type=`` 参数的 Literal 校验；
- service.py——列表过滤入参类型；
- task-02 migration——存量 type 收编 UPDATE（CASE 子集与 YAML_TYPE_NORMALIZE_MAP 对齐）；
- task-03 parser.py——yaml 拓扑组件 type 归一（``map.get(v, v)``，映射不上保留原值）。
"""

from __future__ import annotations

from typing import Literal

WORKSPACE_TYPE_VALUES = (
    "frontend-code",
    "backend-code",
    "fullstack",
    "business-doc",
    "submodule",
    "deploy-ops",
    "design-asset",
    "other",
)

WorkspaceTypeLiteral = Literal[
    "frontend-code",
    "backend-code",
    "fullstack",
    "business-doc",
    "submodule",
    "deploy-ops",
    "design-asset",
    "other",
]

# yaml 拓扑组件 type → 新词表映射（design §5.1 逐字对齐）。
# 仅收编明确映射（D-003@v1）：映射不上的非空值保留原值，由前端灰徽标兜底；
# 值域全部落在 WORKSPACE_TYPE_VALUES 内。
YAML_TYPE_NORMALIZE_MAP: dict[str, str] = {
    "frontend": "frontend-code",
    "frontend-app": "frontend-code",
    "web": "frontend-code",
    "backend": "backend-code",
    "backend-api": "backend-code",
    "api": "backend-code",
    "service": "backend-code",
    "fullstack": "fullstack",
    "monorepo": "fullstack",
    "docs": "business-doc",
    "doc": "business-doc",
    "documentation": "business-doc",
    "module": "submodule",
    "submodule": "submodule",
    "deploy": "deploy-ops",
    "infra": "deploy-ops",
    "devops": "deploy-ops",
    "design": "design-asset",
}
