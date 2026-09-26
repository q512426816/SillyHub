---
author: flow-machine-draft
created_at: 2026-09-26T07:41:38.870Z
---
# 决策记录（Decisions）— 2026-09-26-assets-test-binding-raw-text

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：requirements.md 槽格式是 sillyspec 工具约定（AGENT 注释 + 内容行），工具改版后格式漂移会让正则失配——表现为 raw_binding=None 静默降级（与现状等价，不劣化），且工具坑已留档（test-trace 截断坑里建议摘录保真，若工具侧修了截断，tests 数组本身带用例名，本原文行自然退居补充信息）。试过但放弃：①改摘录器保真——外部 CLI 工具，本项目侧改不了；②前端自行拉归档 requirements.md 展示——归档件在 spec 镜像树，无逐文件读取端点，为展示开新端点收益不成比例。正则锚点取 FR-[A-Za-z0-9-]+ 宽容匹配（含 FR-auto-xxx 等未来形态），内容行截止到下一 <!--AGENT: 或空行。
