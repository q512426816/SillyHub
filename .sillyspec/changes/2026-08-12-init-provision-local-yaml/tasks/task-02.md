---
id: task-02
title: McpTokenService.get_or_issue 复用三件套签新
title_zh: mcp_gateway token service 新增 get_or_issue 复用既有 list revoke create 三件套吊销旧签新返回明文 scope 为 dispatch
author: qinyi
created_at: 2026-08-12 10:34:01
priority: P0
depends_on: []
blocks: [task-04, task-09]
requirement_ids: [FR-01, FR-02, FR-08]
decision_ids: [D-001]
allowed_paths:
  - backend/app/modules/mcp_gateway/service.py
provides:
  - contract: McpTokenService.get_or_issue
    fields: [get_or_issue 方法签名 keyword-only workspace_id 与 created_by 返回 tuple ORM row 与明文 token]
expects_from: []
goal: >
  在 backend/app/modules/mcp_gateway/service.py 新增 async get_or_issue 方法，按 design §5.2 §7.1 复用既有 list_for_workspace 与 revoke 吊销同维度旧 token，再调既有 create 签新返回 row 与明文，scope 取 dispatch 因 execute 派 Wave 子代理正是 dispatch 语义，覆盖 FR-01 FR-02 FR-08 与 D-001，为 task-04 claim 时签发提供契约，三件套齐全不新增方法。
implementation:
  - 在 McpTokenService 内新增 async def get_or_issue(self, *, workspace_id, created_by) 返回 tuple[McpTokenORM, str]，入参 keyword-only 类型 uuid.UUID，对齐 design §7.1
  - 调既有 self.list_for_workspace(workspace_id) 查旧 token，过滤 created_by 匹配且 revoked_at 为空的行，命中则调 self.revoke(token_id, workspace_id) 吊销
  - 调既有 self.create(workspace_id, created_by, name='init-provisioned', scope=['dispatch']) 签新，返回新 row 与明文，scope 必须 MCP_SCOPES 合法值 dispatch
  - 明文仅作为返回值不写日志不落 lease.metadata，对齐 design §9 与 D-001
acceptance:
  - get_or_issue 存在于 McpTokenService 签名匹配 design §7.1 keyword-only 返回 tuple
  - 空表调用直接签新 DB 仅一条 revoked_at 为空记录
  - 有旧 token 调用后旧 revoke 新签 DB 至多一条同维度活 token 不堆积
  - 签出的 token scope 为 dispatch 落库正确，authenticate 返非空 Principal
  - 既有 create list_for_workspace revoke 签名及行为零改动 mcp_gateway 模块 pytest 回归全绿
verify:
  - cd backend && uv run pytest app/modules/mcp_gateway -q --no-cov
constraints:
  - 复用既有 create list_for_workspace revoke 不改三件套签名及实现零回归
  - scope 必须是 MCP_SCOPES 合法值 read dispatch converge 取 dispatch，不可用 workspace 否则绕过 router Literal 收口持久化废 token 导致 dispatch 鉴权失败
  - 明文不入日志不落 lease.metadata 仅返回调用方 task-04 claim 时注入 payload，对齐 D-001 与 §9
  - mcp token 不绑 created_by FK 为可选，get_or_issue 仍传 created_by 记录签发者审计
  - 代码兼容 Windows Linux macOS
---
