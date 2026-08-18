---
schema_version: 1
doc_type: module-card
module_id: lib-scan-docs-tree
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 扫描文档目录树（lib-scan-docs-tree）

## 定位

纯函数工具模块：把扫描文档的平铺列表（`ScanDocSummary[]`）按 `path` 构建为目录树，
供 scan-docs 页面渲染树形文档导航。无 React 依赖、无网络请求，是 lib-scan-docs 的
下游加工层（scan-into-session 变更域拆出）。

## 契约摘要

- `buildTree(docs: ScanDocSummary[]): TreeNode[]` — 唯一导出函数。
- `TreeNode { name; path; doc?: ScanDocSummary; children: TreeNode[] }` —
  目录节点不带 `doc`，文件节点（路径末段）挂原始 `doc` 摘要。
- 输入类型 `ScanDocSummary` 来自 `./scan-docs`（lib-scan-docs 模块）。

## 关键逻辑

```
allParts = doc.path.split("/")
自适应剥离前导包裹段: .sillyspec(可选) + docs → start
逐段 find-or-create 子节点；末段挂 doc
排序: 目录(无doc)在前 → 文件在后 → 各自 name.localeCompare
```

## 注意事项

- **两种 path 布局自适应**：扁平布局 `docs/<组件>/...`（daemon-client /
  platform-managed）与包裹布局 `.sillyspec/docs/<组件>/...`（repo-native）。
  前缀规则与 backend `scan_docs/parser.py` 的 `platform_managed` 决定的 rel_path
  前缀对应；修复前写死 `slice(2)` 只适配包裹布局，会把扁平布局的「组件名」层切掉。
- `components/admin-organization-tree.tsx` 内有另一个同名局部 `buildTree`，
  与本模块无关，改动时勿混淆。
- 有配套单测 `frontend/src/lib/__tests__/scan-docs-tree.test.ts`（含两种布局用例），
  改剥离逻辑必须同步补用例。
- 唯一生产消费方：`app/(dashboard)/workspaces/[id]/scan-docs/page.tsx`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
