---
id: task-02
title: 'backend compact 端点双分路（claude=inject 复用+TurnConflict 映射 / pi·codex=ws RPC+三异常映射）+ schema + gen:types'
title_zh: 'backend compact 端点双分路（claude=inject 复用+TurnConflict 映射 / pi·codex=ws RPC+三异常映射）+ schema + gen:types'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 11:03:19
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-02, FR-03]
decision_ids: [D-002@v1, D-003@v3, D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/schema.py
  - backend/app/modules/daemon/session/service/compact.py
  - backend/app/modules/daemon/tests/test_session_compact_endpoint.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
target_files:
  - backend/app/modules/daemon/router/session_crud.py
  - backend/app/modules/daemon/schema.py
  - NEW:backend/app/modules/daemon/session/service/compact.py
  - NEW:backend/app/modules/daemon/tests/test_session_compact_endpoint.py
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
provides:
  - contract: SessionCompactResponse
    fields: [accepted, provider, run_id, queued, tokens_before, estimated_tokens_after, error]
expects_from:
  task-01:
    - contract: ProviderCaps
      needs: [compact]
goal: >
  新增统一压缩端点 POST /api/daemon/sessions/{session_id}/compact：service 层三校验（归属 +
  caps compact 键 + turn 状态）后按引擎双分路——claude 复用既有 inject 服务发 "/compact"
  文本（FR-03，daemon 零改动、原生建 run），pi/codex 走 ws RPC send_rpc('session_compact')
  拿结构化回执（D-003@v3），回执与异常映射进统一 SessionCompactResponse（D-004），gen:types
  同步两端类型（FR-02）。
implementation:
  - 'schema.py 加 SessionCompactRequest（custom_instructions: str | None = None——NG-06 v1 预留不透传）与 SessionCompactResponse（accepted: bool、provider: str、run_id: str | None = None、queued: bool | None = None、tokens_before: int | None = None、estimated_tokens_after: int | None = None、error: str | None = None——三路字段并集，除 accepted/provider 全可选）'
  - 'NEW backend/app/modules/daemon/session/service/compact.py——照 inject.py :47-89 服务函数先例（svc 首参 + 显式 kwargs）：三校验① 会话归属/活跃（同 inject 口径）② get_provider_caps(provider)["compact"] 为 false → 拒绝（cursor/未知引擎，D-001 caps 门控 backend 层）③ turn 状态 running/reconnecting 拒绝（对齐 inject 守卫 turn-control.ts:157 三态先例，D-002 空闲守卫 backend 层）'
  - 'claude 分路（FR-03）：调既有 inject_session(svc, session_id, user_id, prompt="/compact")（原生建 run、/compact 轮天然入会话流）→ 映射 {accepted, provider, run_id, queued}；捕获 DaemonSessionTurnConflict（锁内竞态，复审 P1-1）→ 结构化响应 error 文案映射，不抛 500'
  - 'pi/codex 分路（D-003@v3）：ws_hub.send_rpc(session 所属 runtime 的 daemon_id, "session_compact", {session_id}, timeout=15) → RPC result（daemon 回传 CompactResult dict）→ 映射 {accepted, provider, tokens_before?, estimated_tokens_after?, error?}；异常三映射——DaemonRpcTimeout → error「daemon 未响应压缩命令」、DaemonRuntimeOffline → error「daemon 离线」、DaemonRpcRemoteError → error「daemon 未支持压缩，请升级 daemon」（旧 daemon 无 handler 场景，brownfield 兼容）；DaemonRpcConflict（rpc_id 碰撞实务不可能）不捕获放行走既有 500 兜底'
  - 'session_crud.py 加 POST /sessions/{session_id}/compact 端点——依赖 SessionDep + TaskRunAgentUser（同 :537-552 inject 端点口径），body 收 SessionCompactRequest，调 compact 服务返回 SessionCompactResponse'
  - '跑 pnpm -C frontend gen:types 刷新 backend/openapi.json + frontend/src/lib/api-types.ts（@generated 产物随卡提交，不让类型落后后端）'
  - 'NEW backend/app/modules/daemon/tests/test_session_compact_endpoint.py——覆盖矩阵：三校验（非归属 404·4xx / caps false 拒绝 / running·reconnecting 状态拒绝）；claude 分路 mock inject_session 断言 prompt="/compact" 与 run_id/queued 映射 + DaemonSessionTurnConflict → 结构化 error 非 500；pi/codex 分路 mock send_rpc 断言 method="session_compact"、params 含 session_id、timeout=15 与 result 字段映射 + 三异常各自 error 文案 + DaemonRpcConflict 未映射走 500'
acceptance:
  - 三校验拒绝路径与双分路成功路径 pytest 全绿（含上述 mock 断言矩阵）
  - claude 路 TurnConflict 竞态返回结构化 error 字段（非裸 500，P1-1）；pi/codex 路 Timeout/Offline/RemoteError 三异常映射为对应响应 error 文案，Conflict 走 500
  - gen:types 后 api-types.ts 含 SessionCompactRequest/Response 且与 openapi.json 一同更新
  - protocol.py / control_commands.py 零改动（v3 RPC 通道无新协议常量）；既有 inject/queue 端点语义零变化（claude 分路是调用方复用非修改）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_compact_endpoint.py -q
  - cd backend && uv run pytest app/modules/daemon/tests/test_session_queue.py -q
  - pnpm -C frontend gen:types
constraints:
  - 不改 inject 服务与既有端点语义；无 DB schema 迁移；v3 定案下 protocol.py/control_commands.py 零改动
  - '@generated（openapi.json / api-types.ts）只经 pnpm -C frontend gen:types 生成不手写；gen:types 前确认前端 node_modules 健康（CLAUDE.md 规则 21）'
  - 异常映射只做 Timeout/Offline/RemoteError 三态 + Conflict 500 兜底，不吞其它未知异常；错误文案中文口径与 design 兼容策略一致
  - Windows / Linux / macOS 兼容（pytest 路径正斜杠，无平台专属调用）
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
