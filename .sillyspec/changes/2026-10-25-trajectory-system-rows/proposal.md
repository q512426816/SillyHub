---
author: flow-machine-draft
created_at: 2026-10-25T00:44:49.791Z
---
# 提案书（Proposal）— 2026-10-25-trajectory-system-rows

## 动机

任务原话转写：用户验收轨迹后追问「系统信息」仍缺失。DB 实证：团队派发指令（主控 brief「你是多 Agent 团队的主 agent…」与 Worker 派发「你是多 Agent 团队中的一个 Worker…」）以 user_input 落库且 metadata 为空，前端无法与真实用户输入区分，轨迹里标成「用户」行——dsh 对照的 system 类信息（系统提示词/派发指令）在本平台缺呈现。

成功标准：
- 轮首用户行与 user_msg 段的文本以团队指令特征前缀开头时，轨迹账本显示为「系统」类型行（kind=system + meta.systemBrief），标签「系统」，摘要照常显示原文
- 特征前缀与 backend 指令文案常量锚定（orchestrator.py render_session_orchestrator_briefing / worker 派发模板），注释标注来源；未命中前缀的用户消息保持「用户」行零回归
- 存量历史会话立即生效（启发式识别，不依赖新数据盖戳）
- 轨迹相关测试零回归、新增用例全绿、frontend tsc --noEmit 退出 0

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 轮首用户行与 user_msg 段的文本以团队指令特征前缀开头时，轨迹账本显示为「系统」类型行（kind=system + meta.systemBrief），标签「系统」，摘要照常显示原文
2. 特征前缀与 backend 指令文案常量锚定（orchestrator.py render_session_orchestrator_briefing / worker 派发模板），注释标注来源；未命中前缀的用户消息保持「用户」行零回归
3. 存量历史会话立即生效（启发式识别，不依赖新数据盖戳）
4. 轨迹相关测试零回归、新增用例全绿、frontend tsc --noEmit 退出 0

## 成功标准（可验证）

1. 轮首用户行与 user_msg 段的文本以团队指令特征前缀开头时，轨迹账本显示为「系统」类型行（kind=system + meta.systemBrief），标签「系统」，摘要照常显示原文
2. 特征前缀与 backend 指令文案常量锚定（orchestrator.py render_session_orchestrator_briefing / worker 派发模板），注释标注来源；未命中前缀的用户消息保持「用户」行零回归
3. 存量历史会话立即生效（启发式识别，不依赖新数据盖戳）
4. 轨迹相关测试零回归、新增用例全绿、frontend tsc --noEmit 退出 0
