---
author: flow-machine-draft
created_at: 2026-09-29T09:40:28.686Z
---
# 决策记录（Decisions）— 2026-09-29-change-detail-timeline-files-polish

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：现有时间线卡测试断言行级 className（text-amber-700 醒目态）与 testid——重构 DOM 结构时须保住这两个锚点；jsonl 预览的 mime 不确定性（后端 guess_type 对 .jsonl 在不同平台可能返回 None/application/json/text-plain）已用三层兜底（EXT_MAP + JsonPreviewer 名字转发 + 解析失败回落纯文本）覆盖。 试过放弃的方案：直接复用 primer Timeline 组件做事件轴——放弃：其节点 h-7 + pb-5 行距是稀疏事件范式（GitHub 活动流），事件密集的留痕时间线用它会把卡片撑得更高，与「限高防撑爆」目标矛盾；只借其「节点+连线+tone」视觉语言自建紧凑行。另放弃在 openFullscreenPreview 里把 meta.name 换成中文名——下载文件会得到中文名文件，破坏本地对照能力。
