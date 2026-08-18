---
id: task-04
title: add-explorer-router-endpoints-and-tests
title_zh: explorer router 四端点 + main 挂载 + backend 测试
author: qinyi
created_at: 2026-08-18 12:39:45
priority: P0
depends_on: [task-02]
blocks: [task-05]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-06]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/explorer/router.py
  - backend/app/main.py
  - backend/tests/modules/explorer/__init__.py
  - backend/tests/modules/explorer/test_explorer.py
provides:
  - contract: explorer_http_endpoints
    fields: [tree, file, download, search]
  - contract: explorer_download_stream
    fields: [StreamingResponse, Content-Disposition]
expects_from:
  task-02:
    - contract: ExplorerTreeResponse
      needs: [entries]
    - contract: ExplorerFileResponse
      needs: [name, size, mtime, binary, truncated, content]
    - contract: ExplorerSearchResponse
      needs: [matches, truncated]
    - contract: ExplorerService
      needs: [list_tree, read_file, download, search]
goal: >
  实现 explorer 四个 HTTP 端点（tree/file/download/search）并挂载到 main.py，
  配套 containment 拒绝矩阵、绑定解析、错误映射与 download 头的 backend 测试。
implementation:
  - router.py——APIRouter 自带 prefix /workspaces/{workspace_id}/explorer（sibling 挂载仿 members_router，避免 include_router prefix 双计与 duplicated param name workspace_id）
  - 四 GET 端点统一 Depends(require_permission(Permission.WORKSPACE_READ)) + SessionDep（先例 spec_workspace/router.py）——tree(path rel 空=根) / file(path) / download(path) / search(q)
  - 各端点按 design §7.2 向 service 传显式超时（tree/file 30s、download/search 60s），错误直接抛 task-02 的 AppError 子类，router 不重复映射
  - download 强制 encoding=base64——service 返回 base64 content → router 解码 bytes → StreamingResponse + Content-Disposition attachment; filename*=UTF-8''<name>
  - main.py 挂载 app.include_router(explorer_router, prefix="/api", tags=["explorer"])
  - tests/modules/explorer/ 新增 __init__.py + test_explorer.py——patch ws_hub.get_daemon_ws_hub 为假 hub（预设 result / 抛各类异常），覆盖 containment 拒绝矩阵、绑定解析（无绑定 404 / daemon_id NULL 404 / 命中透传 root 与 path 绝对化）、错误映射 status、download 头与字节往返、search truncated 透传
acceptance:
  - openapi 可见 4 条 explorer 路径，tree/file/search 响应模型为 task-02 schema，download 为 StreamingResponse
  - 无绑定与 daemon_id NULL → 404 中文引导；offline→502、timeout→504、forbidden→403、not_found→404、method_not_found→422、越界→422 均有用例
  - download 响应含 Content-Disposition attachment 与 filename*，正文与 daemon 返回 base64 解码字节一致
  - 四端点均受 WORKSPACE_READ 保护（未授权请求 401/403 用例）
  - pytest tests/modules/explorer 全绿，ruff + mypy 通过
verify:
  - cd backend && backend/.venv/Scripts/python.exe -m pytest tests/modules/explorer -q
  - cd backend && uv run ruff check app/modules/explorer app/main.py && uv run mypy app/modules/explorer
constraints:
  - 显式超时 tree/file 30s、download/search 60s（RPC_DEFAULT_TIMEOUT=10s 不够，必须逐端点传）
  - download 强制 encoding=base64 + StreamingResponse + Content-Disposition（避免非 utf8 文件文本往返损坏）
  - 错误映射全表沿用 task-02 service 层 AppError 子类（not_found→404 / forbidden→403 / offline→502 / timeout→504 / method_not_found→422 版本过低 / WS 断连→502 / 越界→422），router 不二次映射
  - main.py 用 sibling include（router 自带 workspace prefix），避免 FastAPI ValueError duplicated param name workspace_id
  - 测试 patch ws_hub.get_daemon_ws_hub（懒导入先例 daemon/router.py:1429），不 mock send_rpc 模块级单例
  - openapi.json 与 api-types.ts 的 pnpm gen:types 再生成归 task-05，本 task 不跑
  - 不改 daemon 侧与既有端点；list_dir 裸 RPC 保持原样；中文错误文案
related_tests: []
---
