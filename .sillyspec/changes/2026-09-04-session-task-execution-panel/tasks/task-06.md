---
id: task-06
title: '前端数据层——useSessionTasks hook（mount/重连拉快照 + applyEvent 合并）+ listSessionTasks API 函数'
title_zh: '前端数据层——useSessionTasks hook（mount/重连拉快照 + applyEvent 合并）+ listSessionTasks API 函数'
author: 'qinyi'
created_at: 2026-09-05 00:19:30
priority: P0
depends_on: [task-02, task-09]
blocks: [task-07]
requirement_ids: [FR-02, FR-07]
decision_ids: [D-001@v1, D-003@v1, D-006@v1]
provides:
  - contract: useSessionTasks
    fields: [tasks, applyEvent, loading]
allowed_paths:
  - frontend/src/hooks/use-session-tasks.ts
  - frontend/src/lib/daemon.ts
goal: >
  新建 useSessionTasks hook（mount / 重连拉快照 + applyEvent 实时合并，FR-02/FR-07）与 daemon.ts 的 listSessionTasks 函数，为 task-07 面板「任务清单」页签提供持久化 + 实时合一的数据源；SSE 事件仍走既有 fetch-sse 会话流、由 session-panel 分发处调 applyEvent，不新建第二条连接。
implementation:
  - daemon.ts 在 listSessionRuns（L3785）旁新增 listSessionTasks(sessionId, opts)：apiFetch GET /api/daemon/sessions/{id}/tasks、opts.signal 透传（对齐 listSessionRuns 的 F7 惯例）；返回类型经 type 别名引用 api-types 生成的 components.schemas.AgentSessionTaskRead（写法对齐 SharedAgentView 先例 daemon.ts L291，禁手写 interface）
  - 新建 frontend/src/hooks/use-session-tasks.ts：签名对齐 design 接口定义——useSessionTasks(sessionId, opts?) 返回 { tasks, applyEvent, loading }；命名导出与文件头中文注释惯例对齐 use-message-queue.ts（纯 useState/useEffect 实现，不用 react-query——dialog 模式无 QueryClientProvider 先例）
  - 快照链路：mount / sessionId 变化时调 listSessionTasks 拉快照，AgentSessionTaskRead 行映射为视图行 AgentSessionTaskView（终态行定格显示）；空快照（FR-07 引擎不上报任务）tasks 为空数组、不报错；网络 / 5xx 真实失败 toast、已知竞态静默，口径对齐 use-message-queue ql-20260903-014
  - 实时链路：暴露 applyEvent(e)，内部按 task_id upsert 合并进 tasks，归约语义复用 task-05 抽出的 applyAgentTaskStatusEvent（终态定格、缺字段保旧值）；SSE 接线由 task-08 在 session-panel 分发处完成，本卡只提供入口不建 SSE 连接
  - 重连链路：调用方经 opts 通道（onReconnect）在 SSE 重连恢复后触发快照重拉，保证刷新 / 切会话再回来清单可恢复（FR-02 集成验收前提）
acceptance:
  - listSessionTasks 与 listSessionRuns 同形态（apiFetch 封装、opts.signal 透传、命名先例一致），返回类型来自 task-09 生成的 api-types
  - useSessionTasks 暴露 { tasks, applyEvent, loading }，签名对齐 design 接口定义；mount 拉快照、applyEvent 按 task_id upsert 且终态定格不回退
  - 空快照会话（FR-07）hook 不抛错，loading 正常收敛，tasks 为空数组
  - cd frontend && pnpm exec tsc --noEmit 与 cd frontend && pnpm lint 均通过；hook 可被组件直接 import 消费（task-07/08 无需适配层）
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
constraints:
  - 禁止 EventSource、不新建 SSE 连接：遵守 fetch-sse 既有约定，事件由 session-panel 分发处调 applyEvent（接线归 task-08）
  - 禁手写 AgentSessionTaskRead 或重复定义 api-types 已有类型（CLAUDE.md 规则 21）；W3 内必须等 task-09 产物先落地
  - 不用 react-query；不做 UI 渲染（组件层归 task-07）；本卡不写测试（hook 用例归 task-10）
  - Windows 兼容；pnpm 命令一律在 frontend/ 目录下执行
expects_from:
  task-02:
    - contract: AgentSessionTaskRead
      needs: [task_id, task_name, status, summary, message, started_at, finished_at, elapsed_ms, total_tokens, tool_uses]
  task-09:
    - contract: api-types
      needs: [AgentSessionTaskRead]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
