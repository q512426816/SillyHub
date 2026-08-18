---
id: task-02
title: implement-explorer-schema-and-service
title_zh: explorer 模块 schema 与 service 层（绑定解析+containment 预检+RPC 转发+错误映射）
author: qinyi
created_at: 2026-08-18 12:39:45
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-01, FR-05, FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/explorer/__init__.py
  - backend/app/modules/explorer/schema.py
  - backend/app/modules/explorer/service.py
provides:
  - contract: ExplorerTreeResponse
    fields: [entries]
  - contract: ExplorerFileResponse
    fields: [name, size, mtime, binary, truncated, content]
  - contract: ExplorerSearchResponse
    fields: [matches, truncated]
  - contract: ExplorerService
    fields: [list_tree, read_file, download, search]
expects_from:
  task-01:
    - contract: ExplorerDirEntry
      needs: [name, type, size, mtime]
    - contract: ExplorerReadFileResult
      needs: [name, size, mtime, binary, truncated, content]
    - contract: ExplorerSearchResult
      needs: [matches, truncated]
goal: >
  建立 backend explorer 模块的 schema 与 service 层——复用 MemberBindingResolver 解析当前用户绑定，
  跨平台 containment 预检 + 显式超时 WS RPC 转发 + 全量错误映射，为 task-04 四端点提供 ExplorerService。
implementation:
  - 新建 backend/app/modules/explorer/，__init__.py 模块占位
  - schema.py 定义 ExplorerEntry(name/type dir|file/size/mtime) + ExplorerTreeResponse + ExplorerFileResponse(content 可空) + ExplorerSearchMatch(path 相对 root/name/type) + ExplorerSearchResponse，字段键与 daemon RPC result snake_case 对齐（design §6/§7.1）
  - service.py 定义 ExplorerService 四方法（list_tree/read_file/download/search）——绑定解析一律 MemberBindingResolver.resolve_member_binding_or_none，返回 None 或 daemon_id IS NULL → 404 中文引导
  - containment 预检——root_path 含盘符/反斜杠/UNC 前缀分发 PureWindowsPath 语义，否则 PurePosixPath；拒绝绝对路径、.. 逃逸、空路径外控制字符
  - ws_hub 懒导入 get_daemon_ws_hub()（daemon/router.py:1429 同款理由）→ send_rpc 显式 timeout 转发 explorer_list_dir/explorer_read_file/explorer_search
  - 错误映射——DaemonRpcRemoteError 按 code 分派（not_found→404 / forbidden→403 / method_not_found→422 版本过低 / 其它→502）、DaemonRuntimeOffline 与 WS 断连→502、DaemonRpcTimeout→504、containment 拒绝→422；模块本地 AppError 子类承载
acceptance:
  - member_runtimes 零改动、无新增查询函数（git diff 验证）
  - containment 拒绝矩阵（绝对路径 / .. 逃逸 / UNC / 控制字符，Windows 形态与 POSIX 形态 root 各验一遍）全部 422
  - 八类错误映射（未绑定 / not_found / forbidden / offline / timeout / method_not_found / WS 断连 / 越界）各自 http_status 独立可断言
  - 四方法均显式传 timeout（tree/file 30s、search/download 60s），不落 RPC_DEFAULT_TIMEOUT 默认 10s
  - ruff + mypy 通过
verify:
  - cd backend && backend/.venv/Scripts/python.exe -c "from app.modules.explorer.service import ExplorerService"（导入冒烟；HTTP 测试归 task-04）
  - cd backend && uv run ruff check app/modules/explorer && uv run mypy app/modules/explorer
constraints:
  - 不新增 member_runtimes 查询函数，一律复用 MemberBindingResolver.resolve_member_binding_or_none；绑定缺失或 daemon_id IS NULL → 404 中文引导（D-003；不借 resolve_daemon_instance_for_workspace，无 user 门控属已知坑）
  - containment 预检按 root_path 形态分发 PureWindowsPath/PurePosixPath（Linux 容器上校验 Windows 路径不能用 os.path.normpath）；仅预检，安全裁决以 daemon 侧 realpath+allowed_roots 为准
  - 显式超时 tree/file 30s、search/download 60s（RPC_DEFAULT_TIMEOUT=10s 不够）
  - 错误映射全表 not_found→404 / forbidden→403 / offline→502 / timeout→504 / method_not_found→422 版本过低 / WS 断连→502 / 越界→422
  - 中文错误文案（用户面），AppError 惯例（类属性 code/http_status，参照 daemon/runtime/service.py 先例）
  - 本 task 不写 router.py、不改 main.py、不写 HTTP 测试（归 task-04）；不动 workspace member_runtimes 任何文件
related_tests: []
---
