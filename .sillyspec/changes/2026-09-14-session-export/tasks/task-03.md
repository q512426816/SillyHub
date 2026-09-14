---
id: task-03
title: 'add-session-export-endpoint'
title_zh: '后端路由——router/session_export.py 端点（TaskRunAgentUser）+ router/__init__.py 有序挂载字面量前置 + DaemonService facade 透传 storage'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:06:52
priority: P0
depends_on: ['task-01', 'task-02']
blocks: ['task-04']
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v1]
provides:
  - 'POST /api/daemon/sessions/export 端点（响应矩阵 text/markdown | application/zip + RFC5987 Content-Disposition）'
expects_from:
  - 'task-01: SessionExportRequest（body 解析 + OpenAPI 产源）'
  - 'task-02: SessionExportResult(media_type, filename, payload) 字段 + SessionService.export_sessions(user_id, *, session_ids, tier, storage) 签名'
allowed_paths:
  - NEW:backend/app/modules/daemon/router/session_export.py
  - backend/app/modules/daemon/router/__init__.py
  - backend/app/modules/daemon/service.py
target_files:
  - NEW:backend/app/modules/daemon/router/session_export.py
  - backend/app/modules/daemon/router/__init__.py
  - backend/app/modules/daemon/service.py
goal: >
  新建 router/session_export.py 的 POST /sessions/export 端点（TaskRunAgentUser
  闸门 + SessionExportRequest body + SessionAttachmentStorage 注入），在
  router/__init__.py 有序挂载列表把字面量路由前置于 /sessions/{session_id}，
  并在 service.py DaemonService 加 facade 一行透传（storage 一并）。
implementation:
  - 新建 session_export.py：@router.post("/sessions/export")，入参为 SessionExportRequest body + TaskRunAgentUser 闸门 + SessionDep + storage 注入（Annotated[SessionAttachmentStorage, Depends(...)]，照 session_attachment/router.py 的 _make_storage 依赖形态在本模块自建 provider）
  - 端点层对 session_ids 去重保序后调 facade；按 SessionExportResult 组 Response/StreamingResponse（media_type + RFC5987 Content-Disposition + payload），不写渲染逻辑
  - service.py DaemonService 新增 async def export_sessions 一行委托 self._sess.export_sessions(...)（照 get_agent_session_logs（:1077）先例，user_id/session_ids/tier/storage 逐参透传）
  - router/__init__.py：import 区挂 session_export 子模块；_ENDPOINT_ORDER 在 list_sessions/stream_sessions_events 一侧插入 "export_sessions"，保证字面量 /sessions/export 前置于 get_session_detail 的 /sessions/{session_id}（表末漂移断言同步通过）
  - 错误映射走既有体系：DaemonSessionNotFound→404、附件总量超限→413；OpenAPI 只增不改
acceptance:
  - 路由表注册顺序 /daemon/sessions/export 先于 /daemon/sessions/{session_id}（R-01），openapi.json 仅新增本端点
  - 鉴权闸门为 TaskRunAgentUser（task:run_agent，同 sessions 详情/日志端点口径）
  - chat 单会话响应 Content-Type=text/markdown 且 Content-Disposition 含 filename*=UTF-8''；跨用户/软删 404
  - 既有 daemon 路由测试零回归（_ENDPOINT_ORDER 断言不触发 RuntimeError）
verify:
  - cd backend && uv run pytest -q --no-cov tests/modules/daemon -k "session_export or sessions"
  - cd backend && uv run ruff check app/modules/daemon
  - cd backend && uv run mypy app
constraints:
  - 遵循 design.md「接口定义」端点签名（TaskRunAgentUser 闸门对齐 session_insights.py:464 注释惯例）
  - /sessions/export 字面量必须前置 /sessions/{session_id}（ppm 同类坑 R-01）；新增端点必须同步 _ENDPOINT_ORDER（漂移断言 fail-fast）
  - 端点不写导出业务逻辑（渲染/权限归 task-02）；本 task 不写新测试（task-04）
  - OpenAPI 只增不改（gen:types 对既有类型零破坏）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
