---
author: flow-machine-draft
created_at: 2026-10-25T06:44:52.990Z
---
# 需求规格（Requirements）— 2026-10-25-marquee-inactive-awaiting-fix

## 功能需求

### FR-01: TurnLiveMarquee 新增 active 属性（默认 true）：active=false 时不再追加「等待模型响应」合成条目，走秒 tick 也不为等待而启动

- `TurnLiveMarqueeProps` **必须**新增可选 `active?: boolean`（默认 true）。
- `active === false` 时**必须**不追加「等待模型响应」合成条目（isAwaiting 恒 false），等待计时 interval **禁止**启动。
- 默认（不传/true）行为**必须**与现状完全一致（运行中轮的外部跑马灯零变化）。

#### 场景：终态宿主

- Given 全部条目为完成态且 active=false
- When 渲染
- Then 无等待条目、无等待转圈；条目照常显示总耗时

### FR-02: SubagentBlockView 按卡片自身运行态传 active：子代理终态后内嵌流动条无等待条目、无转圈；运行中行为不变

- 子代理卡片内嵌流动条**必须**传 `active={running}`（卡片自身状态）。
- 子代理终态后**必须**：内嵌流动条不再出现「等待模型响应」；条目显示总耗时。
- 子代理运行中**必须**：等待指示行为与现状一致。

#### 场景：子代理结束

- Given 子代理容器段 status=ok，内部工具均完成
- When 渲染卡片
- Then 内嵌流动条无等待条目、无转圈

### FR-03: 外部会话跑马灯不传 active，行为零变化

- `turn-timeline.tsx` 消费点**禁止**改动（默认 active 语义即运行中轮）。

#### 场景：外部零回归

- Given 运行中轮次、工具完成后的间隙
- When 外部跑马灯渲染
- Then 等待模型响应条目照常出现（现状）

### FR-04: 新增终态不显示等待条目用例；现有全部用例通过；lint与typecheck通过

- **必须**新增：`active=false` 无等待条目（TurnLiveMarquee 直测）+ 终态子代理卡片内嵌条无等待（SubagentBlockView）。
- 现有全部用例**必须**通过；lint / typecheck **必须**通过。

#### 场景：回归核验

- Given 完成实现
- When 运行相关测试与 lint
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「active=false 时不显示等待条目（FR-01）」
FR-02: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「终态子代理卡片内嵌流动条无等待条目（FR-02）」
FR-03: frontend/src/components/daemon/__tests__/turn-live-marquee.test.tsx「最新条目非运行中时出现等待模型响应条目」（默认 active 零回归）
FR-04: 上述新增用例 + 两文件全部既有用例通过；lint / typecheck 另行核验
