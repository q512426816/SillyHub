---
id: task-08
title: 新建 `frontend/src/components/llm-providers/model-input-with-fetch.tsx`（shadcn DropdownMenu，按 owned_by 分组选；移植 cc-switch `ModelInputWithFetch.tsx`，中文）。props `{value, onChange, fetchedModels?, isLoading?, onFetch?}`。（覆盖：FR-04 组件）
title_zh: 模型输入组件（获取+下拉选）
priority: P0
depends_on: []
blocks: [task-09, task-14]
requirement_ids: [FR-04]
decision_ids: []
created_at: 2026-07-27 09:47:54
author: qinyi
allowed_paths:
  - frontend/src/components/llm-providers/model-input-with-fetch.tsx
provides:
  - contract: ModelInputWithFetch props
    fields: [value, onChange, fetchedModels, isLoading, onFetch]
goal: >
  建带获取/下拉选模型的输入组件，供角色映射区复用
implementation: |
  - shadcn Input + DropdownMenu（复用 frontend/src/components/ui/dropdown-menu.tsx，已导出 Trigger/Content/Item/Label/Separator）+ Button + lucide-react ChevronDown/Download/Loader2
  - 移植 cc-switch `src/components/providers/forms/shared/ModelInputWithFetch.tsx` 的四态分支：fetchedModels.length>0 → Input + 按钮触发 DropdownMenu（按 owned_by 分组，DropdownMenuSeparator 分隔，DropdownMenuLabel 显分组名，DropdownMenuItem onSelect 调 onChange(model.id)）/ isLoading → Input + Loader2 spinner / 有 onFetch → Input + Download 获取按钮 / 无 onFetch → 纯 Input
  - props 严格 `{value:string; onChange:(v:string)=>void; fetchedModels?:{id:string;owned_by:string|null}[]; isLoading?:boolean; onFetch?:()=>void}`（字段名照抄契约；owned_by 用下划线对齐后端响应，不照 cc-switch 的 ownedBy 驼峰）
  - 全中文：分组兜底名用「其他」（cc-switch 是 "Other"）；按钮 title「获取模型列表」
  - 纯展示+回调，不自己发请求（请求由父组件 task-09 经 task-11 的 fetchProviderModels 发）
acceptance: |
  - fetchedModels 非空 → 下拉按 owned_by 分组可选，选中触发 onChange(model.id)
  - isLoading=true → 显示 spinner，按钮 disabled
  - 无 onFetch 且无数据 → 退化为纯 Input
  - 组件不 import 任何 api/网络层（grep 验无 fetch/axios/lib/api）
verify: |
  - `cd frontend && pnpm typecheck`
  - `cd frontend && pnpm test`
constraints: |
  - 中文 UI（CLAUDE.md 规则 12），分组兜底名「其他」
  - 用 shadcn 不引重依赖（不装 monaco/combobox，只用既有 ui/* + lucide-react）
  - 组件纯展示+回调，请求由父组件 task-09 经 task-11 发（本组件永不直接调 api）
  - 跨平台（无 Node/fs，纯浏览器组件）
