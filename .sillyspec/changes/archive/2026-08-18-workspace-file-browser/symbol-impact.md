---
author: qinyi
created_at: 2026-08-18 13:05:00
---

# 符号影响面报告 — 2026-08-18-workspace-file-browser

> execute「加载上下文」步产物。逐 task 签名级变更分析；调用点检索基于主仓当前 HEAD。

- task-01: file-rpc.ts **纯新增导出**（explorerListDir/explorerReadFile/explorerSearch + EXPLORER_* 常量），不改既有 listDir/assertWithinAllowedRoots/DirEntry 签名。既有调用点：daemon.ts（list_dir 注册，行为不变）。**受影响调用点=tests/file-rpc.test.ts:420-441 非目标守卫用例**（断言 file-rpc.ts import 不得含 readFile，本变更显式推翻该旧契约）——已在 task-01 allowed_paths 内，随 task-01 合法改写。
- task-02: backend/app/modules/explorer/ **新模块纯新增**，无既有签名变更。消费既有 MemberBindingResolver.resolve_member_binding_or_none（resolver.py:41，签名不变零改动）。无范围外调用点。
- task-03: daemon.ts **新增 3 个 registerRpcHandler 调用**（explorer_list_dir/explorer_read_file/explorer_search），不改既有函数签名；消费 task-01 新导出（范围内）。新增测试文件独立。无范围外调用点。
- task-04: explorer/router.py 纯新增；main.py **追加一行 include_router（additive）**，不改既有挂载。新增 backend 测试独立。无范围外调用点。
- task-05: api-types.ts 为 gen:types 生成产物（追加 Explorer 三响应类型，纯 additive，既有类型不动）；package.json/pnpm-lock.yaml 追加依赖；lib/explorer.ts 纯新增。无既有消费方受影响。
- task-06: file-explorer.tsx 纯新增组件。消费 task-05 的 fetchTree/fetchSearch（范围内）。无签名级变更既有代码。
- task-07: file-preview.tsx 纯新增组件。消费 task-05 的 fetchFile/fetchDownload + 既有 MarkdownText（签名不变）。无签名级变更既有代码。
- task-08: page.tsx 纯新增；workspace-tabs.tsx **TABS 数组追加一项**（数据变更非签名变更，WorkspaceTabs 组件签名不变，唯一消费方 [id]/layout.tsx 零改动）。新增页面测试独立。
- task-09: 无签名级变更（零源码修改，实测回填 design.md）。

**结论：全变更无既有签名级破坏**；唯一既有代码行为触点=file-rpc.test.ts 守卫用例（task-01 范围内合法改写）与 workspace-tabs TABS 数据追加（task-08 范围内）。无阻断项。
