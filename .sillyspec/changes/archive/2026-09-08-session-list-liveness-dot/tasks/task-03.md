---
id: task-03
title: 'add-session-liveness-frontend-tests'
title_zh: '前端测试——session-list-panel 补用例（含 vi.mock @/lib/agent-logs）+ use-session-liveness 新用例 + tsc/既有零回归'
author: 'qinyi'
created_at: 2026-09-08 00:30:00
priority: P0
depends_on: ['task-01', 'task-02']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  - frontend/src/hooks/__tests__/use-session-liveness.test.ts
target_files:
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  - NEW:frontend/src/hooks/__tests__/use-session-liveness.test.ts
goal: >
  为会话列表活性小灯补齐前端测试——既有 session-list-panel 用例扩充（含 vi.mock @/lib/agent-logs）
  与新建 use-session-liveness 单测，守住转移状态机各边、selected 清除与布局零回归。
implementation:
  - 既有 session-list-panel.test.tsx mock 集补 vi.mock("@/lib/agent-logs")（listWorkspaceAgentLogs 桩）——既有 mock 集没有它，防 jsdom 真实 fetch 噪声
  - 组件用例——有命中渲染小灯与悬停卡四行内容（状态名/静默时长/证据摘要/推导时间）；无命中无灯；红点出现（prevState 为 working 且 current 为 idle）；selected 置真后红点消失；首见不亮；布局断言不新增列
  - 新建 use-session-liveness.test.ts——map 构建 DESC 首个胜出；queryKey 固定 all 槽；转移各边 working 到 idle 亮、blocked 到 idle 亮、unknown 到 idle 不亮、首见不亮；存储异常降级不崩
  - 复用既有 fixture 与 mock 结构，liveness 固件用最小 AgentLogListItem 字段子集构造
acceptance:
  - 两组测试文件全绿且既有 session-list-panel 用例零回归（AC-1/AC-2/AC-3）
  - 转移检测状态机各边与 selected 清除路径均有断言覆盖
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/session-list-panel.test.tsx src/hooks/__tests__/use-session-liveness.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改被测实现迁就测试——测试红说明实现有问题，回 task-01/task-02 文件修而非放宽断言
  - 既有用例零回归是硬验收；测试路径与 allowed_paths 一致
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
