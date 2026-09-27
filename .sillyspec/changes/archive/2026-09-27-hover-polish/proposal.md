---
author: flow-machine-draft
created_at: 2026-09-27T01:26:02.697Z
---
# 提案书（Proposal）— 2026-09-27-hover-polish

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:f8b2173ae44ca3189ba265cf29007bb662c1638664c85e2a55a59c5b36c7ab35:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-hover-polish 留痕重锚 -->
任务原话转写：列表悬浮效果对齐原型：原型口径=实色浅灰背景+100ms 过渡+无边框变色（.issue-row:hover/.repo-row:hover{background:var(--canvas)}）；线上问题=透明度叠加（bg-muted/60、/40）悬浮发淡不均 + 工作区行 hover 紫边框为原型所无。
成功标准：
- 变更中心与工作区列表行 hover 为实色 muted 背景+transition-colors 100ms 级过渡，无紫色边框
- 标题链接 hover 下划线保持
- hover 操作浮现过渡平滑
- 相关测试全绿 + tsc 0 + 部署后浏览器 hover 态截图核对
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:5358f546d1f15b4b4153ded8b36d7dd225550c4547c6e453f49adc2587fa4aa9:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-hover-polish 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. 变更中心与工作区列表行 hover 为实色 muted 背景+transition-colors 100ms 级过渡，无紫色边框
2. 标题链接 hover 下划线保持
3. hover 操作浮现过渡平滑
4. 相关测试全绿 + tsc 0 + 部署后浏览器 hover 态截图核对
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:2cfb624046a809e2fdc7a0ac655b01253a1ccbbf1d86c62bc961922143c43c50:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-hover-polish 留痕重锚 -->
1. 变更中心与工作区列表行 hover 为实色 muted 背景+transition-colors 100ms 级过渡，无紫色边框
2. 标题链接 hover 下划线保持
3. hover 操作浮现过渡平滑
4. 相关测试全绿 + tsc 0 + 部署后浏览器 hover 态截图核对
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
