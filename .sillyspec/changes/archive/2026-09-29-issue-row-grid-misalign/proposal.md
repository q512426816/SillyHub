---
author: flow-machine-draft
created_at: 2026-09-29T00:49:55.975Z
---
# 提案书（Proposal）— 2026-09-29-issue-row-grid-misalign

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:142131f469b41de0cc30a25af9912794bc5f417d92ec8402ec5814e7bd0aebf1:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-issue-row-grid-misalign 留痕重锚 -->
任务原话转写：变更列表 IssueRow 行网格 4 列设计 [auto,auto,minmax(0,1fr),auto] 首列为 leading 插槽，但普通行不传 leading 时渲染 null 无占位——主体列落进第 2 列 auto（按内容撑宽）、右列内容挤进第 3 列 minmax(0,1fr) 可缩到 0：长描述行右列被压到比内容窄、justify-end 内容向左溢出画出自身盒子，与描述文字互相叠压（用户 DOM 级实证：desc right 1507 × step-sub-row left 1083 交集，sillyspec 工作区归档 unclear-req-to-brainstorm 行复现）。表头 IssueRowHeader 有 leading 空占位先例（leading ? div : div/），行组件漏了。此前三轮修复（列表 span min-w-0/详情 PageHeader/快速修复表）均未触此根因——测量一直在量右列容器盒界而其内容左溢出盒外，故全部漏检。
成功标准：
- IssueRow 无 leading 时渲染空占位 div，四个子元素落进设计轨道（图标/主体 1fr/右列 auto），与 IssueRowHeader 占位先例对齐
- 修复后 unclear-req-to-brainstorm 行 desc span 与 step-sub-row 包围盒交集为 false，desc 省略号截断于主体列边界
- 右列内容不再向左溢出自身容器（全行扫描：右列每个可见文本元素左界 >= 右列容器左界）
- primer issue-row 既有测试全绿 + 新增占位回归用例 + tsc 0 错
- 部署生产后同行复测交集 false + 列表全行扫描零叠压
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:7f4a87165e66e61164bb5c7d2aa9a7fac4e42c52cb324865d29c3577cad23712:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-issue-row-grid-misalign 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. IssueRow 无 leading 时渲染空占位 div，四个子元素落进设计轨道（图标/主体 1fr/右列 auto），与 IssueRowHeader 占位先例对齐
2. 修复后 unclear-req-to-brainstorm 行 desc span 与 step-sub-row 包围盒交集为 false，desc 省略号截断于主体列边界
3. 右列内容不再向左溢出自身容器（全行扫描：右列每个可见文本元素左界 >= 右列容器左界）
4. primer issue-row 既有测试全绿 + 新增占位回归用例 + tsc 0 错
5. 部署生产后同行复测交集 false + 列表全行扫描零叠压
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:dc09270a002fbcc683577143010287558c885042a606f2a68a639aaa81925779:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-issue-row-grid-misalign 留痕重锚 -->
1. IssueRow 无 leading 时渲染空占位 div，四个子元素落进设计轨道（图标/主体 1fr/右列 auto），与 IssueRowHeader 占位先例对齐
2. 修复后 unclear-req-to-brainstorm 行 desc span 与 step-sub-row 包围盒交集为 false，desc 省略号截断于主体列边界
3. 右列内容不再向左溢出自身容器（全行扫描：右列每个可见文本元素左界 >= 右列容器左界）
4. primer issue-row 既有测试全绿 + 新增占位回归用例 + tsc 0 错
5. 部署生产后同行复测交集 false + 列表全行扫描零叠压
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
