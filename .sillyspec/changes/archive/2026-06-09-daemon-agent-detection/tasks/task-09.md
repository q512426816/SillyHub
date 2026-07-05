---
id: task-09
title: "Runtimes 页面 provider 展示增强"
priority: P1
estimated_hours: 2
depends_on:
  - task-07
blocks: []
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/lib/daemon.ts
author: qinyi
created_at: 2026-06-09 23:25:05
---

# task-09: Runtimes 页面 provider 展示增强

## 修改文件

| 操作 | 文件路径 |
|------|---------|
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` |
| 修改 | `frontend/src/lib/daemon.ts` |

## 实现要求

1. 在 `frontend/src/lib/daemon.ts` 中新增 `PROVIDER_ICONS` 常量映射表，为 12 种 provider 定义显示名称和 emoji/图标标识：
   - claude -> "Claude Code", purple badge
   - codex -> "Codex", green badge
   - copilot -> "Copilot", blue badge
   - opencode -> "OpenCode", teal badge
   - openclaw -> "OpenClaw", orange badge
   - hermes -> "Hermes", indigo badge
   - gemini -> "Gemini", cyan badge
   - pi -> "Pi", pink badge
   - cursor -> "Cursor", amber badge
   - kimi -> "Kimi", red badge
   - kiro -> "Kiro", emerald badge
   - antigravity -> "Antigravity", slate badge

2. 在 `frontend/src/lib/daemon.ts` 中新增 `MIN_VERSIONS` 常量，定义各 provider 的最低版本要求（与后端一致）：
   ```
   claude: "2.0.0", codex: "0.100.0", copilot: "1.0.0"
   ```

3. 在 `frontend/src/lib/daemon.ts` 中新增 `PROVIDER_COLORS` 映射，为每种 provider 定义 Badge 颜色 class。

4. 修改 `frontend/src/app/(dashboard)/runtimes/page.tsx` 中的 Provider 列渲染：
   - 将原来的纯文本 `{r.provider ?? "—"}` 替换为带颜色样式的 `<Badge>` 组件
   - Provider 名前面加 emoji 图标
   - 未知 provider 使用灰色默认 Badge

5. 修改版本列渲染：
   - 当版本低于 `MIN_VERSIONS` 中定义的最低要求时，在版本号后显示黄色警告图标
   - 需要在前端实现简单的 semver 比较函数 `isVersionBelow(version: string, minVersion: string): boolean`

6. 在表格中新增 "Agents" 列（位于 Provider 列之后）：
   - 从 `r.capabilities?.agents` 数组中读取已检测到的 agent 名称列表
   - 以小标签或逗号分隔文本形式展示
   - 为空时显示 "—"

7. 确保 `DaemonRuntimeRead` 接口的 `capabilities` 字段类型支持 `agents?: string[]` 属性（当前为 `Record<string, any>`，已经兼容，无需改动接口定义）。

## 接口定义

### 新增类型/常量（daemon.ts）

```typescript
/** Provider 显示配置 */
export const PROVIDER_META: Record<string, { label: string; icon: string; color: string }> = {
  claude:       { label: "Claude Code",  icon: "🟣", color: "bg-purple-100 text-purple-800" },
  codex:        { label: "Codex",        icon: "🟢", color: "bg-green-100 text-green-800" },
  copilot:      { label: "Copilot",      icon: "🔵", color: "bg-blue-100 text-blue-800" },
  opencode:     { label: "OpenCode",     icon: "🔷", color: "bg-teal-100 text-teal-800" },
  openclaw:     { label: "OpenClaw",     icon: "🟠", color: "bg-orange-100 text-orange-800" },
  hermes:       { label: "Hermes",       icon: "🟣", color: "bg-indigo-100 text-indigo-800" },
  gemini:       { label: "Gemini",       icon: "💎", color: "bg-cyan-100 text-cyan-800" },
  pi:           { label: "Pi",           icon: "🩷", color: "bg-pink-100 text-pink-800" },
  cursor:       { label: "Cursor",       icon: "🟡", color: "bg-amber-100 text-amber-800" },
  kimi:         { label: "Kimi",         icon: "🔴", color: "bg-red-100 text-red-800" },
  kiro:         { label: "Kiro",         icon: "🟩", color: "bg-emerald-100 text-emerald-800" },
  antigravity:  { label: "Antigravity",  icon: "⚫", color: "bg-slate-100 text-slate-800" },
};

