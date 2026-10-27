---
author: flow-machine-draft
created_at: 2026-10-27T03:27:18.910Z
---
# 决策记录（Decisions）— 2026-10-27-session-input-spacing-tighten

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：@联想浮层与 textarea 垂直对齐漂移——已通过 overlayClassName 镜像同步改消除，并由 draft-scope 回归用例兜底。试过放弃：按用户片段字面把 py-2/py-5 上下全删——会让消息顶行贴边/输入框过扁，按用户片段「只有下内边距」的口径改为只去下保上（pt-5/pt-2），更贴近其真实意图（收紧消息区与输入区之间的空隙）。
