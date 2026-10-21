---
author: flow-machine-draft
created_at: 2026-10-21T00:59:28.398Z
---
# 需求规格（Requirements）— 2026-10-21-overview-card-mainflow-scan

## 功能需求

### FR-01: 总览卡主管线为 brainstorm→plan→execute→verify→archive 五段，无 scan 点位；brainstorm 阶段变更不渲染「scan 已完成」

- 「活跃变更总览」卡主管线**必须**只渲染 brainstorm、plan、execute、verify、archive 五个点位（对齐 sillyspec `MAIN_FLOW_ORDER`——2026-09-27-change-birth-stage-brainstorm 起出生阶段即 brainstorm，scan 是按需显式跑的辅助阶段）；**禁止**渲染 scan 点位；brainstorm 阶段（管线首位）的变更**禁止**出现「scan 已完成」读屏语义。

#### 场景：brainstorm 阶段行

Given envelope 变更行 current_stage='brainstorm'
When 渲染主管线
Then aria 语义含「brainstorm 进行中」与「plan 待办」，且不含任何 scan 点位（「scan 已完成/进行中/待办」均不出现）。

#### 场景：verify 阶段行

Given envelope 变更行 current_stage='verify'
When 渲染主管线
Then 「brainstorm/plan/execute 已完成」各一、「verify 进行中」、「archive 待办」，无 scan 点位。

### FR-02: current_stage='thin' 的变更行渲染「◈ thin」旁路徽标且不显示「步骤 0/0」文案（quick/explore 存量行为不动）

- current_stage='thin' 的活跃变更行**必须**渲染「◈ thin」旁路徽标（既有 BYPASS_BADGES 通道）**且禁止**显示「步骤 0/0」文案——thin 不走阶段机、无步骤语义（CLI 侧 2026-10-21-overview-thin-stage 已把 envelope current_stage 投影为 thin，steps 维持 {0,0} 真实值，前端按阶段隐藏文案）；quick/explore 两旁路键的既有渲染（含步骤文案）**必须**保持不变。

#### 场景：thin 变更行

Given envelope 变更行 current_stage='thin'、stage_label='◈ 轻量变更'、steps={0,0}
When 渲染活跃变更行
Then 出现「◈ thin」徽标与「◈ 轻量变更」标签，不出现主管线点位，不出现「步骤 0/0」。

### FR-03: changes-overview-card 既有测试更新后全绿

- `frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx` 既有断言面**必须**随五段管线口径更新（scan 点位断言移除/替换）且全部通过；组件其余行为（健康条/过滤 tab/ghost 折叠/冲突区/降级三态）断言**必须**零回归。

#### 场景：测试面回归

Given 组件与测试改毕
When 运行该测试文件
Then 全部用例通过、零失败。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx「渲染——健康条计数/管线两态/stage 徽标/steps 进度/相对时间/倒序（fixture 含 envelope readable/command 容忍字段）」
FR-02: frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx「thin 变更行——◈ thin 旁路徽标 + 隐藏步骤 0/0（2026-10-21-overview-card-mainflow-scan）」
FR-03: frontend/src/components/workspace/__tests__/changes-overview-card.test.tsx「渲染——健康条计数/管线两态/stage 徽标/steps 进度/相对时间/倒序（fixture 含 envelope readable/command 容忍字段）」
