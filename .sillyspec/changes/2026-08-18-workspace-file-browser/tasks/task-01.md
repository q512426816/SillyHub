---
id: task-01
title: add-explorer-functions-to-file-rpc
title_zh: daemon file-rpc 新增 explorer 三函数与安全常量
author: qinyi
created_at: 2026-08-18 12:39:45
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-01, FR-02, FR-04, FR-05]
decision_ids: [D-002@v1, D-004@v1, D-005@v1]
allowed_paths:
  - sillyhub-daemon/src/file-rpc.ts
  - sillyhub-daemon/tests/file-rpc.test.ts
provides:
  - contract: ExplorerDirEntry
    fields: [name, type, size, mtime]
  - contract: ExplorerReadFileResult
    fields: [name, size, mtime, binary, truncated, content]
  - contract: ExplorerSearchResult
    fields: [matches, truncated]
expects_from: {}
goal: >
  在 file-rpc.ts 落地 explorerListDir/explorerReadFile/explorerSearch 三个只读函数与 EXPLORER 常量，统一走 realpath 落点加 allowed_roots 双重校验（design §5 关键安全设计 1、§7.1）。
implementation:
  - 新增导出常量 EXPLORER_MAX_READ_BYTES=10MB（D-004@v1）与 EXPLORER_EXCLUDED_NAMES（node_modules/.git/dist/__pycache__/.next 等，仅 search 用）；抽私有 realpath 双校验 helper——fs.realpath 解析 path 与 root 双方后做边界敏感比较（相等或 startsWith 加 sep，Windows 盘符大小写归一），再叠 assertWithinAllowedRoots(path, roots)，两层都过才碰盘
  - explorerListDir(path, root, roots)——双校验后 lstat 判目录（非目录 not_found），readdir 逐项 stat 取 size 与 mtime，返回 entries（mtime 为 ISO 串），dir 优先排序
  - explorerReadFile(path, root, roots, encoding)——双校验后 stat 拿 size/mtime；按 stat.size 用 open 加 read 只读上限字节（不整读大文件入内存），超 10MB 置 truncated 且截断先于传输（R-04）；utf8 解码按 NUL 与替换符比例嗅探二进制，binary=true 加 base64 兜底不报错，截断边界误切多字节字符不得误判 binary；encoding=base64 强制 base64（FR-03 download 链路），默认 utf8
  - explorerSearch(root, query, roots, maxResults)——root 双校验后纯 Node fs 递归遍历（不 shell out，三平台一致），跳过 EXPLORER_EXCLUDED_NAMES，文件与目录名大小写不敏感子串匹配，matches 的 path 相对 root，达上限（默认 100）置 truncated=true 收敛返回
  - 同步更新 tests/file-rpc.test.ts 末尾「非目标守卫」describe（约 420-441 行）——其「不 import readFile」断言基于 2026-06 旧变更 design §3 非目标，本变更 design §1 与 §7.1 已显式引入读内容，属守卫语义过时的同步改写（改为守卫 listDir 仍不读内容、读能力只经 explorerReadFile 暴露），非为通过而改测试
acceptance:
  - 三函数返回键逐字对齐 design §7.1 三契约（provides 所列字段）；mtime 为 ISO 串、matches.path 相对 root
  - realpath 逃逸防护函数层生效——symlink 指向 root 外抛 forbidden、root 本身为 symlink/junction 不误拒；超 10MB truncated 且截断先于传输；二进制走 base64 不报错；搜索上限 100 加噪声排除
  - 既有测试全绿（含改写后的守卫用例）加 typecheck 0 error；listDir 与 assertWithinAllowedRoots 既有签名行为不变（plan 全局验收 brownfield 条目）
verify:
  - cd sillyhub-daemon && pnpm test && pnpm run typecheck
constraints:
  - 只读语义——禁引入任何写 fs API；错误码沿用 RpcError 体系 forbidden/not_found/internal；不动 daemon.ts（handler 注册归 task-03）；勿改 listDir 既有签名
  - realpath 比较必须用 realpath 后的双方（root 本身是 symlink 时不误拒）；EXPLORER_EXCLUDED_NAMES 仅作用于 search，tree 全量返回（design §5 第 5 点）
related_tests: []
---
