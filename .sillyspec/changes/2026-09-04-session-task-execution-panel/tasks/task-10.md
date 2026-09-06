---
id: task-10
title: '前端测试——面板三页签/折叠摘要/空态用例 + useSessionTasks 用例 + session-panel 既有测试全绿回归'
title_zh: '前端测试——面板三页签/折叠摘要/空态用例 + useSessionTasks 用例 + session-panel 既有测试全绿回归'
author: 'qinyi'
created_at: 2026-09-05 00:19:30
priority: P0
depends_on: [task-07, task-08]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-07]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/daemon/__tests__/task-execution-panel.test.tsx
  - frontend/src/hooks/__tests__/use-session-tasks.test.ts
goal: >
  为 TaskExecutionPanel 与 useSessionTasks 补齐 vitest 用例（三页签渲染 / 折叠摘要计数 / 空态 /
  hook 快照合并与终态定格），并回归 agent-task-card-lifecycle 与 session-panel 全部既有测试，
  确保新功能可验证、巨石组件接线零回归。
implementation:
  - 新建 task-execution-panel.test.tsx——组织方式对齐 agent-task-card-lifecycle.test.tsx / session-usage-bar.test.tsx 先例（render + data-testid / 文本断言，不依赖 antd 渲染细节；lib/daemon 桩走 vi.mock 先例，mock listSessionRuns / listSessionTasks）
  - 面板用例——①折叠态摘要计数（运行中 N / 任务 M 成功 X 失败 Y / 轮次 K 由注入数据算出）+ 点击展开收起；②三页签切换渲染（任务清单行含状态圆标 / 任务名 / 摘要 / 耗时 / tokens；运行中三类卡 AgentTaskCard / BashProgressCard / TeamTaskBlock 复用渲染；轮次历史紧凑行）；③空态三页签中文文案且不报错（D-003 多引擎降级）；④计划总纲仅活跃轮显示、无计划不渲染（R-07 降级）；⑤runsRefreshSignal 递增触发 listSessionRuns 重拉
  - 新建 use-session-tasks.test.ts（放 hooks/__tests__/，对齐 use-message-queue.test.ts 先例 renderHook + mock lib/daemon）——①mount 拉 listSessionTasks 快照渲染 tasks；②applyEvent 实时合并（首见 running 建条 / 事件缺字段保留旧值 / 终态定格吸收迟到 running 心跳，与后端 upsert 同构语义）；③快照与事件合并（快照终态行遇迟到 running 事件不回退）；④sessionId 切换重拉；⑤快照请求失败静默空列表不抛错（FR-07）
  - 回归点名——agent-task-card-lifecycle.test.tsx（从 session-panel 直接 import applyAgentTaskStatusEvent，task-05 抽出后经 re-export 必须仍绿、零改动）+ session-panel-* 全部既有测试（含 dialog 系列）零改动全绿
  - 若发现既有断言因等值重构失效——仅允许更新 import 路径 / 显式文案类断言并说明原因，禁止弱化断言迁就实现（CLAUDE.md 规则 9）；实现缺陷回改 task-06 / task-07 产物而非改测试
acceptance:
  - 新用例全绿——三页签渲染 / 折叠摘要计数 / 空态文案 / hook 快照合并与终态定格均有明确断言，覆盖 FR-01 / FR-02 / FR-03 / FR-04 / FR-07 可断言行为
  - agent-task-card-lifecycle.test.tsx 零改动全绿（归约 re-export 契约保持）
  - session-panel 全部既有测试零改动全绿（/runtimes 弹窗零回归硬约束）
  - cd frontend && pnpm exec tsc --noEmit 零错误
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/task-execution-panel.test.tsx src/hooks/__tests__/use-session-tasks.test.ts
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel（路径子串匹配 session-panel-* 全部既有测试）
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不跑全量前端测试（CLAUDE.md 规则 0，全量留 CI）——仅跑上述文件级目标
  - session-panel 既有测试零改动是硬验收；新用例只增不改旧
  - 断言行为不断言实现细节（data-testid / 角色 / 文本锚点）；mock 走 vi.mock 先例（use-message-queue.test.ts）
  - 不修改组件 / hook 实现迁就测试——实现缺陷回改上游任务产物
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
