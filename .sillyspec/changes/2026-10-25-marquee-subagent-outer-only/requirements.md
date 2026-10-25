---
author: flow-machine-draft
created_at: 2026-10-25T02:08:04.767Z
---
# 需求规格（Requirements）— 2026-10-25-marquee-subagent-outer-only

## 功能需求

### FR-01: 外部跑马灯不再收集子代理内部消息：tool 带 children 与 subagent_stub 分支都不递归 children，仅保留容器条目

- `deriveLiveMarqueeEntries` 在 `tool`（带 children）与 `subagent_stub` 分支**必须**只产出容器条目本身，**禁止**递归收集 children 内部工具/思考。
- 容器条目**必须**保留子代理名称（primary / 工具名 / subagentType 回退链）与状态。
- 子代理内部消息**必须**继续由对话流的子代理卡片（SubagentBlockView）展示，本变更**禁止**改动该路径。

#### 场景：子代理派发

- Given 派发一个子代理，内部已执行 Grep / Bash
- When 派生跑马灯条目
- Then 外部只有一条「子代理 · Agent <目标>」容器条目；Grep / Bash 不出现在外部轨道

#### 场景：子代理卡片（不变）

- Given 同上
- When 查看对话流子代理卡片
- Then 内部工具照常在卡片内展示（现有行为零变化）

### FR-02: 子代理容器条目显示名称、运行状态（转圈）与时间：运行中显示走秒计时（优先用段 startedAt，缺省用客户端首次观察起点），完成后显示总耗时

- running 条目**必须**在转圈旁显示已运行时长并每秒递增：起点优先取段 `startedAt`（挂钟差值），缺省用组件首次观察到 running 的客户端时刻；两者皆无（防御路径）时**必须**只转圈不显示时间（不伪造）。
- 完成/失败条目**必须**显示总耗时（现状保持：`durationMs` 或客户端计时）。
- 计时刷新**必须**复用统一 1s tick，仅在存在 running 条目或等待条目时运行。

#### 场景：子代理运行中

- Given 子代理容器条目 running，段 startedAt 为 3 秒前
- When 渲染条目右侧
- Then 转圈 + 「⏱ 3s」，每秒递增

#### 场景：无段起点的思考条目

- Given running 思考条目无段 startedAt
- When 组件观察到 running 后
- Then 以客户端首次观察时刻为起点显示走秒计时

### FR-03: 工具条目同样获得运行中走秒计时；无起点数据时只转圈不显示时间

- 普通工具条目 running 时**必须**与子代理条目同款显示走秒计时；规则同 FR-02。
- reduced-motion 下计时照常更新（非动画），转圈静止。

#### 场景：Bash 运行中

- Given Bash 工具已运行 5 秒（startedAt 可得）
- When 渲染
- Then 转圈 + 「⏱ 5s」

### FR-04: 更新子代理递归相关测试并新增走秒计时用例，全部通过；lint与typecheck通过

- 既有「子代理内部工具递归进入同一轨道」用例**必须**改写为「不进入外部轨道」；
- **必须**新增：running 走秒计时（有 startedAt）、无起点只转圈；
- 全部用例（现有 29 + 新增/改写）**必须**通过；lint / typecheck **必须**通过。

#### 场景：回归核验

- Given 完成实现
- When 运行测试与 lint
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「子代理内部工具不进入外部轨道，仅容器条目」
FR-02: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「运行中条目显示走秒计时」
FR-03: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「无段起点的运行中条目用客户端起点计时（FR-02）」
FR-04: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx 整文件 31 用例通过；lint / typecheck 另行核验
