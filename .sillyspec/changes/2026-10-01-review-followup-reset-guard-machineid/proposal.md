---
author: flow-machine-draft
created_at: 2026-10-01T11:23:25.836Z
---
# 提案书（Proposal）— 2026-10-01-review-followup-reset-guard-machineid

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:bfc69c461921886e00506d3cb9ba5d45e692656c687a7c544f055f9301fef584:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-01-review-followup-reset-guard-machineid 留痕重锚 -->
任务原话转写：24h 代码审查观察项 1/3 修复：reset 端点缺软删守卫与 machine-id 落盘注释实现不符。
成功标准：
- reset_tool_report_session 会话查询补 deleted_at IS NULL 守卫，软删会话重置返回 404，与 takeover 同款查询对齐，附回归测试
- readOrCreateMachineId 改独占创建（wx）+ 写冲突回读胜者 + 非 uuid 形损坏覆写自愈，注释如实描述不再宣称原子落盘，附单测
- 仅跑触达文件的相关测试（backend daemon reset 用例 + sillyhub-daemon config-machine-id 用例），全部通过
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:d7292544e0f12e65bdccb832902be0537f0789aacfe08c7a0c71f1568124cde9:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-01-review-followup-reset-guard-machineid 留痕重锚 -->
按成功标准机械推导，共 3 条验收面：
1. reset_tool_report_session 会话查询补 deleted_at IS NULL 守卫，软删会话重置返回 404，与 takeover 同款查询对齐，附回归测试
2. readOrCreateMachineId 改独占创建（wx）+ 写冲突回读胜者 + 非 uuid 形损坏覆写自愈，注释如实描述不再宣称原子落盘，附单测
3. 仅跑触达文件的相关测试（backend daemon reset 用例 + sillyhub-daemon config-machine-id 用例），全部通过
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:bdceeb5500df73032cb68422e141e79ad07e4e9837670e2df663c5f591bda565:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-01-review-followup-reset-guard-machineid 留痕重锚 -->
1. reset_tool_report_session 会话查询补 deleted_at IS NULL 守卫，软删会话重置返回 404，与 takeover 同款查询对齐，附回归测试
2. readOrCreateMachineId 改独占创建（wx）+ 写冲突回读胜者 + 非 uuid 形损坏覆写自愈，注释如实描述不再宣称原子落盘，附单测
3. 仅跑触达文件的相关测试（backend daemon reset 用例 + sillyhub-daemon config-machine-id 用例），全部通过
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
