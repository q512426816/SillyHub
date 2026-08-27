---
id: task-14
title: 'session-panel-variant-mobile'
title_zh: 'SessionPanel variant 适配（通读渲染层耦合清单 → mobile 布局类/次要 chrome 收纳，逻辑零分叉）+「不传 variant 与 desktop 一致」回归测试（FR-07/FR-11；R-01）'
author: 'qinyi'
created_at: 2026-08-27 00:34:52
priority: P0
depends_on: []
blocks: ['task-15']
requirement_ids: [FR-07, FR-11]
decision_ids: [D-001@V1, D-003@V1]
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-team.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-ux-fixes.test.tsx
related_tests:
  - frontend/src/components/daemon/__tests__/session-panel-team.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx
  - frontend/src/components/daemon/__tests__/session-panel-ux-fixes.test.tsx
provides:
  - contract: 'SessionPanel variant=mobile'
    fields: ['variant?: "desktop" | "mobile"（默认 desktop，仅渲染层）', mode, sessionId, machines, llmProviders, onSessionListRefresh]
goal: >
  SessionPanel 加 variant?: "desktop"|"mobile"（默认 desktop），mobile 仅调渲染层布局类
  与次要 chrome 收纳、内核逻辑零分叉，并附「不传 variant 与 desktop 一致」回归测试（R-01）。
implementation:
  - 首步（R-01）：通读 session-panel.tsx 渲染层产出耦合清单（记入执行记录，供 verify 对账）：page 分支头部 chrome（:2335-2426 机器/工作区徽标、ActivityCatalog、SubagentCatalog、视图切换、打断按钮）、面板根容器类（:2330）、输入条、TurnTimeline 横向内容——逐点位标注「className 可调 / 可收纳 / 动不了」
  - 'SessionPanelProps（:187）加 variant?: "desktop" | "mobile"（默认 "desktop"）；分发函数（:280）透传给 SessionPanelPage；dialog 分支不消费 variant（保持现状渲染，零分叉）'
  - mobile 分支仅做：面板根/头部容器布局类（满宽、padding、圆角）、头部次要 chrome 收纳（机器/工作区徽标等低频信息进 ⋯ 菜单或折叠，主操作保留）、输入条贴底（100dvh 键盘避让）、TurnTimeline 内表格/代码块横向滚动容器；SSE 建流（streamSession）/断线 resync/消息队列/中断/结束/装配器逻辑零改动——variant 只出现在渲染层 className 与次要 UI 显隐
  - 新增 __tests__/session-panel-variant.test.tsx：①不传 variant 时关键容器/头部类与改前一致（回归锚）；②variant="mobile" 时收纳生效且发消息/打断/视图切换仍可用
  - 末步（R-01 降级判断）：若耦合清单显示需动逻辑才能适配，降级为「mobile 壳组件包 SessionPanel + CSS 覆盖、逻辑零触碰」方案，结论写进执行记录并同步本卡 constraints 与 task-15
acceptance:
  - 不传 variant（sessions 页/悬浮宿主等既有调用点）渲染与改前一致，既有 session-panel 相关测试全绿
  - variant="mobile" 时布局类生效（满宽/输入条贴底）、次要 chrome 收纳，核心操作（发消息/SSE 流式/打断/结束/视图切换）行为不变
  - 耦合清单（R-01 首步）与降级判断结论（末步）已产出并记录；variant 不出现在任何数据/effect/回调逻辑分支（仅渲染层，可验证）
verify:
  - cd frontend && pnpm test -- src/components/daemon/__tests__/session-panel-variant.test.tsx
  - cd frontend && pnpm test -- src/components/daemon/__tests__/session-panel-team.test.tsx src/components/daemon/__tests__/session-panel-pre-session.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - variant 默认值保持桌面行为，既有调用点零改动（FR-11 桌面零回归）；dialog 渲染路径不为 variant 分叉
  - 只动渲染层（className/次要 UI 显隐）；SSE/队列/中断/结束/装配器逻辑零触碰（design §5.4 逻辑零分叉）
  - mode/variant 双维度保持正交（mode=宿主形态、variant=视口样式，§5.5 防漂移锚点）；4522 行文件禁止顺手重构无关段落，保持既有注释锚
  - 降级路径（R-01）：耦合过深则改「mobile 壳组件包 SessionPanel + CSS 覆盖」方案，session-panel.tsx 仅留最小透传，结论记录进本卡
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
