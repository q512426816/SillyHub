---
author: flow-machine-draft
created_at: 2026-10-25T00:26:14.274Z
---
# 决策记录（Decisions）— 2026-10-24-trajectory-context-rows

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：风险：turn_trigger 含「用户亲笔来源标注」类（shadow_chat/group_chat/schedule，contentHidden=false）——它们也显示为「上下文」行。接受：dsh 同款形态（触发源即 context 行），且行摘要有原文，用户可辨识；如需区分可后续按 trigger 字段细分。放弃的方案：继续用 processItems.system_event 作数据源——DB 实证该路径近乎恒空，修不动；为注入信息新增后端 channel——跨端大改，本平台注入已有 turn_trigger 承载，无需新通道。
