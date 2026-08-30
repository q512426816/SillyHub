---
author: qinyi
created_at: 2026-08-26 14:20:00
id: task-01
title_zh: "后端工作区MCP配置写接口"
title: "后端 PUT /workspaces/{id}/mcp-config 写接口"
priority: P0
depends_on: []
allowed_paths:
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/skills_view_service.py
goal: 新增工作区 MCP 配置写接口，校验仅 stdio、<set> 服务端还原、原子写 .mcp.json、审计与中文报错
acceptance: |
  1. PUT /api/workspaces/{workspace_id}/mcp-config 权限 WorkspaceWriter（require_permission(Permission.WORKSPACE_WRITE)+成员校验，同 mcp_gateway/router.py:114 模式）
  2. pydantic 模型（就近 skills_view_service.py，与 McpConfigViewResponse 同处）：McpServerEntryPut（type 缺省 stdio、command 非空 str、args list[str] 默认[]、env dict[str,str] 可选、extra="forbid"）+ McpConfigUpdateRequest（mcpServers dict）
  3. 非 stdio → HTTP_422_MCP_TYPE_NOT_STDIO（中文）；<set> 无法还原 → HTTP_422_MCP_SECRET_UNRESOLVABLE（中文，含 server 名与键名）；<set> 字面量绝不写盘
  4. 原子写：临时文件（同目录）+ os.replace；ensure_ascii=False、indent=2、末尾换行
  5. 审计：session.info["audit_context"] 注入 actor/workspace（audit_hooks 机制自动落库）
  6. 200 响应返回写后脱敏视图（复用 GET 同构 _redact_mcp_env 语义）
verify: cd backend && uv run pytest app/modules/workspace -q --no-cov -n auto（task-02 用例落地后全绿）
implementation: skills_view_service.update_mcp_config（校验+<set>还原+原子写+审计）+ router PUT 端点 + 就近 pydantic 模型
constraints: ["仅 stdio（D-005@v2）", "<set> 绝不写盘", "错误中文 AppError", "GET 零回归"]
provides:
  - contract: "PUT /api/workspaces/{workspace_id}/mcp-config"
    fields: [mcpServers 请求模型, McpServerEntryPut, McpConfigUpdateRequest, HTTP_422 错误码, set 占位符还原, 原子写, 审计上下文]
---

# task-01: 后端 PUT 写接口

## 实现要点

1. `skills_view_service.py`：`update_mcp_config(workspace_id, payload, actor)`——读取现有 `.mcp.json`（可能不存在）→ 逐 server 校验 → `<set>` 还原（env 值等于 `"<set>"` 的键从磁盘现有同名 server 同名键取真值，取不到抛中文 AppError）→ 原子写 → 返回脱敏视图。复用既有 `SpecPathResolver` 定位 specDir（参照 `get_mcp_config:97-109`）。
2. `router.py`：新增 PUT 端点，鉴权模式照 `mcp_gateway/router.py:114`（WorkspaceWriter）。错误经全局 handler（AppError 子类，中文 message，UPPER_SNAKE code）。
3. 请求/响应 pydantic 模型进 OpenAPI（task-04 gen:types 依赖）。

## 边界

- 现有文件不存在 + 全新配置（无 `<set>`）→ 直接写新文件
- 现有文件损坏/非法 JSON → 视为空配置处理（与 GET 容错一致），`<set>` 还原自然走失败路径
- 不动 `get_mcp_config`（GET 零回归）
