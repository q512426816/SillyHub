---
id: task-03
title: add-agent-file-artifacts-endpoints
title_zh: 新增 agent 文件制品上传与列表端点
author: qinyi
created_at: 2026-08-23 09:37:06
priority: P0
depends_on: [task-01, task-02]
blocks: [task-05, task-08, task-09]
requirement_ids: [FR-01, FR-03, FR-05]
decision_ids: [D-007@v1, D-010@v1, D-011@v1]
allowed_paths:
  - backend/app/modules/agent/file_artifacts.py
  - backend/app/modules/agent/router.py
  - backend/app/modules/agent/tests/test_file_artifacts.py
provides:
  - contract: agent-file-artifacts-endpoints
    fields: [file_id, original_name, size, mime_type, description, created_at]
  - contract: AgentRunLog FileUpload 日志行
    fields: [file_id, original_name, size, mime_type, description]
  - contract: GET /api/agent/file-artifacts
    fields: [files, id, original_name, size, mime_type, description, created_at]
  - contract: OpenAPI schema
    fields: [/api/agent/file-artifacts 新端点已入 openapi.json]
expects_from:
  task-01:
    - contract: file-dto-extended
      needs: [description, created_at]
  task-02:
    - contract: workspace-anchor-resolve-chain
      needs: [session-anchor, run-resolve-chain]
goal: >
  新增 agent/file_artifacts.py 端点（POST /api/agent/file-artifacts multipart 上传落 File 行 + AgentRunLog 日志行 + Redis publish 实时扇出；GET 按 session_id/run_id 列文件），复用 mcp_tools 双路径鉴权与 task-02 锚定链，为 task-05 daemon 文件 MCP 与 task-08/09 前端提供 POST/GET file-artifacts 契约。
implementation:
  - 新建 file_artifacts.py router——POST multipart（file UploadFile、description str 缺省空串、run_id UUID 可空），鉴权 require_permission_any(Permission.WORKSPACE_WRITE) 双路径（JWT / X-API-Key，SessionMcpUser 同款）；会话场景读 X-Session-Id（与 mcp_tools._SESSION_ID_HEADER 同名同源）挂当前活跃 run（_ACTIVE_RUN_STATUSES 口径，无活跃取最新，均无 422），worker 场景按 run_id 校验（404）后挂该 run，两场景按锚 workspace 复核（task-02 解析链，越权 403）
  - 落库链——FileService.upload_file 写 File 行（owner_type=agent_session/agent_run、owner_id=会话或 run id、uploaded_by=principal User、description 透传），再写 AgentRunLog 行（channel='tool_call'、tool_kind='FileUpload'、content_redacted 为 file_id/original_name/size/mime_type/description 六字段 JSON、dedup_key=f"file-upload:{file_id}"，直写 catch IntegrityError 视作已写入）；写行后 Redis publish——复用 submit_run_input 同款模式（agent/service.py:842 写行 + :929 publish；无 publish_submitted_messages 可复用），会话场景向 agent_session:{id} 与 run 日志流通道 publish 该行，失败记 WARNING 降级不阻断
  - GET /api/agent/file-artifacts?session_id=|run_id=——require_permission_any(WORKSPACE_READ) + 锚 workspace 复核，返 FileMetaResp（含 description、created_at）按 created_at 倒序；agent/router.py mcp_tools include 处（:905）并列 include 本 router；测试 test_file_artifacts.py 覆盖上传落库+日志行六字段、会话无 run 422、越权 403、双路径鉴权、GET 倒序、IntegrityError 重放不 500、publish 到达与降级
acceptance:
  - POST 成功 201 返 FileUploadResp（含 description），File 行 owner_type/owner_id 正确，AgentRunLog 出现 tool_kind='FileUpload' 行且 content JSON 含六契约字段
  - 会话无任何 run → 422 中文文案（l10n 断言 CJK）；run_id 不存在 → 404；越权 workspace → 403；JWT 与 X-API-Key 双路径均可达；同 file_id 重放不 500 且 publish 异常仅记 WARNING 仍 201
  - GET 按 session_id/run_id 返 FileMetaResp（含 description、created_at）倒序，无 WORKSPACE_READ → 403；端点测试全绿
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_file_artifacts.py -q
constraints:
  - 用户链路报错文案中文化，测试断言含 CJK 字符（l10n）
  - Redis publish 失败降级不阻断上传——try/except 记 WARNING（submit_run_input 同款模式）
  - AgentRunLog 直写撞 (run_id,dedup_key) 部分唯一索引（ux_agent_run_logs_dedup，PG 生效 SQLite 忽略）的 IntegrityError 视作已写入，不 500；不改 FileService/_can_access 本体（归 task-01/02），gen:types 归 task-10
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
