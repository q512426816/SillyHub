---
author: flow-machine-draft
created_at: 2026-09-27T22:23:45.536Z
---
# 决策记录（Decisions）— 2026-09-28-audit-risk-fixes

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：黑名单收窄以「root 只进 spawn cwd、绝不拼命令串」为前提——若未来 knowledge 命令改为拼接 root，& 等字符会重新构成注入面；已在类注释钉死该前提，改命令构造时必须回看。containment 是真正的物理边界，黑名单仅异常值防线。 试过放弃的方案：把 issue-row 的 div onKeyDown 一并删除（F-3 同源直觉）——div role=button 无原生键盘激活，删了是可访问性回归；只删 underline-nav 的容器级处理（tab 是真 button，原生激活足够）。 不可修项留档：66ae9a0d4 提交点 ImportError 是 git 历史事实（HEAD 已由 723d325fd 补全），不改写历史。 评审 P2 裁决（change.patch 冻结区间夹带）：session_insights.py 的 `func.max(cast(AgentRunLog.id, String))` hunk 属并行会话提交 66393f432（turn-outline 指纹 PG 无 uuid 聚合修复，生产 500），非本变更交付文件面——baseline(b14ce676f)..HEAD 区间采集把它扫入冻结件，属区间机械现象（先例：多份归档提交的「并行会话增量不夹带」注记）。该 hunk 的行为承诺与测试（15 用例）在 66393f432 自身留档，本变更不重复承接，边界已裁决：可接受。
