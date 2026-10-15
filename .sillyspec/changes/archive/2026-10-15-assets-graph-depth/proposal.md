---
author: flow-machine-draft
created_at: 2026-10-15T09:22:53.270Z
---
# 提案书（Proposal）— 2026-10-15-assets-graph-depth

## 动机

任务原话转写：动机：变更详情页沉淀资产卡的内嵌知识图谱分区（2026-10-15-change-assets-graph FR-01）当前固定一跳邻域，用户希望层级（遍历深度）也可以选择，一到三——对齐知识图谱页查询表单的 depth 1-3 能力。
成功标准：
- 图谱分区卡头新增层级选择器（1跳/2跳/3跳 三档 chips），默认 1 跳；点击切换按所选深度重新发起 neighbors 查询（depth 参数进 query key，getKnowledgeGraphQuery 既有 depth 参数直通，零后端改动）；
- 切换层级时用 keepPreviousData 保持上一份图渲染不闪空（仓内 changes 列表页先例）；深度切换后选中态回退锚点节点（原选中节点不在新切片时自然兜底，无悬空引用）；
- fail-open 语义随深度保持：新深度查询失败/空结果 → 整区隐藏（与既有口径一致）；
- 仅跑本改动相关测试（change-assets-graph + change-assets-card），全量留给 CI。

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 图谱分区卡头新增层级选择器（1跳/2跳/3跳 三档 chips），默认 1 跳；点击切换按所选深度重新发起 neighbors 查询（depth 参数进 query key，getKnowledgeGraphQuery 既有 depth 参数直通，零后端改动）；
2. 切换层级时用 keepPreviousData 保持上一份图渲染不闪空（仓内 changes 列表页先例）；深度切换后选中态回退锚点节点（原选中节点不在新切片时自然兜底，无悬空引用）；
3. fail-open 语义随深度保持：新深度查询失败/空结果 → 整区隐藏（与既有口径一致）；
4. 仅跑本改动相关测试（change-assets-graph + change-assets-card），全量留给 CI。

## 成功标准（可验证）

1. 图谱分区卡头新增层级选择器（1跳/2跳/3跳 三档 chips），默认 1 跳；点击切换按所选深度重新发起 neighbors 查询（depth 参数进 query key，getKnowledgeGraphQuery 既有 depth 参数直通，零后端改动）；
2. 切换层级时用 keepPreviousData 保持上一份图渲染不闪空（仓内 changes 列表页先例）；深度切换后选中态回退锚点节点（原选中节点不在新切片时自然兜底，无悬空引用）；
3. fail-open 语义随深度保持：新深度查询失败/空结果 → 整区隐藏（与既有口径一致）；
4. 仅跑本改动相关测试（change-assets-graph + change-assets-card），全量留给 CI。
