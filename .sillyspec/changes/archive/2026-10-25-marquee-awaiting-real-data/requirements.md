---
author: flow-machine-draft
created_at: 2026-10-25T11:51:27.294Z
---
# 需求规格（Requirements）— 2026-10-25-marquee-awaiting-real-data

## 功能需求

### FR-01: 等待起点改用最后事件的服务端时间戳（日志/工具段的 endedAt/startedAt/ts 最大值），刷新或中途打开页面后等待时长继续累计不重置；无服务端时间时回退客户端起点

- `TurnLiveMarquee` **必须**新增可选 prop `lastEventAt?: number | null`（最后事件服务端毫秒时间戳）。
- 等待计时起点**必须**优先取 `lastEventAt`（`elapsed = Date.now() - lastEventAt`）；`lastEventAt` 缺省（null/undefined，旧数据或异常）时**必须**回退现有客户端首次观察起点。
- 消费方（turn-timeline）**必须**从条目派生 `lastEventAt = max(endedAt ?? startedAt ?? ts)`。
- 刷新页面/中途打开后等待时长**必须**基于服务端时间继续累计，**禁止**从 0 重置。

#### 场景：中途打开会话

- Given 轮次运行中，最后一条事件发生在 40 秒前
- When 用户打开会话页
- Then 等待条目直接显示约「等待模型响应 · 40s」并继续递增

#### 场景：无服务端时间

- Given 全部条目无时间戳
- When 进入等待态
- Then 回退客户端起点（现状行为）

### FR-02: 等待条目回显本轮累计 token（↑输入 ↓输出，来自 tokens 事件实时更新的轮级数据）；无 token 数据不显示该段

- `TurnLiveMarquee` **必须**新增可选 prop `turnTokens?: { input: number | null; output: number | null } | null`。
- 等待条目文案**必须**在有数据时追加 token 段：`等待模型响应 · 23s · ↑8,400 ↓1,250`（千分位格式）；`turnTokens` 缺省或两值皆 null 时**禁止**显示 token 段。
- token 数据来源为既有 `tokens` 事件（SSE 实时更新轮级 `inputTokens`/`outputTokens`），**禁止**新增取数请求。

#### 场景：等待中回显

- Given 本轮已累积 ↑8,400 ↓1,250，当前处于等待态
- When 渲染等待条目
- Then 显示 token 段并随 tokens 事件更新

#### 场景：无 token（旧 daemon/早期）

- Given 轮级 token 为 null
- When 渲染
- Then 仅显示「等待模型响应 · 时长」

### FR-03: 会话整页与弹窗两模式均接入；子代理卡片内嵌条不显示轮级 token（作用域是主轮）

- `SegmentedTurnBody` **必须**从 turn 状态传 `inputTokens`/`outputTokens` 与派生的 `lastEventAt`（两模式共用该渲染路径，接线一次双模式生效）。
- 子代理卡片内嵌流动条**禁止**显示主轮 token（其作用域为子代理内部）；`lastEventAt` 语义同样不适用（子代理条目有自己的时间），**必须**不传。

#### 场景：两模式一致

- Given 整页与弹窗分别打开同一运行中会话
- When 处于等待态
- Then 等待条目均显示真实时长与 token

### FR-04: 相关测试更新与新增；全部通过；lint与typecheck通过

- **必须**新增：服务端起点计时（不重置）、token 回显与缺省不显示；
- 现有跑马灯/段视图用例**必须**全部通过；lint / typecheck **必须**通过。

#### 场景：回归核验

- Given 完成实现
- When 运行相关测试与 lint
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「lastEventAt 服务端起点：挂载即累计、不重置（FR-01）」
FR-02: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「等待条目回显本轮 token；无数据不显示（FR-02）」
FR-03: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「轨道按顺序完整渲染全部条目，不复制内容循环」（消费方接线零回归）+ 上述两用例
FR-04: 上述新增用例 + 既有全部用例通过；lint / typecheck 另行核验
