---
author: flow-machine-draft
created_at: 2026-10-01T11:33:26.462Z
---
# 决策记录（Decisions）— 2026-10-01-review-followup-reset-guard-machineid

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：machine-id 收紧「非 uuid 形即覆写」可能误伤手工预置的非标准身份串（如有人手写短码）——但协议文档明约「纯文本 uuid（36 字符）」，非 uuid 形本就是损坏态，误伤面为零。试过但放弃：temp+rename 真·原子替换——两个并发写者各自 rename 仍是 last-write-wins，不解决本问题主矛盾（并发双生成漂移），反而多一次跨平台 rename 语义差异（Windows 目标被占用 EPERM）面；wx 独占创建 + 回读胜者用更小的面收敛同一目标。
