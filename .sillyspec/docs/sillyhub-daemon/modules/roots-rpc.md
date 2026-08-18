---
schema_version: 1
doc_type: module-card
module_id: roots-rpc
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 磁盘根列表 RPC（roots-rpc）

## 定位
`list_roots` RPC handler（`src/roots-rpc.ts`，单文件）：给前端「远程文件夹选择器」
提供本机磁盘根列表作为浏览起点。与 `list_dir`（file-rpc）语义分离——list_roots
回答「起点是什么」，list_dir 列举某目录子项（后续浏览由它的
assertWithinAllowedRoots 做沙箱校验）。daemon.ts 注册：
`ws.registerRpcHandler('list_roots', () => listRoots())`。

## 契约摘要
- `listRoots(): Promise<ListRootsResult>`——`ListRootsResult = { roots: string[] }`，
  元素带 OS 原生尾部分隔符（Windows `\`，Unix `/`），与 backend schema / 前端类型三端对齐。
- 零模块级依赖（仅 node:fs existsSync + node:os platform）；被 daemon 使用。

## 关键逻辑
```
listRoots():
  win32 → 遍历 A:\ ~ Z:\ 逐个 existsSync 探测，收集存在盘符（带尾 \）
  Linux/macOS → 固定 ['/']
  单盘探测 try/catch 跳过不中断；外层兜底 catch → { roots: [] } 不抛（仅 warn）
```

## 注意事项
- 根列举是「展示」不是「放行」：本模块刻意不做权限/白名单校验（根列表不涉敏感
  数据，沙箱在 list_dir 后续环节）。
- Windows 返回带尾部反斜杠（`C:\`），对齐 pathResolve 后根含尾 sep 的约定，
  防下游拼接 `C:` + `Users` ≠ `C:\Users`。
- 已知限制：不枚举 UNC 网络路径（`\\host\share`，需 GetLogicalDriveStrings 原生
  API 超出范围）；existsSync 无法区分「盘符保留但无介质」（空光驱通常 false 跳过，
  符合预期）；不做挂载点/卷标/容量元数据（YAGNI）。
- 全盘探测失败返回空数组，前端自行降级（如 homedir 作默认起点），不阻断初始化。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
