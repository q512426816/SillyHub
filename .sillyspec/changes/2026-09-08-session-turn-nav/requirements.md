---
author: WhaleFall
created_at: 2026-09-08 11:02:33
---

# requirements.md — 2026-09-08-session-turn-nav

## FR-01 常驻轮次导航栏（桌面）

/sessions 会话面板（真会话态）聊天区左侧新增常驻「轮次导航」栏，宽约 232px，含头部（标题 + 轮次计数 + 折叠按钮）与滚动条目列表；折叠后栏宽归 0，聊天区左上浮出「⟩ 轮次」恢复按钮；折叠状态记忆到 localStorage（按用户维度）。

## FR-02 目录条目内容（两段式）

每条条目自上而下：轮号徽标（T1…Tn）+ 时间 + 状态点（绿=完成 / 红=失败 / 琥珀脉冲=运行中）；用户提问一行省略摘要；助手正文两行钳制摘要（取该轮首个 text 段，截约 120 字）。已加载轮次立即显示摘要；未加载轮次 v1 显示元数据 + 「点击加载并定位」标记（D-005），点击加载完成后回填摘要（与已加载条目同观感）。

## FR-03 覆盖全部历史轮次

目录条目覆盖会话全部轮次：已加载窗口内轮次由 `displayTurns` 派生（摘要更准）；更早未加载轮次由 `listSessionRuns`（`GET /sessions/{id}/runs`）补全（元数据：轮号/时间/发送者/状态）。两者按 run id（realRunId）去重合并，按时间正序排列，最新在底部并自动滚到目录底。

## FR-04 点击跳转与定位

点击目录条目：目标轮已加载 → 平滑滚动到该轮（`scrollIntoView block:start`）并短暂高亮（品牌色描边约 2s）；目标轮未加载 → 循环触发历史翻页链（每页 100 条日志）直到目标轮进入窗口（或无更早页即止，单次跳转设页数上限防死循环）→ 定位 + 高亮，同时回填该条目摘要。跳转期间临时抑制"触顶自动加载"判定，跳转完成恢复。

## FR-05 滚动联动（当前轮高亮）

聊天滚动时，目录中"当前视口顶部最近的轮次"条目保持 active 高亮；目录条目多时 active 条目在目录内自动滚入可见（scrollIntoView block:nearest，目录滚动不影响聊天）。

## FR-06 多宿主适配

- 桌面 `/sessions`（mode=page variant=desktop）：常驻左栏（FR-01）。
- 移动端 `/m` 会话页：不常驻占位；⋯ 菜单新增「轮次导航」入口，点开为抽屉（左滑出，宽 min(78vw,300px)，带遮罩，选择后自动关闭）。
- 悬浮窗（floating-session-host，实际 desktop variant）：归常驻左栏分支，经 `catalogDefaultCollapsed` 默认折叠（宽度有限），可手动展开（D-006）。
- dialog 模式（runtimes 弹窗等）：v1 不挂导航 UI（仅 `data-turn-key` 锚点随 TurnRow 全局生效，为后续复用铺路）。

## FR-07 锚点与数据契约（内部）

`TurnRow` 根节点渲染 `data-turn-key={turn.realRunId ?? turn.runId}`；跳转/联动查询走滚动容器内 `querySelector('[data-turn-key="…"]')` 精确匹配（禁止类名匹配，吸取子代理目录教训）。目录组件为受控纯组件（props 进、回调出，不直接操作 DOM）。

## FR-08 原型一致性

实现观感对齐 `prototype-session-turn-nav.html`：间距/字号/圆角/主题 token（brand-*/border/bg-card 取 themes.ts 三主题变量，不硬编码色值）；已知差异点见 design §UI 规格（未加载条目初始摘要展示，D-005）。

## 非功能约束

- 零后端改动（D-004）；runs 数据复用 session-panel-page 既有 `runsMeta` 状态（attach/每轮完成已全量拉刷），不新增独立请求与缓存。
- desktop 宿主的父链 className 断言（session-panel-variant.test.tsx）随布局包裹**有意更新**为新层级；mobile 分支断言保持不回归。
- 高轮次会话（如 100+ 轮）目录滚动不卡顿（普通列表渲染，无虚拟化要求）。
