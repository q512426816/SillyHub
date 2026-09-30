---
author: flow-machine-draft
created_at: 2026-09-30T07:14:28.540Z
---
# 决策记录（Decisions）— 2026-09-30-takeover-tier3-ambiguous-msg

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：风险：机器名含 runtime.name 为空时回退 id 短码（文案仍可诊断）。死路：无——三种失败态各有明确指引。回滚=revert 单 commit（纯文案+details 字段，无 schema/协议面）。
