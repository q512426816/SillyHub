---
author: flow-machine-draft
created_at: 2026-09-29T08:25:19.927Z
---
# 任务注册表（Tasks）— 2026-09-29-change-detail-timeline-files-polish

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge + 2026-09-29 心跳指针）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。📌 任务面在 ①spec 阶段定稿：覆写为真实实现步骤（全 `- [ ]`）后再动代码；执行循环：Working on task N/M → 做一件 → 勾一格 → 下一个——收口硬门拒单拍多格勾选（--allow-batch-tick 可显式旁路留痕）。`flow status --change <名>` 为自愿查看/恢复面（恢复时给下一任务指针与进度，非协议必需——D-007）。本文件收口前随交付显式 pathspec 提交。

- [x] task-01: 后端 `_TEXT_SUFFIXES` 补 `.jsonl`，watcher-events.jsonl 判定恢复为文本（预览链路根因）
- [x] task-02: structured-views 新增 tryParseJsonl/JsonlView/watcher-events 专用表格视图 + 单测
- [x] task-03: 预览链路注册 jsonl：preview-registry EXT_MAP/RendererKey、jsonl-previewer、RENDERER_MAP、JsonPreviewer 名字兜底、FilePreview 内联分支
- [x] task-04: 变更文件树固定产物中文名映射（树节点 + 内容标题主显中文、原名小字对照，下载名不变）+ 单测
- [x] task-05: 时间线卡优化：节点连线时间轴视觉 + 内容限高内部滚动 + 事件超 30 条折叠/展开 + 文案通俗化，保住既有测试锚点（testid/amber 醒目态）
- [x] task-06: 跑前端相关测试（时间线卡/文件树/structured-views/preview-registry）+ 后端 change 模块相关测试，全绿后提交