/** 前端已知的最低版本要求（仅用于 UI 警告展示） */
export const MIN_VERSIONS: Record<string, string> = {
  claude: "2.0.0",
  codex: "0.100.0",
  copilot: "1.0.0",
};

/** 简单 semver 比较，返回 true 表示 version < minVersion */
export function isVersionBelow(version: string, minVersion: string): boolean;
```

### 页面组件改动（page.tsx）

表格列顺序调整为：名称 | Provider | Agents | 版本 | 状态 | 最后心跳 | 创建时间

Provider 列渲染逻辑：
```tsx
<td>
  <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${meta?.color ?? "bg-gray-100 text-gray-600"}`}>
    {meta?.icon ?? "⚪"} {r.provider ?? "Unknown"}
  </span>
</td>
```

## 边界处理

1. **provider 为 null**：使用灰色默认 Badge 显示 "Unknown"，不崩溃
2. **provider 值不在已知列表中**：同上，使用默认样式兜底
3. **version 为 null 且该 provider 有最低版本要求**：不显示警告图标（未知版本不警告，只有明确低于才警告）
4. **version 格式非标准 semver**（如含 v 前缀 "v2.1.0" 或含额外后缀 "2.1.0-beta"）：`isVersionBelow` 需 strip v 前缀，取前 3 段数字比较
5. **capabilities.agents 不存在或为空数组**：Agents 列显示 "—"
6. **capabilities 整体为 null**：Agents 列显示 "—"，不崩溃

## 非目标

- 不做 provider 图标/Logo 的 SVG 替换（emoji 足够）
- 不做 runtime 详情页/展开面板
- 不做 provider 过滤/筛选功能
- 不修改后端 API 或数据模型

## 参考

- design.md: Phase 4（后端 Schema + 前端展示）
- design.md: 接口定义（12 种 provider 列表）
- design.md: 版本最低要求表
- 现有代码：`frontend/src/app/(dashboard)/runtimes/page.tsx`
- 现有代码：`frontend/src/lib/daemon.ts`

## TDD步骤

1. 先在 `daemon.ts` 中编写 `isVersionBelow` 函数，编写简单的本地调用验证（console.log 或 Node REPL）确认逻辑正确
2. 定义 `PROVIDER_META` 和 `MIN_VERSIONS` 常量，确认 TypeScript 编译通过
3. 修改 `page.tsx` 中 Provider 列渲染，引入 Badge 样式，确认页面渲染正常
4. 修改版本列，添加版本警告图标，手动测试一个低于最低版本的场景
5. 新增 Agents 列，确认 `capabilities.agents` 读取和渲染正确
6. 测试边界场景：provider 为 null、capabilities 为 null

## 验收标准

| # | 验收项 | 通过条件 |
|---|--------|---------|
| 1 | Provider Badge 展示 | 每个 runtime 的 Provider 列显示带颜色 Badge + emoji，未知 provider 灰色兜底 |
| 2 | 12 种 provider 颜色 | PROVIDER_META 覆盖全部 12 种 provider，各有独立颜色 |
| 3 | 版本警告 | version 低于 MIN_VERSIONS 的 runtime 显示警告标识 |
| 4 | 版本比较函数 | isVersionBelow("1.9.0", "2.0.0") === true, isVersionBelow("2.0.0", "2.0.0") === false |
| 5 | v 前缀处理 | isVersionBelow("v1.9.0", "2.0.0") === true，strip v 前缀后正常比较 |
| 6 | Agents 列展示 | capabilities.agents 非空时列出 agent 名称，为空显示 "—" |
| 7 | null 安全 | provider/version/capabilities 为 null 时页面不崩溃 |
| 8 | TypeScript 编译 | 无类型错误 |
| 9 | 无后端变更 | daemon.ts 只添加前端常量和工具函数，不修改 API 调用 |
