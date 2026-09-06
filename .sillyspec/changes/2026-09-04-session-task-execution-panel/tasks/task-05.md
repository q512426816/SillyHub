---
id: task-05
title: '前端归约抽出——applyAgentTaskStatusEvent 从 session-panel.tsx 抽出共享模块（等值重构，ActivityCatalog 行为不变）'
title_zh: '前端归约抽出——applyAgentTaskStatusEvent 从 session-panel.tsx 抽出共享模块（等值重构，ActivityCatalog 行为不变）'
author: 'qinyi'
created_at: 2026-09-05 00:19:30
priority: P0
depends_on: []
blocks: [task-07, task-08]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/agent-task-store.ts
goal: >
  把 applyAgentTaskStatusEvent（session-panel.tsx L6527 起，含终态定格与 message/progress 消费 L6542-6543）等值抽出到新共享模块 agent-task-store.ts，session-panel 保留 re-export 防既有引用断链，为 task-06/07/08 提供统一归约入口；纯等值重构，ActivityCatalog 行为零变化（FR-02 / R-01 回归红线）。
implementation:
  - 新建 frontend/src/components/daemon/agent-task-store.ts：把 session-panel.tsx 约 L6519-6573 的「后台 Agent 任务状态归约」区块（含函数上方中文 JSDoc——终态定格 / 缺字段保旧值 / 最近 6 条截断语义）整段搬入；函数名 applyAgentTaskStatusEvent、参数与返回类型、归约逻辑与注释逐字不变
  - agent-task-store.ts 顶部 import：type AgentTaskEntry 取自 @/components/daemon/activity-catalog（类型定义留原处 activity-catalog.tsx L38，本卡不动该文件）；type AgentTaskStatusEvent 取自 @/lib/daemon（daemon.ts L1337 既有接口）
  - session-panel.tsx 删除原函数定义体，改 import 自 ./agent-task-store，并补一行 export-from 形式的 re-export——agent-task-card-lifecycle.test.tsx L35 直接从 @/components/daemon/session-panel import 该函数，必须保链不破坏既有引用
  - 自查 page / dialog 两模式既有消费点（约 L1351 / L4536 的 agentTasks state 与 L1837 / L4903 的 SSE 分发调用）仅 import 来源变化，无任何行为改动
acceptance:
  - frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx 一行不改仍全绿（re-export 生效 + 等值重构的直接证据）
  - agent-task-store.ts 内函数与原实现逐字等值：不改名、不改签名、不动终态定格 / 缺字段保旧值 / 最近 6 条截断逻辑、不丢注释
  - session-panel.tsx 不再含函数定义体，仅 re-export + 内部引用；page / dialog 两模式后台任务卡行为不变
  - cd frontend && pnpm exec tsc --noEmit 通过
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx
constraints:
  - 等值重构零语义变化：只做搬移 + import 替换 + re-export，不顺手改归约行为、不重命名、不「顺手优化」
  - 不改 activity-catalog.tsx（AgentTaskEntry 定义留原处）与 agent-task-card.tsx；不改既有测试一行（CLAUDE.md 规则 9）；不新增测试（hook 与面板用例归 task-10）
  - 本卡不接 SSE、不做 UI（挂载接线归 task-08，组件归 task-07）
  - Windows 兼容；pnpm 命令一律在 frontend/ 目录下执行
provides:
  - contract: applyAgentTaskStatusEvent
    fields: [applyAgentTaskStatusEvent, AgentTaskEntry]
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
