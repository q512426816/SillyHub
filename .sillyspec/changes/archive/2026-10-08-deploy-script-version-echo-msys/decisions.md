---
author: flow-machine-draft
created_at: 2026-10-08T03:32:39.580Z
---
# 决策记录（Decisions）— 2026-10-08-deploy-script-version-echo-msys

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：风险极低（一行 shell）；放弃方案：MSYS_NO_PATHCONV=1 前缀——放弃理由：需按平台条件设置，比 sh -c 包裹更绕且仅 Git Bash 语义。
