---
schema_version: 1
doc_type: module-card
module_id: file-rpc
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 目录列举 RPC（file-rpc）

## 定位

`list_dir` RPC 业务层：daemon 端目录列举（前端文件树懒加载用，逐层展开）。由
daemon.ts 包装成 RpcHandler 注册到 WsClient；ws-client 只收发分发不内嵌 fs 逻辑。
同时导出 `assertWithinAllowedRoots` 白名单校验，被 host-fs-handler 复用作所有
host_fs 方法的路径守卫。

## 契约摘要

- `listDir(path, policyEngine, runtimeId, fallbackRoots): Promise<ListDirResult>`
  ——列举一级子项（非递归），`{ entries: [{ name, type }] }`。
- `DirEntry.type` 严格 `'dir' | 'file'`（不暴露 symlink/block/socket，前端只做树形
  展示）；与 backend schema / 前端类型三端对齐。
- `assertWithinAllowedRoots(path, allowed_roots): void`——越界抛
  `RpcError('forbidden')`；空 path / 空 roots 也 forbidden（兜底防御）。

## 关键逻辑

```
权限三档: policyEngine 非空 → canRead(runtimeId, path)（读全 allow、不产 audit，D-008）
          否则 fallbackRoots 非空 → assertWithinAllowedRoots
          两者皆无 → 跳过校验（目录浏览器读自由）
listDir: lstat 判本体必须是目录(不跟 symlink) → readdir → 逐项 stat(跟 symlink，
         dangling/权限失败兜底 file 不中断) → dir 优先 + name 字符序
assertWithinAllowedRoots 三防:
  pathResolve 折叠 .. / 相对路径；root+sep 边界敏感前缀(防 /home/user 撞
  /home/user-evil)；Windows 盘符大小写归一(POSIX 不归一)
```

## 注意事项

- 错误映射（toRpcError，模块私有）：ENOENT/ENOTDIR → not_found；EACCES/EPERM →
  internal 且 message 统一 "permission denied"（防权限信息泄漏）；其他 → internal
  原样透传。
- 读操作走 PolicyEngine.canRead 只透传 runtimeId 供写类隔离裁决，读自由语义不变；
  精细化 per-runtime 裁决只属 list_dir，host_fs 走 daemon 实体级 allowed_roots。
- **非目标**：不做文件内容读取（spec 走 bundle/sync）、不递归 depth、不过滤
  hidden、无 entries 体积上限（YAGNI）。
- **已知限制（R-2）**：只校验 path 本身在 roots 内，不递归判定 readdir 出的
  symlink 是否指向 root 外（深层 symlink 沙箱属另一安全议题）。
- 空目录返回 `entries: []` 非 error。
- host-fs-handler 的 toRpcError 是本地等价实现（本模块未导出），两处需保持一致。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
