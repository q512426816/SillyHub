---
author: flow-machine-draft
created_at: 2026-10-22T15:18:57.704Z
---
# 需求规格（Requirements）— 2026-10-22-conversation-live-marquee

## 功能需求

### FR-01: 对话视图运行中轮次（pending/running/interrupting）末尾渲染单行横向跑马灯，展示思考/工具/子代理/文件/系统事件等过程信息，终态轮不渲染

- 「对话」视图（`viewMode="conversation"`）中，轮次状态为 `pending` / `running` / `interrupting` 时，**必须**在该轮对话流末尾（`convoTimeline` 之后、思考占位之前）渲染一条单行横向跑马灯；轮次进入终态后**必须**不渲染。
- 跑马灯条目**必须**覆盖 `TurnSegment` 中的过程类信息：思考、工具调用、子代理（含内部工具）、文件产出、stderr、系统/前导提示、压缩状态、轮内用户消息、唤醒通知；**禁止**把 `text` 答复段摄入（正文已在对话流中展示，避免重复）。
- 跑马灯**必须**只在 v2 段路径（`segments !== undefined`）接入；旧回退路径不接入。

#### 场景：运行中展示

- Given 会话处于运行中，最新一轮已有思考/工具段
- When 用户停留在「对话」视图
- Then 该轮末尾出现单行跑马灯，条目随过程信息推进

#### 场景：终态消失

- Given 该轮从 running 变为 completed
- When 轮次重新渲染
- Then 跑马灯不再渲染（无残留、无额外占位）

### FR-02: 事件按发生顺序逐条横向滑过；新事件实时入队，无新事件时循环播放最近事件，保持持续流动感

> 2026-10-23 用户裁决修订：原「循环播放最近事件」改为「不循环、只流到最新一条」。以下正文为现行口径；标题保留锚点以便追溯。

- 条目**必须**按段在 `segments` 中的出现顺序进入同一条横向滚动轨道（同源进度视图的文档序），**禁止**逐条停留轮播。
- 事件到达即**必须**进入轨道内容（有多少刷多少），轨道**必须**只向一个方向（左）连续推进，滚到最新一条右端贴住视口右缘即停；**禁止**复制内容循环回放旧条目，**禁止**回跳。
- 新事件到达后轨道**必须**继续向左推进，旧内容滑出、新内容从右侧进入；推进速度**SHOULD**按追赶距离自适应（积压越多越快），避免最新内容长期滞后。
- 没有新事件时轨道可停在最新位置，但**必须**由容器内低频流光/运行状态点维持"仍在运行"的感知；**禁止**在无条目时渲染空壳。

#### 场景：事件密集

- Given 轨道正在滚动，连续推来多条工具/子代理事件
- When 新条目进入轨道
- Then 轨道持续向左推进，旧条目滑出、新条目依次从右进入，最终停在最新条

#### 场景：短暂空闲

- Given 最近 30 秒没有新段
- When 轨道已滚到最新一条
- Then 轨道停在最新内容处，不循环旧条目；容器流光与状态点继续提供运行感知

#### 场景：打开时已有历史

- Given 运行中轮已有若干过程事件
- When 跑马灯首次挂载
- Then 直接定位到最新内容（不从头回放旧事件）

### FR-03: 同一段的流式文本更新不重复刷屏：按段 id 去重，每段只入队一次（工具状态变化就地更新不新增）

- 同一段 id 在多次 `segments` 更新中出现时（例如思考文本持续增长），**必须**就地更新该条目的展示文本与状态，**禁止**重复入队。
- 工具段状态从 running 变为完成/失败时，**必须**就地更新该条目的状态图标，不新增条目。

#### 场景：思考流式增长

- Given 一条 thinking 段正在流式增长，`segments` 每秒更新多次
- When 跑马灯重算条目
- Then 队列中仍只有该段的一条，文本取最新值，不产生重复条目

### FR-04: 「进度」「轨迹」视图与历史轮次渲染行为零变化；旧回退轮（segments undefined）不接入

- 「进度」（`all`）与「轨迹」（`trajectory`）视图**禁止**渲染跑马灯；历史轮次（终态）与旧回退轮**禁止**接入。
- 既有 `TurnStatusBar`、思考占位、文本流式光标、折叠过程等行为**必须**保持不变。

#### 场景：切换视图

- Given 运行中轮次正在展示跑马灯
- When 用户切到「进度」视图
- Then 跑马灯消失，进度时间线照常完整展示

### FR-05: 现有主题下视觉协调，移动端不溢出，prefers-reduced-motion 下降级为静态展示最新一条

- 视觉**必须**使用项目语义 token（`brand-*` / `muted-*` / CSS 变量），在现有主题下均可读，**禁止**硬编码颜色。
- 单行容器**必须**支持窄屏（移动端 variant），不得横向撑破或导致页面横向滚动。
- 系统开启 `prefers-reduced-motion: reduce` 时**必须**降级为静态展示最新一条，**禁止**横向切换动画。

#### 场景：减少动态效果

- Given 操作系统开启"减少动态效果"
- When 运行中轮次渲染跑马灯
- Then 只静态显示最新条目，无滑动/淡入动画

### FR-06: 用户上滚离开底部或组件不可见时暂停轮播，回到底部恢复

- 跑马灯**必须**用 `IntersectionObserver` 监听自身可见性；离开视口（用户上滚使轮尾移出可视区、面板收起等）时**必须**暂停计时与动画，回到视口后**必须**恢复。
- `IntersectionObserver` 不可用（测试/旧浏览器）时**必须**默认继续运行，不报错。

#### 场景：上滚离开

- Given 跑马灯在视口内运行
- When 用户上滚使该轮末尾移出视口
- Then 轮播计时暂停；回滚到可见位置后继续

### FR-07: 新增纯函数与组件测试，相关测试通过；lint / typecheck 通过

- **必须**新增纯函数 `deriveLiveMarqueeEntries` 的单元测试（顺序、去重、上限、各类段摘要）与组件测试（连续轨道渲染、不循环、reduced-motion 降级、可见性暂停）。
- 触及文件的既有测试**必须**不回归；只跑相关测试文件（全量留给 CI）。
- 前端 `lint` 与 `typecheck`**必须**通过。

#### 场景：交付核验

- Given 完成实现
- When 运行相关 Vitest 文件与 lint
- Then 全部通过，无新增告警

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「按段文档序产出条目，跳过 text 答复段」+「子代理内部工具递归进入同一轨道（FR-01）」+「对话视图 + 运行中轮次 → 渲染跑马灯」
FR-02: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「轨道按顺序完整渲染全部条目，不复制内容循环」
FR-03: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「同一段 id 的流式更新就地覆盖文本，不重复入队（FR-03）」+「工具段状态翻转就地更新状态，不新增条目（FR-03）」
FR-04: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「对话视图 + 终态轮次 → 不渲染」+「进度视图 + 运行中轮次 → 不渲染」+「轨迹视图 → 不渲染」
FR-05: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「reduced-motion 下静态展示最新一条，不渲染滚动轨道（FR-05）」
FR-06: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「组件不可见时暂停滚动，恢复可见后继续（FR-06）」
FR-07: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「条目超过上限时只保留最近 200 条」+「无条目时不渲染空壳」（整文件 13 用例全通过；lint / typecheck 另行核验）
