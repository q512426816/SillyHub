---
task_id: task-08
title: 写 workspace-config-card.test.tsx（6 状态分支 + 编辑就地展开/保存/收起 + server-local 隐藏 + cache_root tooltip 文案 + 操作按钮行为含轮询/卸载清理/visibilitychange）
change: 2026-07-05-workspace-config-card
author: qinyi
created_at: 2026-07-05T01:18:51
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-006, FR-007, FR-008]
decision_ids: []
allowed_paths:
  - frontend/src/components/workspace-config-card.test.tsx
---

# Task-08 写 workspace-config-card.test.tsx

## Goal

新建组件测试 `frontend/src/components/workspace-config-card.test.tsx`，覆盖 design §5.3 六状态分支 + §5.4 编辑就地展开/保存/收起 + server-local 字段隐藏 + cache_root tooltip 三平台文案 + 五个操作按钮行为（initPollRef/syncPollRef 轮询、卸载清理、visibilitychange 暂停、owner 门禁、409 重扫确认）。承载 AC-09 / SC-8，FR-006 / FR-007 / FR-008 / NFR-01 / NFR-03 的验证证据。

## Implementation

1. 测试文件顶部用 `vi.mock` 模拟 API 客户端模块（参考 page.test.tsx 第 55-107 行 hoisted 模式）：`@/lib/workspace-binding`（fetchMyBinding / upsertMyBinding）、`@/lib/spec-workspaces`（getSpecWorkspace / initDispatch / syncManual / listPendingSync / importSpecWorkspace）、`@/lib/workspaces`（scanGenerate / generateProjects）、`@/lib/daemon`（listDaemonInstances）、`@/lib/components`（listComponents）。
2. mock `WorkspaceAccessGuide` 子组件（避免其内部 daemon 列表加载链），用 `data-testid="workspace-access-guide"` 占位；用 `onConfigured` / `initial` props 反向驱动编辑保存断言。
3. fixtures：参考 page.test.tsx `makeWorkspace` / `mockDefaultBinding`，准备 6 套 props（workspace + specWs + myBinding + boundDaemon + isOwner）覆盖六态：① loading（render 后立刻断言骨架，不等 waitFor） ② error（fetchMyBinding.mockRejectedValue 一次） ③ myBinding=null（未绑定首次引导） ④ init_synced_at=null（已绑定未初始化 amber） ⑤ init_synced_at≠null（已绑定已初始化 emerald） ⑥ path_source='server-local'（隐藏 daemon/cache 字段 + 显示"服务器本地工作区，无需守护进程"文案）。
4. 编辑流程组：点 `data-testid="config-edit-entry"` → 断言 WorkspaceAccessGuide 收到 initial=当前 binding；模拟 onConfigured 回调 → 断言 onRefresh 被调用 + 表单收起（config-edit-entry 重新可见）。
5. cache_root tooltip 文案组：daemon-client 工作区 hover/focus 缓存路径字段 → 断言 tooltip 文本含 `~` + `C:\Users\<你>` + `/home/<你>` 三平台。
6. 操作按钮组：① 初始化：vi.useFakeTimers，点初始化 → initDispatch 调用 → 快进 2s → fetchMyBinding 返回 init_synced_at → 断言 initPollRef clearInterval（轮询停止）+ onRefresh 调用。② 同步：syncManual 返 status≠done → 快进 2s → listPendingSync 返 done → 断言按钮"已同步"+ syncPollRef clearInterval。③ 同步 5min 上限：快进 5min+ → 断言 syncStatus='failed' + syncError 非空。④ 409 重扫：scanGenerate 抛 409 → confirm true → 断言二次调用。⑤ owner 门禁：isOwner=false → 扫描/生成按钮 disabled + title 提示。
7. 卸载清理组：触发 initPollRef + syncPollRef 后 `unmount()` → 用 vi.spyOn(global,'clearInterval') 断言至少两次 clearInterval 调用（避免内存泄漏）。
8. visibilitychange 暂停：初始化中 `document.hidden=true` → 快进 2s → 断言 fetchMyBinding 未被调用（轮询跳过）。

## Acceptance

- AC-05：六状态分支渲染正确（loading skeleton / error 重试 / 未绑定首次引导 / 已绑定未初始化 amber 徽标 / 已绑定已初始化 emerald 徽标 / server-local 隐藏 daemon+cache）。
- AC-06：编辑入口就地展开 → 保存 → onRefresh → 收起。
- AC-07：操作按钮在新卡片内行为与原 page.tsx 等价（initPollRef/syncPollRef 轮询 + 5min 上限 + visibilitychange 暂停 + 409 重扫 + owner 门禁 + 卸载清理）。
- AC-04：cache_root tooltip 文案含三平台 `~` 解释。
- AC-09：新组件测试全绿。

## Verify

```bash
cd frontend && pnpm exec vitest run src/components/workspace-config-card.test.tsx
```

## Constraints

- 用 `vi.hoisted` + `vi.mock` 模拟所有 API 客户端（fetchMyBinding/getSpecWorkspace/upsertMyBinding/initDispatch/syncManual/scanGenerate/listPendingSync/importSpecWorkspace/generateProjects/listDaemonInstances/listComponents），不发起真实请求。
- 六态必须全覆盖：loading skeleton、error 重试、未绑定首次引导、已绑定未初始化 amber、已绑定已初始化 emerald、server-local 隐藏 daemon+cache。
- 编辑流程测：点 config-edit-entry → WorkspaceAccessGuide initial 回填 → onConfigured 触发 onRefresh + 表单收起。
- cache_root tooltip 必须断言含 `~` + Windows `C:\Users\<你>` + macOS/Linux `/home/<你>` 三平台文案。
- 操作按钮：initPollRef/syncPollRef 轮询用 `vi.useFakeTimers` + `vi.advanceTimersByTime(2000)` 驱动；同步 5min 上限 + visibilitychange 暂停分支必测；unmount 后 clearInterval 必被调（卸载清理）。
- 测试文件参考 `page.test.tsx` hoisted mock + fixture 风格；参考 `workspace-access-guide.tsx` 的 onConfigured / initial 契约做 mock 驱动。
- 仅写测试文件，不修改组件实现（task-01~06 产物）；测试以行为契约，断言文本/role/testid 而非实现细节。
