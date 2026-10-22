---
author: flow-machine-draft
created_at: 2026-10-22T04:01:28.414Z
---
# 决策记录（Decisions）— 2026-10-22-turn-trigger-generalize

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是内容前缀检测的伪造/漂移面——用户手打 `[系统续跑` 或 `【影子直聊】` 开头会被误标来源行（不丢内容、仅标注错源）；daemon 模板文案改动会静默漏检。双向前缀为 daemon/后端单一源常量且有测试锁定（auto_resume.py 注释「单一源导出供测试锁定」），跨语言同步义务注释落在前端常量处；根治靠 Phase 2 metadata 驱动（设计已排期）。死路：①「run metadata 驱动分类」——Phase 1 放弃（装配签名穿透成本，见做法概述）；②「定时消息并入」——用户裁定留 Phase 2（派发侧无标记需后端动 scheduled_send）；③「每源独立段类型」——组合爆炸，设计对比稿已否决（A 案）；④「shadow/group 前导保留 preamble 段双呈现」——进度视图双卡（来源注入卡 + 触发行）冗余，已裁定触发行替代。
