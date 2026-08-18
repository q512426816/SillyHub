---
schema_version: 1
doc_type: module-card
module_id: lib-components
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 组件清单薄封装（lib-components）

## 定位
组件清单 API 的薄封装（变更 2026-07-06-component-readonly-split，D-001@V1）。组件数据已改为从 `projects/*.yaml` 只读派生（后端 `GET /workspaces/{id}/components`），不再是可写的 workspace 行；本模块只做转发，真正的客户端与类型定义都在 `@/lib/workspaces`——`Component` 类型与 `getWorkspaceComponents` 留在原处，避免循环依赖、保持单一真相。消费方为工作区详情页（`workspaces/[id]/page.tsx` 的组件区块）。

## 契约摘要
- `listComponents(workspaceId: string): Promise<{ items: Component[]; total: number }>`
  - 列出项目组的一级子项目组件（只读，来自 projects/*.yaml）。
  - 实现即 `return getWorkspaceComponents(workspaceId)`，无任何本地加工。
- `export type { Component }` — 从 `@/lib/workspaces` 再导出，调用方不必感知真实归属。
- 无其它导出。**不存在** `getComponent` / `reparseComponents` / `getTopology` 等函数（源文件全量仅 21 行，出现即属索引符号漂移）。

## 关键逻辑
整个模块无独立逻辑，等价于：
```
import { getWorkspaceComponents, type Component } from "@/lib/workspaces"
listComponents(id) = getWorkspaceComponents(id)
```

## 注意事项
- 本文件唯一的 import 是 `@/lib/workspaces`——连 `apiFetch` 都不直接用；这也是它「别名层」定位的直接证据。
- 旧版（2026-06 卡）描述的「兼容层：root_path 前缀判定父子 + reparse/getTopology 重映射」已全部不存在；按旧卡找逻辑会扑空。
- 改组件相关接口先看 `@/lib/workspaces`，本文件只是别名层；在此文件加逻辑会破坏「单一真相」约定。
- 组件是只读派生数据：前端无组件 CRUD；数据刷新依赖 workspace reparse（lib-workspaces 域），不经本模块。
- 若组件域将来需要 hooks、分页或筛选，应评估让调用方直接 import `@/lib/workspaces`，而非继续扩本文件。
- `Component` 的字段（tech_stack/build_command 等）以 `@/lib/workspaces` 中的定义为准，本卡不复制。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
