---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-09
title: provider 下拉共享组件 AgentProviderSelect（复用 PROVIDER_META + listDaemonRuntimes）
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-10, task-11, task-12]
allowed_paths:
  - frontend/src/components/AgentProviderSelect.tsx
---

# task-09: provider 下拉共享组件 AgentProviderSelect

## 上下文
三个触发面板（设置页/task/stage+scan）都需要 provider 下拉。新建一个共享组件，选项来自在线 runtime 的 distinct provider，用 `PROVIDER_META` 渲染 label/icon/color。无后端依赖（纯前端组件，读 daemon.ts 既有 API）。

## 修改文件（必填）
- `frontend/src/components/AgentProviderSelect.tsx`（新增）

## 实现要求
1. **props**：
   ```typescript
   interface AgentProviderSelectProps {
     value: string | null;
     onChange: (provider: string | null) => void;
     /** 选项里的"使用默认/未设置"文案；不传则不显示该兜底项 */
     includeDefault?: boolean;
     className?: string;
   }
   ```
2. **数据源**：组件内 `useEffect` 调 `listDaemonRuntimes()`（daemon.ts 既有），取 `status === "online"` 的 distinct provider（R-04：打开即拉取，不长期缓存）。
3. **渲染**：
   - 用 `<select>`（对齐现有 task 面板的 select 风格，Tailwind class）。
   - 每个 option：`PROVIDER_META[provider]?.label ?? provider` 作为显示文本，value=provider。
   - `includeDefault` 为真时在最前面加一个 `value=""`（语义 null）的选项，文案如"使用默认"或"未设置"。
   - 当前 `value` 不在在线列表时（如 default_agent 指向离线 provider），仍渲染该项但标注（如"claude（离线）"），保证可识别（R-01）。
4. **value=null** 映射到"使用默认/未设置"选项（value=""）。
5. 受控组件：`value` + `onChange`，不维护内部选中态（除加载状态）。

## 接口定义（代码类任务必填）
```tsx
"use client";
import { useEffect, useState } from "react";
import { listDaemonRuntimes, PROVIDER_META } from "@/lib/daemon";

interface AgentProviderSelectProps {
  value: string | null;
  onChange: (provider: string | null) => void;
  includeDefault?: boolean;
  className?: string;
}

export function AgentProviderSelect({ value, onChange, includeDefault, className }: AgentProviderSelectProps) {
  const [providers, setProviders] = useState<string[]>([]);
  useEffect(() => {
    listDaemonRuntimes().then((rs) => {
      const online = rs.filter((r) => r.status === "online" && r.provider);
      setProviders(Array.from(new Set(online.map((r) => r.provider!))));
    }).catch(() => setProviders([]));
  }, []);
  // value="" → null；渲染 select；离线 value 单独标注
}
```

## 边界处理（必填）
- **listDaemonRuntimes 失败**：catch 后 providers=[]，下拉只显示兜底项，不崩（R-04）。
- **无在线 runtime**：providers=[]，仅兜底项可选。
- **value 指向离线 provider**：单独渲染该 option 并标注"（离线）"，保证用户看到当前默认（R-01）。
- **value=null**：映射到"使用默认/未设置"项。
- **重复 provider**（同 provider 多 runtime）：distinct 去重。
- **不缓存**：每次挂载拉取（避免新注册 provider 不出现，R-04）；若担心频繁请求，可加短 TTL，但 MVP 不缓存即可。

## 非目标（本任务不做的事）
- 不做 runtime 级选择（只 provider 维度）。
- 不做权限/配额。
- 不写父组件用法（task-10/11/12）。

## 参考
- `PROVIDER_META`（daemon.ts，12 个 provider，含 label/icon/color）。
- `listDaemonRuntimes` / `DaemonRuntimeRead`（daemon.ts）。
- 现有 task 面板 select 风格（tasks/[tid]/page.tsx 的 `<select disabled>`）。

## TDD 步骤
1. typecheck：`cd frontend && pnpm typecheck`。
2. 手动验证：在 task-10 设置页挂载 `<AgentProviderSelect>`，确认渲染在线 provider + 兜底项。
3. `cd frontend && pnpm build` 通过。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | pnpm typecheck | 无错误 |
| AC-02 | 挂载后渲染在线 runtime 的 distinct provider | 选项 = 在线 provider |
| AC-03 | value=null + includeDefault | 显示"使用默认/未设置"选项且选中 |
| AC-04 | value 指向离线 provider | 该项渲染并标注"（离线）" |
| AC-05 | listDaemonRuntimes 失败 | 不崩，仅兜底项 |
| AC-06 | pnpm build | 通过 |
