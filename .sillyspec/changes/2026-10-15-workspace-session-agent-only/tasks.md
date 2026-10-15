---
author: flow-machine-draft
created_at: 2026-10-15T07:52:06.615Z
---
# 任务注册表（Tasks）— 2026-10-15-workspace-session-agent-only

- [x] task-01: PreSessionPicker 绑定模式：新增 `boundMachineId` prop 与三个导出纯函数（boundMachineIdFor / pickDefaultRuntimeOnMachine / pickRuntimeByProvider）；先写测试（跳过机器步、绑定机器离线/不可见/无在线智能体空态、不传保持两步、bottomSheet 绑定模式）再实现。验证：`pnpm -C frontend exec vitest run src/components/sessions/__tests__/pre-session-picker.test.tsx` 全绿
- [ ] task-02: 门户 sessions-portal 接线：工作区组「＋」绑定模式浮层、筛选 agent 直带取绑定机器 runtime、?new=1（scope）绑定机器默认解析 + bindings 就绪门；先补 sessions-portal.test.tsx 用例再实现。验证：`pnpm -C frontend exec vitest run src/components/sessions/__tests__/sessions-portal.test.tsx` 全绿
- [ ] task-03: 悬浮宿主 floating-session-host 接线：共享键 `["workspace-switcher-list"]` 取 bindings；工作区组「＋」与工作区页「＋ 新会话」按绑定机器解析/兜底绑定模式浮层；补 floating-session-host.test.tsx 用例。验证：`pnpm -C frontend exec vitest run src/components/floating/floating-session-host.test.tsx` 全绿
- [ ] task-04: 移动端 `/m/workspaces/[id]/sessions` 接线：`fetchMyBinding(workspaceId)` 单条查询（key ["my-workspace-binding", wsId]）+ FAB/空态入口注入 boundMachineId；补 page.m-sessions.test.tsx 用例。验证：`pnpm -C frontend exec vitest run "src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx"` 全绿
- [ ] task-05: 交付验证：四测试文件合跑 + `pnpm -C frontend typecheck` + 改动文件 lint 全绿；grep 确认 `<PreSessionPicker` 三个调用点全部接线无遗漏
