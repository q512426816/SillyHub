---
author: flow-machine-draft
created_at: 2026-10-13T01:24:23.686Z
---
# 决策记录（Decisions）— 2026-10-13-multiturn-changeid-misjudge

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：把"interactive + run.change_id 非空"原本唯一指代的 stage 派发会话误改成 active——已排除：stage 派发会话在 create.py:291 写 session 级 change_id，新锚下仍命中单轮收口（FR-02 场景锁定）；线上验证存在 session.change_id 非空的存量 stage 会话。放弃方案：①按 session_kind/origin=='chat' 判定——线上实证 stage 会话 kind/origin 同为 'chat'（见排查记录），不可区分，弃；②扩展 D-006 豁免表到 completed——治标不治本（completed 本不该进豁免判断），且会误保活真单轮任务，弃；③daemon 侧不给聊天轮打 change_id 锚——归因功能是 2026-10-12 刚上的产品能力，回退损失审计面，弃。
