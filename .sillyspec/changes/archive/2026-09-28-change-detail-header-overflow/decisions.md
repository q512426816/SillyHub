---
author: flow-machine-draft
created_at: 2026-09-28T14:56:38.199Z
---
# 决策记录（Decisions）— 2026-09-28-change-detail-header-overflow

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：PageHeader 被 41 个页面共用，min-w-0 理论上改变极端长内容页的既有视觉（原先溢出可见、现在可能截断）——但「溢出可见」本身就是缺陷态，且正常宽度内容不受影响；jsdom 单测锁定类名在场，Playwright 生产复测定格几何。 试过放弃的方案：仅在详情页 subtitle 外包一层 `overflow-hidden` 容器——放弃：治标（裁掉溢出但不恢复截断省略号语义），且不动组件会留下其余 40 个使用方的同型隐患。 另注：三断点纪律的①spec/②执行断点按会话自主模式跳过等待（用户为报障式请求、修复面两行 CSS、根因有生产实测锚定），③归档断点结果照常汇报。
