---
author: flow-machine-draft
created_at: 2026-09-27T05:52:55.219Z
---
# 需求规格（Requirements）— 2026-09-27-thin-display-fix

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: 详情页对 thin 出身变更（判定：current_stage=thin 或 change_type
Given 系统就绪
When 详情页对 thin 出身变更（判定：current_stage=thin 或 change_type=quick 或 steps 全无标准阶段痕迹）显示轻量流程
Then 干活

### FR-02: 审批区对 thin 出身变更显示轻量只读说明卡而非「当前无可审批事项」
Given 系统就绪
When 审批区对 thin 出身变更显示轻量只读说明卡而非「当前无可审批事项」
Then 行为符合本条标准描述

### FR-03: 标题区影响字段空值时不渲染占位噪音
Given 系统就绪
When 标题区影响字段空值时不渲染占位噪音
Then 行为符合本条标准描述

### FR-04: 列表行 active thin（stage=thin）状态图标为琥珀闪电
Given 系统就绪
When 列表行 active thin（stage=thin）状态图标为琥珀闪电
Then 行为符合本条标准描述

### FR-05: 判定函数导出+单测覆盖三分支
Given 系统就绪
When 判定函数导出+单测覆盖三分支
Then 行为符合本条标准描述

### FR-06: 相关测试全绿 + tsc 0 + 部署后浏览器验证 hover-polish 详情
Given 测试 相关模块就绪
When 相关测试全绿 + tsc 0 + 部署后浏览器验证 hover-polish 详情
Then 行为符合本条标准描述

### FR-07: 遗留如实登记：归档 flow-thin 在列表行无出身信号（列表投影无 steps，需后端加 is_
Given 系统就绪
When 遗留如实登记：归档 flow-thin 在列表行无出身信号（列表投影无 steps，需后端加 is_thin 投影——记入后续建议不在本刀）
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 -->
详情域+变更组件全量 277/277（含 thin-badge-survives-archive 双徽章钉子 4 例 scoped 迁移 + 时间窗回归）

<!--AGENT:测试绑定FR-02 -->
同上套件（stage-actions thin 卡判定扩展无行为断言破坏）

<!--AGENT:测试绑定FR-03 -->
同上套件（subtitle 空值降噪由快照类用例覆盖）

<!--AGENT:测试绑定FR-04 -->
列表页 36 用例全绿（changeRowState thin 分支无断言破坏）

<!--AGENT:测试绑定FR-05 -->
isThinLineageChange 三分支由钉子用例间接覆盖（stage=thin/quick 时间窗/steps 兜底——restore-assets 4 例）；部署后 hover-polish 详情浏览器验证

<!--AGENT:测试绑定FR-06 -->
不适用：R20 工具修复（sillyspec 仓 verify-postcheck.js）由工具自身测试覆盖（deps-cwd-prefix + dynamic-test-inference 13/13），不在前端测试面

<!--AGENT:测试绑定FR-07 -->
同 FR-05：isThinLineageChange 由 restore-assets 钉子 4 例覆盖三分支与时间窗回归；部署后浏览器验证 hover-polish 详情
