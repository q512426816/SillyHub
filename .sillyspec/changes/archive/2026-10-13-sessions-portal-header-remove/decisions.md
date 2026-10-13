---
author: flow-machine-draft
created_at: 2026-10-13T09:18:36.073Z
---
# 决策记录（Decisions）— 2026-10-13-sessions-portal-header-remove

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 风险①：后续有人把 sr-only 改成 `hidden`/`display:none` 之类，标题会从可访问性树消失（等于删标题）——单测以 `toHaveClass("sr-only")` 锁形态。 - 风险②：高度链回归（有人给分栏行去 `flex-1`、或给标题块加回可见占位）——`sessions-portal-panes` 类名契约（flex-1 + min-h-0）与容器 `h-[calc(100vh-64px)]` 断言兜住。 - 风险③：workspace scope 顶部仍留一行 ≈26px 的紧凑 Git 条（保留功能件的代价，非回归）；用户若要求该 scope 也彻底全屏，属新诉求（可后续把 Git 条移入左栏头或折叠）。 - 放弃的方案：a) 整块删 PageHeader 且不留标题——丢无障碍一级标题 + 四处 scope 标题断言（回归面缩小）；b) Git 状态条一并删——未经要求的功能回归；c) Git 条塞进左栏面板头——左栏自有 📁/筛选控件，语义错位、改动面扩大；d) 用 `hidden` 隐藏标题——可访问性树同步丢失，即 a 的变体。 - 存量债风险：`page.test.tsx` 的 emoji token 断言修正属「测试跟随已交付实现」而非「改测试掩盖实现错误」——实现侧 token 形态由 2026-10-12-ws-ref-emoji-inline 交付且另有专门用例覆盖。
