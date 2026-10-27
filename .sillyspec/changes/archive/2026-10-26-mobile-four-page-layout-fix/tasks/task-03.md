---
id: task-03
title: 'TurnLiveMarquee +mobile prop 信息收窄 + 容器宽度约束修复（FR-01）'
title_zh: 'TurnLiveMarquee +mobile prop 信息收窄 + 容器宽度约束修复（FR-01）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 23:19:47
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-live-marquee.tsx
  - frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx
target_files:
  - frontend/src/components/daemon/turn-live-marquee.tsx
  - frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx
goal: >
  治手机端运行状态胶囊横向溢出（截图②）：TurnLiveMarquee 新增 mobile prop——
  次要信息（token 计数/tok/s 固定段）mobile 收窄或并入跑马灯轨道，主状态文本保证完整；
  顺带核修容器 min-w-0 宽度约束链（desktop 同款溢出隐患的优化性修复，允许）。
implementation:
  - props 加 `mobile?: boolean`（默认 false，缺省 = 既有 desktop 行为零变化）
  - mobile=true：shrink-0 固定信息段（token 计数/tok/s）隐藏或缩为图标+短值，宽度交给跑马灯视口（min-w-0 flex-1）
  - 核修 sh-live-marquee 容器及父级链的 min-w-0/overflow 约束（flex 子项默认 min-width:auto 是溢出根因）
  - 测试：mobile 用例（固定段收起断言）+ desktop 锚用例（缺省 DOM 形态不变断言）
acceptance:
  - mobile=true 渲染无固定段撑宽（容器 max 宽受父级约束断言）
  - mobile 缺省渲染 DOM 与改动前一致（既有用例零改动通过 + 新锚用例）
  - 既有 turn-live-marquee 套件全绿
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/turn-live-marquee.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改跑马灯动画机制与滚动节奏
  - 透传链（turn-timeline/turn-segment-views 挂载点）归 task-05，本卡只做组件本体
  - proto 页面（app/proto/session-live-marquee）不传 prop 走缺省，不改
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
