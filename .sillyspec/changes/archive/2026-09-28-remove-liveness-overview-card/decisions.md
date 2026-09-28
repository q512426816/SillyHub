---
author: flow-machine-draft
created_at: 2026-09-28T14:23:58.192Z
---
# 决策记录（Decisions）— 2026-09-28-remove-liveness-overview-card

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：误删共享受害面——agent-liveness-overview-card.tsx 删除若连带删 lib 层（listWorkspaceAgentLogs / liveness-badge）会打断会话列表活性链路；已核对引用（grep 全仓）确认仅摘卡不动数据层。放弃的方案：①「无有效数据时隐藏卡片」——判定条件含糊（库里恰有一条 manual_test idle 测试行会让门失效），且链路未建立期间卡片等于死代码，不如删干净；日后链路修复可从 git 历史整卡恢复。②「修链路保功能」——需 daemon 指回本机后端 + 各 workspace local.yaml 下发 platform token + daemon 常驻，为一个总览卡付出整条运维链路成本，用户已裁决不值得。
