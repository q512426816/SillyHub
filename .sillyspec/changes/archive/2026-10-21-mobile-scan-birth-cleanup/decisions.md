---
author: flow-machine-draft
created_at: 2026-10-21T01:29:34.551Z
---
# 决策记录（Decisions）— 2026-10-21-mobile-scan-birth-cleanup

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险：legacy scan 阶段值（2026-09-27 前创建且未推进的行）在移动端详情失去步骤条——实为与桌面一致的既有降级形态（收敛），且此类行本就停滞在出生阶段无步骤可看，风险可忽略。次要风险：兜底改 brainstorm 后 `current_stage=null` 行显「需求分析」可能被误读为「正在头脑风暴」——null 属平台镜像异常态（正常行恒有阶段），兜底只是防裸显，可接受。放弃方案：①保留 STEPPER_STAGES 别名仅删 scan 元素——留无谓别名不如直用 WORKFLOW_STAGES 单一源，防第三份副本再漂移；②连 ChangeStepBadge 的 scan 标签/色映射一并删——那是 legacy 值域映射，删了会让存量 scan 行裸显英文 'scan'，越界，弃。
