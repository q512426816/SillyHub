---
author: flow-machine-draft
created_at: 2026-10-23T06:45:37.494Z
---
# 需求规格（Requirements）— 2026-10-23-session-first-load-ux

## 功能需求

### FR-01: 历史加载在飞期间，时间线区域显示轮次骨架屏（动态加载指示），不再显示静态空态文案或空白

- 会话详情已返回而轮次内容尚未到达（历史拉取在飞、时间线 turns 为空）时，必须以轮次卡片形状的骨架屏（带加载动画）占位时间线主体区域，禁止在该状态下渲染静态空态文案（「XX 已就绪」/「没有在线守护进程」）或纯空白。

#### 场景：进入大会话，历史在拉

- Given 某会话有大量轮次与日志（进入需多请求串行拉取）
- When 用户点开会话、会话详情已返回但首屏历史日志仍在拉取
- Then 时间线区域显示轮次骨架屏（动画占位），无静态空文案

#### 场景：大纲先到（预览卡先渲染）

- Given 轮次大纲（turn-outline）先于完整历史返回
- When 大纲合成的预览卡已进入时间线（turns 非空）
- Then 骨架屏退场（已有内容可看），不得与预览卡叠放

### FR-02: 首屏轮次内容在底窗日志（400行）到达后立即渲染，不等 buildInitialWindow 补拉链完成；补拉结果到达后增量合并进时间线，翻页游标与「加载更早」语义不回退

- 底窗日志（HISTORY_PAGE_SIZE 行）到达后必须立即装配并渲染最近轮次（不等 probe/锚点轮直达/并行补拉链）；补拉链完成后必须把新增行增量合并进时间线（prepend 语义，已渲染内容不回退、SSE 实时增量不丢失）；补拉在飞期间必须挂起「加载更早」翻页（复用既有同步锁），补拉完成后翻页游标按窗口结果推进，禁止游标越过未合并的缺口。

#### 场景：大会话进入，底窗先见

- Given 会话轮次多、首屏补拉链需 2 个以上串行往返
- When 底窗 400 行日志返回
- Then 最近轮次立即渲染（可见时间 ≈ 底窗单请求耗时）；补拉结果稍后从顶部合并，阅读位置不跳变

#### 场景：补拉与 SSE 并发

- Given 底窗已渲染、补拉在飞、会话正在运行（SSE 尚未建流或即将建流）
- When 补拉完成合并与 SSE 首连缺口同步相继发生
- Then 已渲染内容不重复不回退（log id 去重），运行中轮状态不回翻终态

#### 场景：补拉在飞时用户触顶

- Given 补拉链在飞
- When 用户滚到顶部触发「加载更早」
- Then 翻页被同步锁挂起至补拉完成，之后以补拉后的新游标续翻，不出现重复拉取/重复轮块

### FR-03: 真无轮次的空会话仍显示原空态文案，不误显骨架屏

- 历史拉取已结束（成功返回空或失败）且轮次为空的会话，必须保持既有空态文案渲染；加载态判定必须区分「在飞」与「终态空」，禁止把终态空会话误判为加载中而永久显示骨架屏。

#### 场景：新建空会话

- Given 新建会话无任何轮次
- When 用户进入该会话、历史请求返回空
- Then 显示原空态文案（「XX 已就绪」），无骨架屏残留

### FR-04: 既有测试不回归，新增加载态与分阶段渲染行为有测试覆盖

- 必须保持既有相关测试（session-panel 首屏链路、initial-window、TurnTimeline 空态）全绿；新增行为（骨架屏判定、底窗先渲染、补拉增量合并、空会话不误显）必须有对应测试用例覆盖；禁止为通过测试修改既有测试断言中与本次行为无关的语义。

#### 场景：回归护栏

- Given 本次改动触及 session-panel-page / initial-window / TurnTimeline
- When 运行 frontend 相关测试
- Then 既有用例零回归，新增用例覆盖 FR-01/FR-02/FR-03 各自主路径

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-timeline-history-loading.test.tsx「历史在飞时渲染轮次骨架屏替代空态文案；turns 非空即退场」
FR-02: frontend/src/components/daemon/session-panel/__tests__/session-first-load-staged.test.tsx「底窗到达即渲染最近轮；补拉完成后增量 prepend；补拉在飞挂起加载更早」
FR-03: frontend/src/components/daemon/__tests__/turn-timeline-history-loading.test.tsx「历史拉取终态空会话保持原空态文案」
FR-04: frontend/src/components/daemon/session-panel/__tests__/session-first-load-staged.test.tsx + 既有 session-panel/turn-timeline/initial-window 相关测试全量跑绿「回归护栏」
