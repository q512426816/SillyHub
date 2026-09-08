---
author: WhaleFall
created_at: 2026-09-08 11:02:33
---

# requirements.md — 2026-09-08-session-turn-nav

## FR-01 常驻轮次刻度轨（桌面）

/sessions 会话面板（真会话态）聊天区左缘新增常驻「轮次刻度轨」：宽约 30px 的垂直细条，每轮渲染一条 2px 细横杠刻度（14px 宽，间距 7px），刻度组在轨内**垂直居中**；刻度超出面板高度时回落顶对齐并在轨内滚动。刻度态：默认中性灰 45% 透明；hover 放宽至 20px 并着品牌色；当前轮刻度常亮（品牌色 20px）；失败=红色、运行中=琥珀脉冲、未加载=空心描边。不设折叠与头部（D-007 取代 v1 折叠面板设计）。

## FR-02 刻度 hover 飞出信息卡（ZCode 式）

鼠标悬停刻度时，从刻度右侧飞出深色反转信息卡（宽约 300px，圆角、投影，随主题 fg/bg 反色）：轮号+用户提问（加粗，2 行钳制）+ 助手正文摘要（3 行钳制，取该轮首个 text 段，截约 120 字）+ meta 行（时间 · 状态 · 发送者）；卡片垂直位置跟随刻度并上下钳制在面板可视范围内。已加载轮次立即可显示摘要；未加载轮次 meta 行显示「未加载 — 点击加载该轮并定位」（D-005），点击加载完成后回填摘要。触屏设备（hover:none）无飞出卡，点击刻度直接跳转。

## FR-03 覆盖全部历史轮次

目录条目覆盖会话全部轮次：已加载窗口内轮次由 `displayTurns` 派生（摘要更准）；更早未加载轮次由 `listSessionRuns`（`GET /sessions/{id}/runs`）补全（元数据：轮号/时间/发送者/状态）。两者按 run id（realRunId）去重合并，按时间正序排列，最新在底部并自动滚到目录底。

## FR-04 点击跳转与定位

点击目录条目：目标轮已加载 → 平滑滚动到该轮（`scrollIntoView block:start`）并短暂高亮（品牌色描边约 2s）；目标轮未加载 → 循环触发历史翻页链（每页 100 条日志）直到目标轮进入窗口（或无更早页即止，单次跳转设页数上限防死循环）→ 定位 + 高亮，同时回填该条目摘要。跳转期间临时抑制"触顶自动加载"判定，跳转完成恢复。

## FR-05 滚动联动（当前轮刻度常亮）

聊天滚动时，"当前视口顶部最近的轮次"对应刻度保持品牌色常亮；刻度超出一屏时（轨内滚动），当前刻度自动滚入轨内可见（scrollIntoView block:nearest，仅轨内滚动不影响聊天）。

## FR-06 多宿主适配

- 桌面 `/sessions`（mode=page variant=desktop）：常驻左栏（FR-01）。
- 移动端 `/m` 会话页：不常驻占位；⋯ 菜单新增「轮次导航」入口，点开为抽屉（左滑出，宽 min(78vw,300px)，带遮罩，选择后自动关闭）。
- 悬浮窗（floating-session-host，实际 desktop variant）：同款刻度轨直接生效（轨仅 ~30px 宽，无需折叠，floating-session-host 零改动，D-007 修订 D-006）。
- dialog 模式（runtimes 弹窗等）：v1 不挂导航 UI（仅 `data-turn-key` 锚点随 TurnRow 全局生效，为后续复用铺路）。

## FR-07 锚点与数据契约（内部）

`TurnRow` 根节点渲染 `data-turn-key={turn.realRunId ?? turn.runId}`；跳转/联动查询走滚动容器内 `querySelector('[data-turn-key="…"]')` 精确匹配（禁止类名匹配，吸取子代理目录教训）。目录组件为受控纯组件（props 进、回调出，不直接操作 DOM）。

## FR-08 原型一致性

实现观感对齐 `prototype-session-turn-nav.html`：间距/字号/圆角/主题 token（brand-*/border/bg-card 取 themes.ts 三主题变量，不硬编码色值）；已知差异点见 design §UI 规格（未加载条目初始摘要展示，D-005）。

## 非功能约束

- 零后端改动（D-004）；runs 数据复用 session-panel-page 既有 `runsMeta` 状态（attach/每轮完成已全量拉刷），不新增独立请求与缓存。
- desktop 宿主的父链 className 断言（session-panel-variant.test.tsx）随布局包裹**有意更新**为新层级；mobile 分支断言保持不回归。
- 高轮次会话（如 100+ 轮）目录滚动不卡顿（普通列表渲染，无虚拟化要求）。
