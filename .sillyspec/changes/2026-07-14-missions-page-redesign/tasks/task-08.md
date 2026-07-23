---
id: task-08
title: "历史条目 truncate + title hover 全文"
title_zh: 历史条目单行省略（不撑爆布局）
author: qinyi
created_at: 2026-07-14 10:34:25
priority: P2
depends_on: []
blocks: []
requirement_ids: [FR-11]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/components/mission-console.tsx
goal: >
  历史列表每条 objective 长描述用 CSS 单行省略（truncate）+ title 属性 hover 显示全文，
  避免长文本（含 Windows 绝对路径）一行撑爆布局或换行成多行难读。
implementation:
  - 定位历史列表条目：mission-console.tsx:708-735（`{history.map((m) => ...)}` 内每条 button 里的 objective span）。
  - 当前 :726-728 已有 `<span className="flex-1 truncate text-gray-800">{m.objective || "(无目标)"}</span>`，但父容器 flex 布局下 truncate 生效需确保宽度约束（min-w-0）。
  - 给 objective span 的父 button 或该 span 加 `min-w-0`（flex 子项默认 min-width:auto 会撑爆，加 min-w-0 让 truncate 生效）。
  - 加 title 属性：`title={m.objective || "(无目标)"}`，hover 显示完整文本（含绝对路径也能看全）。
  - 核对右侧时间+人数 span（:729-732）保持 `whitespace-nowrap`，不被挤压换行。
  - objective 为空时 title 显「(无目标)」，span 文案同。
  - 不改历史列表的其他结构（状态 Badge / 点击切换 / 选中态 ring）。
acceptance:
  - 历史列表每条 objective 单行显示，超长部分 CSS 省略号（…），不换行成多行。
  - 鼠标 hover objective span 弹出原生 title tooltip 显示完整文本。
  - 含 Windows 绝对路径的长 objective 不撑爆容器宽度（父容器宽度固定，右侧时间/人数不被挤出可视区）。
  - objective 为空时显「(无目标)」，hover 同样显「(无目标)」。
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 后端零改动：只改历史列表条目渲染样式。
  - 文案默认中文（「(无目标)」已是中文兜底）。
  - 用 Tailwind 的 truncate（= overflow-hidden text-ellipsis whitespace-nowrap）+ min-w-0，不引入 CSS-in-JS 或新依赖。
  - title 属性为原生 HTML 行为，无 JS 开销。
  - 不改历史列表的折叠/展开（task-03 负责）或选中态逻辑。
---

# task-08: 历史条目 truncate + title hover 全文

历史下拉列表（mission-console.tsx:703-738，task-03 会把它收进顶部下拉按钮）每条 objective 一行塞状态+整段描述（常含 `C:\Users\...` 绝对路径）+时间+人数，当前虽已有 `truncate` class（:726）但 flex 布局下 min-width 默认 auto 会撑爆，实际不省略。本任务补 `min-w-0` + `title` 属性，确保单行省略且 hover 看全文。

## 关键代码位置

- 历史条目：mission-console.tsx:710-734（`{history.map((m) => <li><button>...</button></li>)}`）。
- objective span：:726-728 `<span className="flex-1 truncate text-gray-800">{m.objective || "(无目标)"}</span>`。
- 修复点：该 span 或父 button 加 `min-w-0`；该 span 加 `title={m.objective || "(无目标)"}`。

## 非目标

- 不改历史列表折叠成下拉按钮（task-03 负责 D-007 收起）。
- 不改历史条目的状态徽标中文化（task-09 负责 STATUS_LABEL）。
- 不改详情态 WorkerRow 的 objective 折叠（task-07 负责）。
- 不加自定义 Tooltip 组件（原生 title 足够，YAGNI）。
