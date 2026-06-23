---
schema_version: 1
doc_type: module-card
module_id: file-rpc
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:50
---
# file-rpc

## 定位
`list_dir` RPC 业务层（`src/file-rpc.ts`）。实现 daemon 端目录列举：allowed_roots 白名单校验 + 目录判定 + readdir/stat + 排序。由 daemon.ts 包装成 RpcHandler 注册到 WsClient。与 ws-client 的关系：ws-client 只负责收发/分发，本模块是 fs 业务层（职责分离）。

## 契约摘要
- `DirEntry`（name + type:'dir'|'file'）。
- `ListDirResult`（{ entries: DirEntry[] }，与 backend schema / 前端类型三端对齐）。
- `assertWithinAllowedRoots(path, allowed_roots): void` ——白名单校验，越界抛 `RpcError('forbidden')`。
- `listDir(path, allowed_roots): Promise<ListDirResult>` ——列举一级子项（非递归）。

## 关键逻辑
```
assertWithinAllowedRoots: pathResolve(path) 折叠 .. 后，边界敏感比较
  resolved === root || resolved.startsWith(root + sep)
  Windows 盘符 toLowerCase 归一（NTFS 不区分大小写）
listDir:
  1. assertWithinAllowedRoots
  2. lstat(abs) 必须是目录（不跟随 symlink，避免 symlink-to-file 被当目录）→ 非目录 RpcError('not_found')
  3. readdir → 逐项 stat（follow symlink）：symlink-to-dir 归 dir
     单项 stat 失败（dangling/权限）→ 兜底 file + 不中断
  4. 排序：dir 优先，同类 name 字符序
```
错误映射（toRpcError）：ENOENT/ENOTDIR→not_found；EACCES/EPERM→internal（message 统一 "permission denied" 防信息泄漏）；其他→internal 原透传。

## 注意事项
- **非目标**：不做文件内容读取（FR-05 spec 走 bundle/sync）、不做递归 depth、不滤 hidden、无 entries 体积上限（YAGNI）。
- **已知限制 R-2**：只校验 path 本身在 allowed_roots 内，不递归判定 readdir 出的 symlink 是否指向 root 外（深层 symlink 沙箱属另一议题）。
- type 严格 dir/file 两值，不暴露 symlink/block/socket（前端只做树形展示）。
- 空目录返回 `{ entries: [] }`（非 error）。
- RpcError code 集合：forbidden / not_found / method_not_found（ws-client 侧）/ internal，与 design §7.1 协议约定一致。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
