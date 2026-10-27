---
id: task-05
title: 'TurnTimeline / TurnSegmentViews 新增 variant prop 透传链（FR-01/02 链路）'
title_zh: 'TurnTimeline / TurnSegmentViews 新增 variant prop 透传链（FR-01/02 链路）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 23:19:47
priority: P0
depends_on: [task-03, task-04]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx
target_files:
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
goal: >
  打通 mobile 感知链（独立评审 gap 修正：TurnTimeline:1529 / TurnSegmentViews 主组件
  均无 variant 入口）：两级新增 `variant?: "desktop" | "mobile"` prop（默认 desktop），
  自 session-panel-page.tsx 判定点（符号 `const mobile = variant === "mobile"`）透传，
  组件内下传 TurnLiveMarquee（挂载点符号定位）/ RoundDivider。
implementation:
  - TurnTimelineProps / TurnSegmentViews props 加 variant 字段（默认 "desktop"），透传链 R-02（P1）
  - session-panel-page.tsx：mobile 分支的两处 TurnTimeline 挂载点传 variant="mobile"（desktop/dialog/悬浮宿主挂载点不动）
  - turn-timeline.tsx / turn-segment-views.tsx：内部向 TurnLiveMarquee 与 RoundDivider 挂载点下传 mobile={variant === "mobile"}
  - 端到端用例（session-panel-variant.test.tsx）：SessionPanel variant="mobile" → marquee mobile 分支标记真实生效；variant="desktop" / dialog 宿主 → 形态不变（悬浮宿主间接断言，盲区②）
acceptance:
  - variant="mobile" 端到端：marquee 固定段收起断言真实命中（非仅 prop 传递）
  - 既有 session-panel-variant / turn-segment-views 套件零回归
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-panel-variant.test.tsx src/components/daemon/__tests__/turn-segment-views.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - session-panel-page.tsx 只在挂载点加 prop 实参（一处一行为限），不重构不挪代码
  - dialog / floating-session-host 挂载点不传 variant（走缺省 desktop，零变化）
  - 行号一律符号定位（并行会话可能已使 design 行号漂移）
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
