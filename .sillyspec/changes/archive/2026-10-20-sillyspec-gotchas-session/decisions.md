---
author: flow-machine-draft
created_at: 2026-10-20T00:43:34.128Z
---
# 决策记录（Decisions）— 2026-10-20-sillyspec-gotchas-session

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：条目描述的工具体验问题部分依赖 CLI 内部阈值/实现细节（如改写率 0.6 阈值、归档提交打印逻辑），后续版本演进可能修复——按文件头惯例每条标注踩坑时点与版本（2026-10-20 / v3.33.1），演进后由 knowledge digest 的 rot 信号自然处置。 试过但放弃的方案：①`knowledge propose` 收件箱通道——语义未文档化、proposed/ 为空，且 4 条是已实证成熟条目非待裁决提议；②只写会话汇报不落库——用户显式指令「记录下」，且不落库则后续会话不可检索、工具改进无留痕面。
