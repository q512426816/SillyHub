---
id: task-10
title: 修改 frontend/src/components/app-shell.tsx — useWorkspaceId 复用 use-workspace-context、进入 ws 写 store；resolveHref 不变；全量前端测试回归
title_zh: app-shell 接入上下文 hook + 全量回归
author: qinyi
created_at: 2026-07-09 23:15:00
priority: P0
depends_on: [task-04]
blocks: []
allowed_paths:
  - frontend/src/components/app-shell.tsx
---

## 目标(goal)

把 `app-shell.tsx` 内现有的本地 `useWorkspaceId`（第 104-108 行，纯 URL 正则解析）改为复用 task-04 的 `useWorkspaceContext` 组合 hook，使**进入工作区时顺带把当前 ws 写入 store 缓存**（FR-01 上下文缓存），供顶栏 `WorkspaceSwitcher`（task-08）等消费。`resolveHref`（第 191-196 行）路径派生逻辑**保持不变**——URL 仍是真相源，store 只是叠加缓存层（design §9 兼容策略）。

本任务是 Wave 4 收尾，覆盖：FR-01（工作区上下文）、R-06（改 layout/router/app-shell 必跑全量回归，记忆教训）。

## 实现(implementation)

修改 `frontend/src/components/app-shell.tsx`：

1. **删除本地 `useWorkspaceId` 函数定义**（第 104-108 行）：
   ```ts
   // 删除整段
   function useWorkspaceId(): string | null {
     const pathname = usePathname();
     const match = pathname.match(/^\/workspaces\/([^/]+)/);
     return match?.[1] ?? null;
   }
   ```

2. **新增 import**（顶部 import 区）：
   ```ts
   import { useWorkspaceContext } from "@/lib/use-workspace-context";
   ```
   > task-04 的 hook 内部仍以 URL 正则 `^/workspaces/([^/]+)` 为 wsId 真相源（与现有本地实现逐字一致），并叠加：进入 ws（wsId 非空）时调 `useWorkspaceStore.getState().setCurrent(...)` 写缓存；wsId 为空时不写（平台页/admin/ppm 等不污染缓存）。ws 对象详情（name/daemon 状态）由 task-04 内部聚合，app-shell 只消费 wsId 字符串。

3. **替换调用点**（第 115 行）：
   ```ts
   // 改前
   const workspaceId = useWorkspaceId();
   // 改后
   const { workspaceId } = useWorkspaceContext();
   ```
   `workspaceId` 仍是 `string | null`，下游 `resolveHref` / `isActive` / `renderNavLink` 全部无感（变量名与类型不变）。

4. **`resolveHref` / `isActive` / `renderNavLink` 一律不动**（第 191-276 行）：路径派生仍以 `workspaceId` 字符串拼 `/workspaces/${workspaceId}/${menu.href}`，URL 为真相源（D-006 用户硬约束，design §9）。无 wsId 时相对菜单灰显逻辑（第 259-267 行）原样保留。

要点：
- **零行为变更承诺**：本任务对用户可见行为零改动——`workspaceId` 的值来源从本地正则换成 task-04 hook（内部同样跑正则），渲染、菜单灰显、路径派生完全一致。store 写入是**旁路副作用**（task-04 内部 `setState`），不影响 app-shell 自身渲染。
- **不引入新 state/effect**：app-shell 不直接调 store，写缓存完全委托给 task-04 hook，app-shell 只解构 `workspaceId`。
- **`usePathname` import 保留**：app-shell 第 114 行 `const pathname = usePathname()` 仍被 `isActive` / `inPpm` / 菜单隔离逻辑使用，不能因删 `useWorkspaceId` 误删 `usePathname` import。

## provides

- `app-shell.tsx` 接入 `useWorkspaceContext`（复用 task-04），进入工作区时经 hook 旁路写 store 缓存
- 全量前端测试回归确认零回归（R-06 收尾证据）

## expects_from

- task-04：`frontend/src/lib/use-workspace-context.ts` 导出 `useWorkspaceContext()`，返回 `{ workspaceId: string | null, ... }`（wsId 仍以 URL 正则为真相源，内部叠加 store 写入副作用）

## 验收标准

- [ ] 删除 app-shell 本地 `useWorkspaceId` 函数（第 104-108 行）
- [ ] 新增 `import { useWorkspaceContext } from "@/lib/use-workspace-context"`
- [ ] 第 115 行改为 `const { workspaceId } = useWorkspaceContext()`，变量名/类型不变
- [ ] `resolveHref`（191-196）/ `isActive`（198-208）/ `renderNavLink`（232-276）逐字未改
- [ ] `usePathname` import 保留（仍被 `isActive`/`inPpm`/菜单隔离使用）
- [ ] 未引入新的 state / useEffect / 直接 store 调用（写缓存全委托 task-04）

## 验证(verify)

```bash
cd frontend
pnpm typecheck                              # 类型：解构 { workspaceId } 与下游 string|null 兼容
pnpm lint                                   # 删函数后无 unused import（usePathname 仍用）
pnpm test -- components/app-shell           # 现有 app-shell 测试（菜单灰显/路径派生）零回归
pnpm test                                   # 全量回归（R-06：改 app-shell 必跑，记忆教训）
pnpm build                                  # 构建通过（Next.js 路由层无破坏）
```

> R-06 强制：本任务是变更最后一个改 layout/router/app-shell 的任务，`pnpm test` 全量必须绿。若 app-shell 现有测试因 mock 方式（如直接 mock `usePathname` 而非 hook）失败，调整测试 mock 指向 `use-workspace-context`，**不改测试断言**（CLAUDE.md 规则 8：非测试本身有误不改测试"通过"）。

## 约束(constraints)

- **URL 路径派生真相源不变**（D-006 / design §9）：`resolveHref` 不动，store 只是叠加缓存层，深链/刷新零回归。
- **仅改 `frontend/src/components/app-shell.tsx`**（allowed_paths）；task-04 的 hook 文件由 task-04 负责，本任务只消费。
- **R-06 全量回归强制**（记忆教训：改 router/layout/app-shell 必跑 `pnpm test` 全量，单测覆盖不到的渲染路径回归只在全量暴露）。
- **不直接操作 store**：app-shell 不 `import` stores/workspace，写缓存副作用完全封装在 task-04 hook 内，保持 app-shell 对 store 无感知（解耦，便于回退——删 hook 引用即恢复纯路径派生，design §9 回退路径）。
- 项目未上线，无历史兼容负担（CLAUDE.md 规则 10）。
