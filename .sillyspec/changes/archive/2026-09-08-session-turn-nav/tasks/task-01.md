---
id: task-01
title: 'TurnRow 锚点与受控高亮——turn-timeline.tsx 两分支根节点加 data-turn-key、highlightTurnKey 派生 per-row 布尔'
title_zh: 'TurnRow 锚点与受控高亮——turn-timeline.tsx 两分支根节点加 data-turn-key、highlightTurnKey 派生 per-row 布尔'
author: 'WhaleFall'
created_at: 2026-09-08 13:44:09
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-007@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
target_files:
  - frontend/src/components/daemon/turn-timeline.tsx
provides:
  - 'data-turn-key DOM 锚点属性（TurnRow 两分支根节点均带，值 = turn.realRunId ?? turn.runId，与刻度轨条目 key 同源，供跳转方 querySelector([data-turn-key]) 精确匹配）'
  - 'highlightTurnKey prop（TurnTimelineProps 新增，类型 string | null，命中行渲染高亮 ring + 浅底，自清节奏由父层受控）'
related_tests:
  - frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
goal: >
  给 turn-timeline.tsx 的 TurnRow fragment 两分支根节点（静默切换轮紧凑行 + 常规轮容器）
  补 data-turn-key DOM 锚点，并为 TurnTimelineProps 新增 highlightTurnKey 受控高亮（在
  TurnTimeline 内先派生 per-row 布尔再进 memo 行）——为后续刻度轨跳转定位提供稳定查询锚点
  与命中高亮反馈，同时避免逐行字符串比较击穿全部行 memo（design §7 / R-07）。
implementation:
  - 'TurnTimelineProps 新增可选 highlightTurnKey?: string | null（缺省 / 为 null = 无高亮，dialog 等旧消费方零回归）。'
  - 'TurnTimeline 渲染 turns.map 时逐行派生 isHighlighted = highlightTurnKey === (turn.realRunId ?? turn.runId)，以布尔 prop 传入 memo 行 TurnRow（字符串比较不进行组件）。'
  - 'TurnRow 两分支根节点（静默切换轮紧凑行 div + 常规轮 space-y-2.5 容器 div）均挂 data-turn-key={turn.realRunId ?? turn.runId}。'
  - 'isHighlighted 命中行根节点追加高亮类（ring + 浅底 + 圆角，主题语义类），未命中行不追加；高亮清除由父层 ~2.2s 自清（本任务只做受控渲染）。'
  - '若 session-panel-variant.test.tsx 既有 className 断言受新增高亮类影响，按最小改动同步（data 属性不影响 className 断言，预期零改动）。'
acceptance:
  - 'TurnRow 两分支根节点渲染后均带 data-turn-key 属性，值 = realRunId ?? runId，可被 querySelector([data-turn-key="…"]) 精确命中。'
  - 'highlightTurnKey 不传 / 为 null 时无任何行带高亮类，既有 TurnTimeline 消费方渲染零回归。'
  - 'highlightTurnKey 命中行带 ring+浅底高亮、其余行无；TurnRow props 只收 per-row 布尔，highlightTurnKey 变化不击穿未涉及行 memo。'
  - 'cd frontend && pnpm exec tsc --noEmit 0 错误；session-panel-variant 既有用例不回归。'
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-panel-variant.test.tsx
constraints:
  - '不改 TurnRow 现有渲染结构 / 分支逻辑 / 其他 props 语义（仅加锚点属性与高亮类），不新增任何数据请求。'
  - '不改 dialog 宿主渲染分支与其他 TurnTimeline 消费方调用点（highlightTurnKey 可选，缺省零回归）。'
  - '高亮必须以 per-row 布尔派生进 memo 行，禁止把 highlightTurnKey 字符串直接传入 TurnRow（R-07 memo 击穿）。'
  - '高亮颜色只用主题语义类（brand-*/background 等），不硬编码色值。'
  - '跳转 / 滚动 / 自动加载链路不在本任务（task-04 承接），本任务只做锚点与受控高亮渲染。'
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
