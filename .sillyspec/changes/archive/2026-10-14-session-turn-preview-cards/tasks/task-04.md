---
id: task-04
title: '预取行为测试与既有面回归'
title_zh: '预取行为测试与既有面回归'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-14 10:18:30
priority: P1
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-02, FR-03, FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx
  - NEW:frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx
target_files:
  - NEW:frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx
  - NEW:frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx
related_tests:
  - frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx
  - frontend/src/components/sessions/__tests__/turn-catalog.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
goal: >
  补齐预取与降级行为测试面（FR-03 三重判重 / FR-04 降级），并复跑本改动波及的既有测试文件
  确认零回归（规则 0：只跑相关面，不跑全量）。
  【verify 期对账注】预取/降级测试实际落点为 session-preview-integration.test.tsx
  （整页 harness——预取回调在 session-panel-page 装配层，TurnTimeline 组件级测试
  触达不了；execute 期新增文件未回写本卡，现补录）。
implementation:
  - turn-preview-card.test.tsx 追加 describe('附近预取')：跳转直达成功后触发前后轮拉取 / 在飞去重（pending 期间重复跳转不重复发请求）/ 已加载轮跳过 / 零正文轮幂等 / 失败静默不弹错
  - 追加 describe('大纲缺失降级')：outline null 时消息流仅已加载轮、无预览卡、无报错
  - 复跑既有面：turn-nav-list / turn-catalog / session-panel-pre-session / session-history-scroll / sessions page.test（mock 补 turn-outline 端点时按惯例顺手补字段修好，不躲报错）
acceptance:
  - 预取 describe 五用例绿；降级用例绿
  - 既有相关测试文件复跑全绿；pnpm exec tsc --noEmit 零错误
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/turn-preview-card.test.tsx src/components/sessions/__tests__/turn-nav-list.test.tsx src/components/sessions/__tests__/turn-catalog.test.tsx src/components/daemon/__tests__/session-panel-pre-session.test.tsx src/components/daemon/__tests__/session-history-scroll.test.tsx
constraints:
  - 仅测试文件改动（生产代码回归问题回 task-03 修，不在本卡内改生产代码）
  - 不跑全量测试（规则 0，全量留给 CI）
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
