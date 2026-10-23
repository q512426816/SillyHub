---
author: flow-machine-draft
created_at: 2026-10-23T16:58:27.159Z
---
# 决策记录（Decisions）— 2026-10-24-pi-edit-patch-synth

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是 **oldStart 行号的近似性**——块替换前面的内容有他源改动时，累积偏移算出的旧行号有偏差（diff 内容仍真实，行号标注可能偏几行）。缓解：jsdoc 披露；newStart（新文件行号，弹窗主体信息）由实盘定位恒精确。次风险：入参登记打破 pi-events 零状态设计——登记面收敛为 call_id→args 单 Map、轮内生命周期、容量上限，复杂度受控。 试过放弃的方案：①daemon 在 tool_use 时刻读旧文件、end 时刻读新文件算真 diff——旁路观察与工具执行竞态（start 到 end 间他源改动会被误算入该工具），且 pi 工具在 driver 外执行、时序不可靠，放弃；②解析 pi 结果文本中的路径与块数——结果无内容无行号，解析只得元数据无 diff 体，放弃；③前端从 tool_call 入参自行渲染（A+ 方案）——不改 daemon 但弹窗要做第二套渲染（write 全文视图/edit 块视图），且每会话拉全量 tool_call 入参放大 payload，放弃（用户已裁决走根治）；④放宽前端 parseStructuredPatch 行号可空——动 claude 轨道共用解析器，回归面大，放弃。
