---
id: task-04
title: 'frontend 状态条展示（PHASE_LABEL+超时警示+退位+零回归+测试）'
title_zh: 'frontend 状态条展示（PHASE_LABEL+超时警示+退位+零回归+测试）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 03:49:35
priority: P0
depends_on: ['task-01']
blocks: [task-03, task-05]
requirement_ids: [FR-04, FR-05]
decision_ids: [D-001@v1, D-003@v1, D-007@v1, D-008@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-status-bar.tsx
  - frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx
target_files:
  - frontend/src/components/daemon/turn-status-bar.tsx
  - NEW:frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx
expects_from:
  task-01:
    - sse 载荷契约
  task-03:
    - currentPhase 类型
goal: >
  状态条阶段文案展示：PHASE_LABEL 词表映射替代笼统「排队中/执行中」+ 30s 超时警示 +
  first_event 退位——纯展示层，无 phase 分支与现状零回归。
provides:
  - currentPhase prop 契约: "TurnStatusBarProps 加可选 currentPhase: { phase: string; at: number } | null（与 task-03 TurnPhaseState 同构）"
implementation:
  - frontend/src/components/daemon/turn-status-bar.tsx：Props 加可选 currentPhase；模块级导出 PHASE_LABEL 词表（9 值中文文案，与 design 词表逐字一致）与 PHASE_TIMEOUT_MS = 30_000 常量（D-007）
  - 渲染逻辑（判定顺序=design 组合推演）：先判 currentPhase 存在性 → first_event 退位（phase==="first_event" 时标签位回退 STATUS_LABEL[turnStatus]，活动摘要接管）→ 超时警示（now - at ≥ 30s 整条切 border-warning/40 bg-warning/10 + text-warning，标签后追加「已等待 N 秒」）→ 正常阶段显示 PHASE_LABEL[phase] ?? phase（未知值显示原始字符串兜底）
  - 超时判定复用组件既有每秒 tick（now state），不新增定时器；currentPhase 为 null/undefined 走现状分支（STATUS_LABEL + 既有活动摘要，渲染路径零改动）
  - 新增 frontend/src/components/daemon/__tests__/turn-status-bar-phase.test.tsx：①九词表文案映射断言②超时切换（fake timers 推进 31s 后警示样式+已等待秒数）③30s 内不警示④first_event 退位（标签回退、摘要接管）⑤无 currentPhase 渲染与现状一致（零回归锚定）⑥未知 phase 显示原始字符串
  - 对齐原型 prototype-session-stage-progress.html（.sillyspec/changes/2026-10-26-session-stage-progress/）批准稿形态——文案/警示样式/「已等待 N 秒」格式逐字对照
acceptance:
  - PHASE_LABEL 九值文案与 design 阶段词表逐字一致（导出常量供测试锚定）
  - 阶段停留 ≥30s 切警示样式并显示「已等待 N 秒」；<30s 不警示；first_event 后不再警示（退位）
  - 无 currentPhase 时渲染输出与改动前一致（快照/关键字断言双保险——零回归）
  - 警示样式仅用 warning token 类（border-warning/40 / bg-warning/10 / text-warning），零硬编码色
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/turn-status-bar-phase.test.tsx src/components/daemon/__tests__/turn-time-display.test.tsx（输出落盘只看尾部；含既有相邻用例防回归）
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint（聚焦文件）
constraints:
  - 组件保持 React.memo；每秒 tick 不外溢（既有 FR-06 渲染经济约束不变）
  - 不改 deriveTurnActivity 派生链（D-008：轮内文案由既有事件映射，本任务只加标签位与警示）
  - fake timers 下 waitFor 不推进——用 advanceTimersByTimeAsync(0) 排干微任务（testing-gotchas 既有坑）
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
