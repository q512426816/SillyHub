---
author: flow-machine-draft
created_at: 2026-10-13T16:21:06.433Z
---
# 决策记录（Decisions）— 2026-10-13-change-owner-backfill

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：语义软化——兜底「工作区所有者」在多人协作工作区里未必是真责任人（agent 干的活记到创建工作区的人头上）。缓解：前端 title 明示「负责人未指派，默认工作区所有者」兜底语义；数据侧不改写存量，真实 owner（change_writer 路径）永远优先显示。若未来需要精确归属，可在会话立项联动时把会话用户写入（本次范围外，留作后续演进）。 试过但放弃的方案： - 「reparse 对存量空行也回填 workspace.created_by」——放弃理由：300 条历史行一次性改写、不可逆，且多数为 agent 产出，把「未知」写成「猜测」弱化数据可信度；展示层兜底达到同等可见效果。 - 「从 git log 提交者推断负责人」——放弃理由：agent 提交的 git author 不可靠（多为统一 agent 身份/机器账号），且 reparse 在平台侧执行需要额外仓库访问，成本高收益低。
