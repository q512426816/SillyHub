---
author: flow-machine-draft
created_at: 2026-09-29T08:25:19.926Z
---
# 提案书（Proposal）— 2026-09-29-change-detail-timeline-files-polish

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:ca912a9705ac1ff2ef28f6c28799e4d934d117d1ccf9ba3f800a572394fc8c3d:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-change-detail-timeline-files-polish 留痕重锚 -->
任务原话转写：变更详情页三处阅读体验优化:真实留痕时间线视觉与长度控制、变更文件弹窗支持 watcher-events.jsonl 结构化预览、固定产物文件名中文显示。

成功标准:
- 时间线卡事件轴有节点连线时间轴视觉,事件/任务多时限高内部滚动不再撑爆详情页,事件超过阈值默认折叠可展开
- 变更文件弹窗内联与全屏预览均能结构化渲染 watcher-events.jsonl(逐行解析,时刻/类型/详情人类可读)
- 变更目录固定产物文件(proposal.md/design.md/tasks.md/flow-state.yaml/change.patch 等)在文件树与内容标题按中文名展示,原名保留可对照
- 既有时间线卡与变更文件树相关测试不回归,新增能力有测试覆盖
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:777e40b67f6f11c673589dfa4d04c174fed169c4a5a9f57a1d9eed8c8f815d35:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-change-detail-timeline-files-polish 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. 时间线卡事件轴有节点连线时间轴视觉,事件/任务多时限高内部滚动不再撑爆详情页,事件超过阈值默认折叠可展开
2. 变更文件弹窗内联与全屏预览均能结构化渲染 watcher-events.jsonl(逐行解析,时刻/类型/详情人类可读)
3. 变更目录固定产物文件(proposal.md/design.md/tasks.md/flow-state.yaml/change.patch 等)在文件树与内容标题按中文名展示,原名保留可对照
4. 既有时间线卡与变更文件树相关测试不回归,新增能力有测试覆盖
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:8b81ee40c3e5a2f5c0daf6c3cd9abe718bb1b016b256891ec34095f6ae129787:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-29-change-detail-timeline-files-polish 留痕重锚 -->
1. 时间线卡事件轴有节点连线时间轴视觉,事件/任务多时限高内部滚动不再撑爆详情页,事件超过阈值默认折叠可展开
2. 变更文件弹窗内联与全屏预览均能结构化渲染 watcher-events.jsonl(逐行解析,时刻/类型/详情人类可读)
3. 变更目录固定产物文件(proposal.md/design.md/tasks.md/flow-state.yaml/change.patch 等)在文件树与内容标题按中文名展示,原名保留可对照
4. 既有时间线卡与变更文件树相关测试不回归,新增能力有测试覆盖
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
