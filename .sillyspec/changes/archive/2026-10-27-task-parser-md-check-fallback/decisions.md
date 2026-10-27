---
author: flow-machine-draft
created_at: 2026-10-27T07:24:46.874Z
---
# 决策记录（Decisions）— 2026-10-27-task-parser-md-check-fallback

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：卡片 frontmatter 显式写了 `status: draft`（人工想强制 draft）的场景会被误回退为 done——已靠键存在性区分（显式 draft 优先于勾选态）消除；残留面是极旧的卡写了 status 但语义与勾选冲突（未见实例，reparse 幂等可观察）。放弃方案：①改 CLI 让 task-tick 同步写 TaskCard frontmatter status——跨工具改动（sillyspec CLI），平台侧修不动上游，且 TaskCard 是执行卡非状态源的模板约定会被打破；②reparse 后置覆盖（先解析卡再用 tasks.md 覆盖同 key）——与「卡片富信息优先」docstring 声明正面冲突且丢显式 status 语义，不如解析内回退干净。
