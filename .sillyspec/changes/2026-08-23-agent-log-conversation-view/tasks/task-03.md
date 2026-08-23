---
id: task-03
title: 'backend 新端点 GET /agent-logs/{id}/messages——从 read_agent_log_content 抽共享 helper（scope/daemon 定位/错误映射）+ AgentLogMessagesResponse schema + 二进制 409/method-not-found 422/status 200 分层 + 单测（mock RPC，不依赖 task-02 实现）'
title_zh: 'backend 新端点 GET /agent-logs/{id}/messages——从 read_agent_log_content 抽共享 helper（scope/daemon 定位/错误映射）+ AgentLogMessagesResponse schema + 二进制 409/method-not-found 422/status 200 分层 + 单测（mock RPC，不依赖 task-02 实现）'
author: 'qinyi'
created_at: 2026-08-23 21:24:18
priority: P0
depends_on: []
blocks: ['task-04']
requirement_ids: [FR-03, FR-04]
decision_ids: [D-003@v1, D-006@v1]
allowed_paths:
  - backend/app/modules/platform_sync/router.py
  - backend/app/modules/platform_sync/schema.py
  - backend/app/modules/platform_sync/tests/test_agent_log_messages.py
goal: >
  backend 新增 GET /agent-logs/{entry_id}/messages 端点：从 read_agent_log_content 抽共享
  helper（scope 鉴权/daemon 定位/RpcError→HTTP 映射）防两口径漂移，schema 定义
  AgentLogMessagesResponse，解析结果 status 一律 200 分层返回（前端判断回落），老 daemon
  method-not-found → 422；单测 mock RPC 不依赖 task-02 实现（Wave 2 可并行）。
expects_from:
  task-02:
    - contract: read_agent_log_messages
      needs: [status, messages, truncated, totalSegments, skippedLines]
provides:
  - contract: AgentLogMessagesResponse
    fields: [status, messages, truncated, total_segments, skipped_lines]
  - contract: AgentLogMessageItem
    fields: [seq, kind, text, tool_name, tool_use_id, tool_input, tool_result, is_error, ts]
implementation:
  - schema.py 新增 AgentLogMessageItem {seq, kind, text, tool_name, tool_use_id, tool_input, tool_result, is_error, ts}——内层字段与 daemon NormalizedLogMessage 逐字对齐 snake_case（design §7.1，AgentLogEntry 同款本模块惯例）；再新增 AgentLogMessagesResponse {status, messages, truncated, total_segments, skipped_lines}
  - router.py 从 read_agent_log_content（:490-573）抽共享 helper：scope 内校验（越权/不存在 404 中文不泄漏存在性）、format 二进制黑名单 409（复用 _AGENT_LOG_BINARY_FORMAT_TOKENS）、daemon 定位（runtime→daemon_instance 优先 + workspace 绑定回落 + 都无 404 中文）、DaemonRpcRemoteError 映射（forbidden→409 含 allowed_roots 指引 / not_found→404 / 其余→既有 502）；read_agent_log_content 改调 helper，行为保持零改动语义
  - router.py 新增 GET /agent-logs/{entry_id}/messages：调共享 helper 后 send_host_fs_rpc 走新方法 read_agent_log_messages，入参 {path, format, beforeSeq?}（query 参数 before_seq (int | None) 透传）
  - 外层 daemon 返回 camelCase（status/messages/truncated/totalSegments/skippedLines）→ backend schema 落 snake_case：映射在 router 转换层完成（totalSegments→total_segments、skippedLines→skipped_lines；messages 内层逐字段已对齐无需改名）
  - status 四值（parsed/unsupported/parse_error/too_large）一律 200 透传，不做 backend 侧解析或改写（零解析，D-001）
  - 老 daemon method-not-found（RpcError code=method_not_found / METHOD_NOT_FOUND）→ 422 HTTP_422_AGENT_LOG_UNSUPPORTED 中文文案（唯一 422 场景）；离线/超时沿用既有 DaemonRuntimeOffline/DaemonRpcTimeout 透传
  - 新建 tests/test_agent_log_messages.py：组织方式参照 test_agent_log_content.py（_RPC patch app.modules.daemon.host_fs.ws_rpc.send_host_fs_rpc + conftest 夹具）；断言 scope 越权 404 / 二进制 409 / 无绑定 daemon 404 / status 四值均 200 / method-not-found 422 / forbidden 409 / remote not_found 404 / 其余远端错 502 / 离线超时透传 / camelCase→snake_case 字段映射 / before_seq→beforeSeq 透传
acceptance:
  - uv run pytest app/modules/platform_sync/tests/test_agent_log_messages.py 全绿，覆盖 design §6 所列断言面（status 分层 200 / 唯一 422 / throw 通道复用）
  - 既有 test_agent_log_content.py 全部断言零回归（抽 helper 属行为保持重构，不改任何既有 code/http_status/文案）
  - openapi 自动暴露 AgentLogMessagesResponse/AgentLogMessageItem（供 task-04 pnpm gen:types 消费）
verify:
  - cd backend && uv run pytest -q --no-cov app/modules/platform_sync/tests/test_agent_log_messages.py
  - cd backend && uv run pytest -q --no-cov app/modules/platform_sync/tests/test_agent_log_content.py
constraints:
  - 中文用户文案报错（AppError 中文 detail，platform_sync 在 l10n 排除清单不做 i18n）
  - status 一律 200 分层：unsupported/parse_error/too_large 不映射 4xx（「RPC 成功≠解析成功」，前端判断回落，design §7.2）
  - 唯一 422 场景 = 老 daemon method-not-found → HTTP_422_AGENT_LOG_UNSUPPORTED；不得新增其他 4xx
  - 二进制黑名单 409 复用共享 helper（FR-04 维持拦截不变）
  - 抽 helper 属行为保持重构：read_agent_log_content 既有语义（错误码/中文文案/截断逻辑）零变化
  - 单测 mock RPC，不依赖 task-02 daemon 实现落地（仅消费其契约，可并行开发）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
