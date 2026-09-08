---
id: task-05
title: 'desktop 布局挂载+滚动联动——sessionBody 包 flex 行挂 TickRail、activeTurnKey 联动、variant 测试 desktop 父链断言有意更新'
title_zh: 'desktop 布局挂载+滚动联动——sessionBody 包 flex 行挂 TickRail、activeTurnKey 联动、variant 测试 desktop 父链断言有意更新'
author: 'WhaleFall'
created_at: 2026-09-08 13:44:09
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-01, FR-05, FR-06]
decision_ids: [D-001@v1, D-006@v1, D-007@v1]
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
provides:
  - desktop 常驻 TickRail 挂载完成——TickRail 已在 page 模式面板渲染（entries/activeTurnKey/onJump 接线齐备，mobile Drawer 复用同组件与回调）
expects_from:
  - task-04 的 handleJumpToTurn(entry) 回调 + activeTurnKey state
  - task-02 的 TurnCatalog 组件（frontend/src/components/sessions/turn-catalog.tsx）
  - task-03 的 catalogEntries（runsMeta × displayTurns 合并派生）
related_tests:
  - frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
goal: >
  desktop 会话主体外包 flex 行挂载 TickRail 常驻刻度轨（左轨 ~30px + 右聊天列 flex-1），接通 activeTurnKey 刻度联动与 onJump 跳转，并把 variant 测试 desktop 父链断言有意更新为新层级（AC-01/AC-05）。
implementation:
  - desktop（mode=page 非 mobile）sessionBody 外包 `flex min-h-0` 行：左侧挂 TurnCatalog（TickRail 形态，entries=catalogEntries、activeTurnKey、loadingEarlier=historyLoading、onJump=handleJumpToTurn），右侧聊天列 `flex-1 min-w-0`（renderHistoryAndLocalReport + TurnTimeline 原样迁入，min-h-0 保持纵向滚动高度链不破坏）。
  - mobile 分支本卡不改 DOM（Drawer 入口属 task-06）；TickRail 挂载点仅在 page 模式渲染分支内，dialog 模式自然不挂载（FR-06）。
  - 'activeTurnKey 传入 TickRail 驱动刻度 active 常亮与 active 变化时轨内 scrollIntoView({ block: "nearest" })（组件内能力，本卡只接线）；historyLoading 传 loadingEarlier 供加载态标识。'
  - 悬浮窗 floating-session-host 零改动：host 不传 variant → 默认 desktop（D-006），自动复用常驻刻度轨（D-007 后 ~30px 轨无需折叠）。
  - 有意更新 session-panel-variant.test.tsx desktop 父链断言（现行 281-286）：bodyWrap("contents") 父级由 panel 变为新 flex 行（层级 +1），断言改为「relative 层字面量不变 + contents 挂载点 + contents.parentElement=flex 行 + flex 行.parentElement=panel」；mobile 分支断言（321-324）原样保留。
acceptance:
  - desktop 真会话聊天区左缘出现 ~30px TickRail：每轮一条 2px 刻度、刻度组垂直居中，聊天列 flex-1 占满剩余宽度（AC-01）。
  - 聊天滚动时当前视口顶部最近轮对应刻度常亮（activeTurnKey 联动，AC-05）；点击刻度触发 handleJumpToTurn 定位。
  - session-panel-variant.test.tsx desktop 用例按新父链层级更新后通过（层级 +1 flex 行）；mobile 分支用例原样通过不回归。
  - 悬浮窗宿主（不传 variant）经既有 desktop 回归锚用例覆盖不回归；tsc --noEmit 0 错误。
verify:
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-panel-variant.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 无折叠、无 localStorage 记忆、不设头部/计数（D-007 取消 v1 折叠面板形态）。
  - desktop 父链断言为「有意更新」而非删除断言：按新层级逐层断言；mobile 分支断言（321-324）必须原样不回归。
  - 不动 floating-session-host / sessions-portal / session-list-panel / dialog 宿主渲染分支（零改动复用）。
  - mobile 不常驻轨、不改变 mobile DOM 结构（Drawer 入口属 task-06）。
  - 样式取值走主题语义类（brand-*/destructive/warning/muted-foreground 等），不硬编码色值（FR-08）。
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
