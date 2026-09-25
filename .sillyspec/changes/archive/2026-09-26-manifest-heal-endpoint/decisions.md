---
author: flow-machine-draft
created_at: 2026-09-25T23:19:58.353Z
---
# 决策记录（Decisions）— 2026-09-26-manifest-heal-endpoint

## D-001@v1: 风险与死路（design 槽4 收割）
- 决策：最大风险：误清真墓碑（该变更确实被平台删除、heal 后下一轮同步复活已删内容）。缓解：单文件
  显式清单=人工逐条拍板（与 resolve --keep-local 同判级）+ WORKSPACE_WRITE 权限 + 审计日志 +
  删除动作本身可重放（change-center 再删即重立墓碑）。放弃方案：①前缀批量 heal——一次误操作清
  整目录墓碑，拒绝；②heal 时同步重推文件内容——越权（内容归同步通道，heal 只清行状态）；
  ③自动检测冤案（archived 载荷匹配）——fed6e9e9a 在 progress 通道已有先例，但 spec manifest
  误标形态未普查，自动化误判面大，留后续。
