---
author: flow-machine-draft
created_at: 2026-09-27T05:52:55.218Z
---
# 提案书（Proposal）— 2026-09-27-thin-display-fix

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:7de69ab2ad5df309ae326a00bf1c7d2a11dd70a2a8786a55994f44e2269d31a6:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-display-fix 留痕重锚 -->
任务原话转写：轻量变更（thin）在详情页与列表的展示语义修正：归档 thin 变更（current_stage=archived）被错误渲染为标准六阶段工作流——checks 横条显示主管线、审批区落通用「无可审批」文案、标题「影响: —」空值噪音；列表行 active thin 缺轻量标识。根因：出身信号判定不完整（stage=thin 仅 active 期命中；flow start 创建的 thin 变更 change_type=feature 非 quick）。
成功标准：
- 详情页对 thin 出身变更（判定：current_stage=thin 或 change_type=quick 或 steps 全无标准阶段痕迹）显示轻量流程条（flow start→干活→flow done）而非六阶段 checks
- 审批区对 thin 出身变更显示轻量只读说明卡而非「当前无可审批事项」
- 标题区影响字段空值时不渲染占位噪音
- 列表行 active thin（stage=thin）状态图标为琥珀闪电
- 判定函数导出+单测覆盖三分支；相关测试全绿 + tsc 0 + 部署后浏览器验证 hover-polish 详情
- 遗留如实登记：归档 flow-thin 在列表行无出身信号（列表投影无 steps，需后端加 is_thin 投影——记入后续建议不在本刀）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:b74da6ca25ba959f72353547a61ed76644fabf130918fb690ca41faf6bc01fe2:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-display-fix 留痕重锚 -->
按成功标准机械推导，共 7 条验收面：
1. 详情页对 thin 出身变更（判定：current_stage=thin 或 change_type=quick 或 steps 全无标准阶段痕迹）显示轻量流程条（flow start→干活→flow done）而非六阶段 checks
2. 审批区对 thin 出身变更显示轻量只读说明卡而非「当前无可审批事项」
3. 标题区影响字段空值时不渲染占位噪音
4. 列表行 active thin（stage=thin）状态图标为琥珀闪电
5. 判定函数导出+单测覆盖三分支
6. 相关测试全绿 + tsc 0 + 部署后浏览器验证 hover-polish 详情
7. 遗留如实登记：归档 flow-thin 在列表行无出身信号（列表投影无 steps，需后端加 is_thin 投影——记入后续建议不在本刀）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:fcc692f8eb5be643c0d48857c773228ef5dc53f93f70b63bcbb5e612d42c4638:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-display-fix 留痕重锚 -->
1. 详情页对 thin 出身变更（判定：current_stage=thin 或 change_type=quick 或 steps 全无标准阶段痕迹）显示轻量流程条（flow start→干活→flow done）而非六阶段 checks
2. 审批区对 thin 出身变更显示轻量只读说明卡而非「当前无可审批事项」
3. 标题区影响字段空值时不渲染占位噪音
4. 列表行 active thin（stage=thin）状态图标为琥珀闪电
5. 判定函数导出+单测覆盖三分支
6. 相关测试全绿 + tsc 0 + 部署后浏览器验证 hover-polish 详情
7. 遗留如实登记：归档 flow-thin 在列表行无出身信号（列表投影无 steps，需后端加 is_thin 投影——记入后续建议不在本刀）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
