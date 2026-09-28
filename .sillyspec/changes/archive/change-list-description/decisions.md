---
author: flow-machine-draft
created_at: 2026-09-28T05:54:38.286Z
---
# 决策记录（Decisions）— change-list-description

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：提取规则对动机段书写形态的覆盖面——动机段可能只有列表、可能含「成功标准」字样在散文中、可能空段。对策：规则保守（无动机段/剥后为空 → None，前端零占位），500 字符截断防长文破版，纯函数加一组形态回归测试（thin 机器稿/完整流程散文/列表首段/无动机段/空前缀）。 放弃的方案：① CLI 侧给 thin proposal 起语义 H1——只惠及未来 thin，存量与完整流程不受益，且机器自动起标题质量不可控；② 前端行内直接拉 proposal 文档渲染——列表页多一轮文档请求、且 search 仍搜不到，不解决「找」的本痛点。
