---
author: flow-machine-draft
created_at: 2026-10-21T01:14:33.403Z
---
# 需求规格（Requirements）— 2026-10-21-mobile-scan-birth-cleanup

## 功能需求

### FR-01: 移动端变更详情 stepper 阶段序列无 scan（brainstorm→archive 五段口径）

- 移动端变更详情（MobileChangeDetail）步骤条**必须**只渲染 brainstorm、plan、execute、verify、archive 五个节点（对齐 2026-09-27-change-birth-stage-brainstorm 出生阶段决策与桌面 change-stage-header 的 `WORKFLOW_STAGES` 五段单一源）；**禁止**渲染 scan 节点（「扫描」标签不得出现在步骤条）。

#### 场景：步骤条五段

Given 一个 current_stage='plan' 的变更在移动端详情打开
When 渲染步骤条
Then 依次出现「需求分析/规划/执行/验证/归档」五个标签且不含「扫描」，当前阶段「规划」高亮。

### FR-02: 变更中心与移动卡片两处 current_stage 缺省兜底为 brainstorm，缺失兜底不再显 scan

- 变更中心桌面列表（changes/page.tsx）与移动卡片（mobile-change-card.tsx）的阶段徽标在 `current_stage` 缺省时的兜底值**必须**为 `'brainstorm'`（徽标显「需求分析」），**禁止**兜底 `'scan'`；`change-step-badge.tsx` 的 STAGE_LABELS/STAGE_KIND 对 scan 的存量值映射**必须**保留（legacy 数据仍可能带 scan 阶段值，属值域映射非起步口径）。

#### 场景：缺省兜底

Given current_stage=null 的变更行
When 渲染阶段徽标
Then 显示「需求分析」（brainstorm），不显示「扫描」。

### FR-03: 受影响组件测试更新后全绿

- `mobile-change-detail.test.tsx` 与 `mobile-change-card.test.tsx` 的既有断言**必须**随五段口径更新（步骤条标签数组去「扫描」、可点性循环去「扫描」、缺省降级用例改断言「需求分析」）且全部通过；其余断言（横向滚动、非线性降级、quick 卡口径等）**必须**零回归。

#### 场景：测试面回归

Given 组件与测试改毕
When 运行两个测试文件
Then 全部用例通过、零失败。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/mobile/mobile-change-detail.test.tsx「步骤条：横向滚动容器 + 六阶段标签 + 当前阶段高亮 + 非线性阶段降级不渲染」
FR-02: frontend/src/components/mobile/mobile-change-card.test.tsx「current_stage 缺省 → 降级 scan 标签（与桌面列降级口径一致）」
FR-03: frontend/src/components/mobile/mobile-change-detail.test.tsx「步骤条：横向滚动容器 + 六阶段标签 + 当前阶段高亮 + 非线性阶段降级不渲染」（连带 mobile-change-card.test.tsx 全文件回归）
