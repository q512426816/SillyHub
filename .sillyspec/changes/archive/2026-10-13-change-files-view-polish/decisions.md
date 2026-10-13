---
author: flow-machine-draft
created_at: 2026-10-13T06:52:55.231Z
---
# 决策记录（Decisions）— 2026-10-13-change-files-view-polish

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：timeline.md/change.patch 是 sillyspec CLI 生成的固定格式，未来格式漂移导致解析不命中——两边都以「不命中回落既有渲染」兜底，漂移只降级不炸（与 knownJsonView 结构特征校验同一范式）。 试过但放弃的方案：按 emoji 前缀（🁢📄🔀⚠️📝✅）枚举给时间线节点逐类着色——emoji 集与 CLI 版本耦合，漂移即漏色；改为只识别「时刻开头行」的通用正则，emoji 随事件文本原样透传，节点统一品牌色圆点，不依赖枚举。
