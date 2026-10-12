---
author: flow-machine-draft
created_at: 2026-10-12T02:09:47.667Z
---
# 决策记录（Decisions）— 2026-10-12-ws-ref-atomic-caret

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：拦截面过宽误伤正常输入——部分重叠拒绝会让「拖选从标签中间开始的一段删除」被拒（用户需重选）；接受（行为可预期，完整覆盖整块的选区放行覆盖主路径）。放弃的方案：换 contenteditable 富文本（原子节点原生支持，但 2026-10-09 D-001 已否决——IME/退格/联想全链路回归风险大，本诉求未达「token 机制不可维护」的复潮条件）。
