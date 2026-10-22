---
author: flow-machine-draft
created_at: 2026-10-22T05:16:58.076Z
---
# 决策记录（Decisions）— 2026-10-22-turn-trigger-metadata-p2

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是盖戳覆盖群聊键的理论冲突——群聊链路未来若也需 turn_trigger 语义（群聊来源标注），合并序（trigger 覆盖 chain）会吞掉；现状群聊 turn_metadata 不含 turn_trigger 键（键空间不相交），风险登记不设防。次要风险：'schedule' 排队行 origin 若被用户伪造——busy 路径入队的 origin 由 _handle_busy_turn 参数派生（HTTP 注入端点不透传 turn_trigger），浏览器不可达，伪造面不存在。死路：①「run metadata 盖戳」（metadata_.auto_resume_of 同族）——放弃，前端时间线装配以日志行为输入、run metadata 需跨 API 关联穿透装配签名（Phase 1 已评估放弃）；②「前端按内容前缀识别 schedule」——定时消息派发是裸 user prompt 无标记，前缀方案要求派发侧改 prompt 内容（污染正文），metadata 盖戳零污染；③「排队行加新列」——origin 列同族语义复用即可，零迁移。
