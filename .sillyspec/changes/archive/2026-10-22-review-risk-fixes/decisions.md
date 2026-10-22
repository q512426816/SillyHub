---
author: flow-machine-draft
created_at: 2026-10-21T23:48:47.007Z
---
# 决策记录（Decisions）— 2026-10-22-review-risk-fixes

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：FR-04 用 codePoint 重组字面字符后，若输入字符串本身是坏 UTF-16（孤立代理项）产出坏字节——与修复前同样产生乱码但不会更差（防御性等价，且 git 输出不会给孤立代理）。放弃的方案：① 给 `/proto/**` 加 middleware 鉴权——D-010 故障面已登记为独立事项，本次不动鉴权语义（避免 proto 预览页依赖登录态改变 dev 评审工作流），以「数据不进产物/上下文」双层代替；② 把真实导出换成人造 fixture——违背 FR-frontend-018（dev 预览要真实会话观感），不做。
