---
author: qinyi
created_at: 2026-06-30T10:20:00
task_id: task-15
status: implemented
---
# task-15: task-14 前端单测

## 目标
覆盖 task-14：scanGenerate spec_strategy 透传 + daemon-client 三策略显示扫描按钮 + 点击调用 + 与 bootstrap 互斥。

## 具体做什么

### 1. `frontend/src/lib/__tests__/workspaces.test.ts`（或 lib/workspaces.test.ts co-locate）scanGenerate 透传测
- `vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }))`。
- 调 `scanGenerate("C:/x", null, null, "daemon-client", "rid-1", "repo-native")`。
- 断言 apiFetch 以 `/api/workspaces/scan-generate` + method POST + json body `{root_path:"C:/x", path_source:"daemon-client", daemon_runtime_id:"rid-1", spec_strategy:"repo-native"}` 调用。
- 不传 specStrategy 时断言 body 不含 spec_strategy（仅 root_path/path_source/daemon_runtime_id）。

### 2. `frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx` 按钮渲染/调用/互斥测
- mock apiFetch：getWorkspace 返回 daemon-client workspace（`{path_source:"daemon-client", daemon_runtime_id:"rid-1", default_agent:null, default_model:null, root_path:"C:/x", ...}`）；getSpecWorkspace 返回各 strategy；listComponents/listChanges/listAgentRuns/getRuntimeProgress 返回空/兜底。
- `vi.mock("@/components/agent-run-panel", () => ({ AgentRunPanel: () => <div data-testid="arp-mock"/> }))`（避免 SSE 复杂性，测父组件按钮/handler 逻辑）。
- **三策略渲染**：分别 mock getSpecWorkspace 返回 strategy=platform-managed/repo-mirrored/repo-native，渲染断言「扫描」按钮均显示（getByText/role）。
- **platform-managed 共存**：断言「初始化」+「扫描」都显示。
- **点击扫描**：fireEvent.click 扫描按钮 → 等待断言 apiFetch 被以 scan-generate + daemon-client body 调用。
- **互斥**：设 activeScanRunId（mock 一个进行中 scan run via listAgentRuns 返回 running run，或点击扫描后）→ 断言「初始化」按钮 disabled。
- **注意 markdown-text jsdom null**（记忆 frontend-markdown-text-jsdom-null）：详情页本身不用 markdown-text，但若 AgentRunPanel mock 后仍报错，vi.mock 相关组件。

## 边界处理
- daemon-client workspace mock：path_source='daemon-client' + daemon_runtime_id 非空（isDaemonClientWorkspace 判定）。
- AgentRunPanel mock 为简单 div（测按钮/handler，不测 SSE）。
- apiFetch mock 多端点（按 url 路由返回不同 fixture）。

## 参考
- CONVENTIONS 测试章节：vitest+jsdom+testing-library，co-locate（`__tests__/` 或 `.test.tsx` 并置），mock apiFetch（手动构造 fetch/Response 或 vi.mock "@/lib/api"）。
- 现有测试模式：`lib/daemon.test.ts`、`agent-run-panel.test.tsx`、`app/(dashboard)/runtimes/page.test.tsx`（页面级参考）。
- 记忆 frontend-markdown-text-jsdom-null：dynamic ssr:false 组件 jsdom 渲染 null，需 vi.mock。

## TDD 步骤
1. 写 scanGenerate 透传测 → `cd frontend && pnpm test` 失败。
2. 写 page 按钮测 → 失败。
3. （task-14 实现 lib/workspaces.ts + page.tsx）
4. `cd frontend && pnpm test` 通过。
5. `cd frontend && npx tsc --noEmit` 通过。

## 验收标准
- [x] scanGenerate 传 specStrategy 时 body 含 spec_strategy；不传时不含
- [x] daemon-client 三策略（platform-managed/repo-mirrored/repo-native）详情页显示扫描按钮
- [x] platform-managed 显示初始化+扫描两按钮
- [x] 点击扫描触发 scan-generate 调用（正确 body）
- [x] scan 运行时初始化按钮 disabled（互斥）
- [x] `cd frontend && pnpm test` 通过

## 覆盖
FR-14, D-006@v1。参考 design §5.5。
