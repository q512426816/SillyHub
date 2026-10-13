---
author: flow-machine-draft
created_at: 2026-10-13T06:14:15.565Z
---
# 提案书（Proposal）— 2026-10-13-change-files-view-polish

## 动机

任务原话转写：变更文件预览的人读优化：timeline.md 裸 markdown 不像时间线、change.patch 整片红绿摊开、plan.md/delta.md 等固定产物无中文名。
成功标准：
- timeline.md 预览渲染为按时间排序的竖向时间线（时刻列+节点+事件文本，任务面/统计脚注分区呈现），解析失败回落原 markdown 渲染
- change.patch 预览按文件折叠展示（每文件一行：路径+增删统计，默认收起，展开看该文件红绿 diff），无 diff --git 头回落整片 DiffView
- plan.md/delta.md/module-impact.md/symbol-impact.md/apply-manifest.json/verify-facts.json/scope-audit.json 在文件树与内容标题显示中文名+原名对照，与既有固定产物一致
- 内联预览与全屏预览（previewers）共用同一套新视图，不做两套渲染
- 聚焦测试通过（structured-views/change-file-tree/相关 previewer），不跑全量

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. timeline.md 预览渲染为按时间排序的竖向时间线（时刻列+节点+事件文本，任务面/统计脚注分区呈现），解析失败回落原 markdown 渲染
2. change.patch 预览按文件折叠展示（每文件一行：路径+增删统计，默认收起，展开看该文件红绿 diff），无 diff --git 头回落整片 DiffView
3. plan.md/delta.md/module-impact.md/symbol-impact.md/apply-manifest.json/verify-facts.json/scope-audit.json 在文件树与内容标题显示中文名+原名对照，与既有固定产物一致
4. 内联预览与全屏预览（previewers）共用同一套新视图，不做两套渲染
5. 聚焦测试通过（structured-views/change-file-tree/相关 previewer），不跑全量

## 成功标准（可验证）

1. timeline.md 预览渲染为按时间排序的竖向时间线（时刻列+节点+事件文本，任务面/统计脚注分区呈现），解析失败回落原 markdown 渲染
2. change.patch 预览按文件折叠展示（每文件一行：路径+增删统计，默认收起，展开看该文件红绿 diff），无 diff --git 头回落整片 DiffView
3. plan.md/delta.md/module-impact.md/symbol-impact.md/apply-manifest.json/verify-facts.json/scope-audit.json 在文件树与内容标题显示中文名+原名对照，与既有固定产物一致
4. 内联预览与全屏预览（previewers）共用同一套新视图，不做两套渲染
5. 聚焦测试通过（structured-views/change-file-tree/相关 previewer），不跑全量
