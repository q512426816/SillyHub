---
id: task-03
title: backend import 改 SSE 流式 + sync DTO 加 reparsed_changes（覆盖：FR-03, FR-04, FR-06, D-001, D-004）
author: WhaleFall
created_at: 2026-07-01 13:04:17
priority: P0
depends_on: [task-02]
blocks: [task-04]
requirement_ids: [FR-03, FR-04, FR-06]
decision_ids: [D-001, D-004]
allowed_paths:
  - backend/app/modules/spec_workspace/router.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/schema.py
  - backend/app/modules/spec_workspace/tests/test_import.py
---

# task-03：backend import 改 SSE 流式 + sync DTO 加 reparsed_changes

## goal
import_from_repo 改 StreamingResponse(text/event-stream) 分阶段推 packing/packed/applying/reparsing_docs/reparsing_changes/done/error（packing 阶段心跳保活防 proxy 超时）；sync 端点 DTO 加 reparsed_changes。

## implementation
- service.py 新增 `import_from_repo_sse` 异步生成器：yield SSE 事件（`event:X\ndata:{json}\n\n` 格式），复用 import_from_repo 逻辑但分阶段——packing→send_rpc / packed→b64decode tar_bytes / applying→apply 写盘 / reparsing_docs / reparsing_changes / done；落盘+reparse 调 task-02 的 apply_sync（返回 dict {reparsed_docs, reparsed_changes}）。
- packing 阶段（daemon 打包 ~16.8s 阻塞 send_rpc）用 `asyncio.create_task` 包 send_rpc + 心跳协程，每 5s yield `': keepalive\\n\\n'`（SSE comment 注释行，前端忽略），send_rpc 完成后取消心跳、取 result 继续。
- daemon-client 错误（DaemonRuntimeOffline/DaemonRpcTimeout/DaemonRpcConflict/DaemonRpcRemoteError→forbidden 403 / 其他 502，ql-001 映射，service.py:227-247 既有逻辑搬进生成器）→ yield `error` 事件 + `return`（流正常关闭，不挂死）。
- server-local 分支同样 SSE 化（打包→apply→reparse 阶段事件，无 packing/daemon）。
- router.py `import_spec_workspace`（97-114）改返回 `StreamingResponse(service.import_from_repo_sse(...), media_type="text/event-stream", headers=_SSE_HEADERS)`，删 `response_model=SpecWorkspaceRead`（破坏 JSON 契约 D-001，前端 task-04 配套改）；新增 `_SSE_HEADERS` 常量（参考 agent/router.py:406 Cache-Control/Connection/X-Accel-Buffering）。
- router.py `SpecSyncResponse`（52-56）加 `reparsed_changes: int`，保留 `reparsed: int`（兼容，语义=docs）；`sync_spec_workspace`（117-136）调 apply_sync 取 dict 两段分别填 reparsed/reparsed_changes。
- schema.py 若 SpecSyncResponse 后续挪到 schema 集中，同步加字段；SSE 事件 schema 内部用（不强制 pydantic）。
- test_import.py 改写为 SSE 断言：① 正常路径依次推 packing→packed→applying→reparsing_docs→reparsing_changes→done（done.data 含 spec_workspace）；② daemon 离线推 error 事件（code=HTTP_504_DAEMON_RUNTIME_OFFLINE）后流关闭；③ reparse docs 失败 → 该阶段 error 事件但流继续到 changes/done（dirty）。用 httpx `client.stream("POST", ...)` + 行解析 SSE。

## acceptance
- POST /import 返回 text/event-stream，依次推 6 阶段事件（packing/packed/applying/reparsing_docs/reparsing_changes/done）。
- packing 阶段（daemon 打包 ~16.8s）每 5s 有 keepalive 心跳，Next.js rewrite proxy 不超时（spike-02 实测）。
- daemon 离线 → error 事件(code=HTTP_504_DAEMON_RUNTIME_OFFLINE) 正常关闭流（不挂死）。
- sync 端点响应含 reparsed_docs(=reparsed) / reparsed_changes。

## verify
- 临时容器跑 spec_workspace 全模块 pytest（含改写后的 SSE 测试）+ change 模块回归。
- `cd backend && uv run ruff check app/modules/spec_workspace/service.py app/modules/spec_workspace/router.py app/modules/spec_workspace/schema.py` + `uv run ruff format --check` 同三文件。

## constraints
- daemon get_spec_bundle 不改流式（D-004，packing 阶段阻塞占位）。
- 破坏 POST /import JSON 契约（D-001），前端 task-04 配套改流式 fetch。
- 参考现有 SSE 范式 agent/router.py:447、daemon/router.py:1353（StreamingResponse + text/event-stream + _SSE_HEADERS）。
- spike-02：执行时实测 Next.js rewrite proxy 对 SSE+keepalive 不断连。
- keepalive 注释行（`: keepalive\n\n`）不破坏 SSE 事件解析（前端 TextDecoder 按 `\n\n` 分块，注释块无 event/data）。
