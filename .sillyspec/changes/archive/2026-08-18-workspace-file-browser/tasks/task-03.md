---
id: task-03
title: register-explorer-rpc-handlers-and-tests
title_zh: daemon 注册 explorer_* 三 handler 并落地安全矩阵测试
author: qinyi
created_at: 2026-08-18 12:39:45
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01, FR-05, FR-06]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/tests/file-rpc-explorer.test.ts
provides:
  - contract: explorer RPC methods
    fields: [explorer_list_dir, explorer_read_file, explorer_search]
expects_from:
  task-01:
    - contract: explorer 函数集
      needs: [explorerListDir, explorerReadFile, explorerSearch]
goal: >
  在 daemon.ts 注册 explorer_list_dir/explorer_read_file/explorer_search 三个 RPC handler（roots 强制现取 _effectiveAllowedRoots）并落地 daemon 侧安全矩阵测试。
implementation:
  - daemon.ts 新增 _registerExplorerRpcHandler(ws)，在 _createWsClient 既有三连注册处（_registerListDirRpcHandler/_registerGetSpecBundleRpcHandler/_registerHostFsRpcHandler，约 2321-2326 行）追加调用
  - 三 handler 归一 params（path/root/query/max_results 类型校验，max_results 默认 100，encoding 仅接受 utf8 或 base64 且默认 utf8）；roots 每次 RPC 现取 this._effectiveAllowedRoots()（参照 host_fs rootsProvider 模式 daemon.ts 2424 行附近，policy_update 推送后下次调用立即生效）
  - handler 内 try/catch 消化异常为 RpcError 结构化返回，不冒泡到 ws-client _dispatchRpc 之外（对齐 host_fs handler 注释约定）
  - 新建 tests/file-rpc-explorer.test.ts——参照 tests/file-rpc.test.ts 结构（mkdtemp 临时根 + describe/it + RpcError code 断言 + Windows symlink EPERM skip 兜底参照 T9 先例），矩阵至少覆盖：工作区内 symlink 指向 root 外抛 forbidden（R-01 realpath 逃逸）、点点与绝对路径越界 forbidden、root 为 junction 不误拒、超 10MB 文件 truncated=true、二进制文件 binary=true 且 content 为 base64、encoding=base64 强制、搜索结果上限 100 且 truncated、node_modules 与 .git 噪声目录排除、handler 层 roots 现取生效
acceptance:
  - 三方法名逐字对齐 design §7.1 并注册于 WS 连接建立路径；roots 每次调用现取 _effectiveAllowedRoots()，绝不出现空 roots 跳校验
  - 安全矩阵测试全绿——symlink 指外与路径越界 forbidden、超 10MB truncated、二进制 base64、encoding=base64、搜索上限与噪声排除、root 为 junction 不误拒
  - 既有 daemon 测试全绿加 typecheck 0 error；list_dir 与 list_roots 裸 RPC 行为不变（回归，plan 全局验收 brownfield 条目）
verify:
  - cd sillyhub-daemon && pnpm test && pnpm run typecheck
constraints:
  - 注册 handler 时 roots 必须取 _effectiveAllowedRoots() 现值，禁止照抄 _registerListDirRpcHandler 空 roots 跳校验写法（daemon.ts 2343 行附近 ql-20260706-006 豁免仅限裸 list_dir，design §5 关键安全设计 1 警示条）
  - 测试文件路径用 sillyhub-daemon/tests/file-rpc-explorer.test.ts（仓库既有约定，非 src 双下划线 tests 目录）
  - 不改 file-rpc.ts——函数实现归 task-01，发现函数缺陷回 task-01 修不越界；daemon.ts 只加注册与参数归一，不动其它 handler 与连接管理
related_tests:
  - sillyhub-daemon/tests/file-rpc-explorer.test.ts
---
