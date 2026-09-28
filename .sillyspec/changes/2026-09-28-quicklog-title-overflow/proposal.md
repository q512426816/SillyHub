---
author: flow-machine-draft
created_at: 2026-09-28T15:35:32.306Z
---
# 提案书（Proposal）— 2026-09-28-quicklog-title-overflow

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:ce6dc50b3eb8b092fc2c3eafc8e89dd3ed4a83b0345f75c2c1382697cdfe981e:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-quicklog-title-overflow 留痕重锚 -->
任务原话转写：快速修复（存量）tab 的 antd 表格标题列长文压过右侧列（用户 sillyspec 工作区实证截图 + 生产实测标题 span 右界 875 越过所在单元格右界 854）：DataTable 默认 auto 布局下标题按钮 max-w-[420px] 自适应内容宽、单元格实际更窄时按钮连同 truncate span 直接溢出压进负责人/影响模块/执行/时间列；同页状态列备注 max-w-[160px] 同型隐患。此前两轮溢出修复（列表 IssueRow/详情 PageHeader）未覆盖此组件。
成功标准：
- QuicklogTable 表格 fixed 布局，标题按钮宽度跟随单元格（w-full），长标题在单元格边界截断出省略号，不再压过相邻列
- 状态列备注跟随单元格宽截断，不再有越过自身单元格的文本元素（生产实测扫描 0 越界）
- 既有 quicklog-table 测试全绿 + 新增回归锁定用例 + tsc 0 错
- 部署生产后 sillyspec 工作区快速修复 tab 全单元格扫描 0 越界
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:78b7cafd67894d179b4dace8ab57df97980209bd6602bebb599d5b2fb763b06a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-quicklog-title-overflow 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. QuicklogTable 表格 fixed 布局，标题按钮宽度跟随单元格（w-full），长标题在单元格边界截断出省略号，不再压过相邻列
2. 状态列备注跟随单元格宽截断，不再有越过自身单元格的文本元素（生产实测扫描 0 越界）
3. 既有 quicklog-table 测试全绿 + 新增回归锁定用例 + tsc 0 错
4. 部署生产后 sillyspec 工作区快速修复 tab 全单元格扫描 0 越界
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:38499ae499b05df4131189e90bcd299f33a7c55fd65e34342bca42e73da325c0:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-quicklog-title-overflow 留痕重锚 -->
1. QuicklogTable 表格 fixed 布局，标题按钮宽度跟随单元格（w-full），长标题在单元格边界截断出省略号，不再压过相邻列
2. 状态列备注跟随单元格宽截断，不再有越过自身单元格的文本元素（生产实测扫描 0 越界）
3. 既有 quicklog-table 测试全绿 + 新增回归锁定用例 + tsc 0 错
4. 部署生产后 sillyspec 工作区快速修复 tab 全单元格扫描 0 越界
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
