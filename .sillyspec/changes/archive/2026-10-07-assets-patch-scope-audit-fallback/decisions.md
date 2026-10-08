---
author: flow-machine-draft
created_at: 2026-10-08T00:36:48.700Z
---
# 决策记录（Decisions）— 2026-10-07-assets-patch-scope-audit-fallback

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：file_list 语义按通道不同——change-patch.json 的 files 数组含 .sillyspec/ 规格工件，scope-audit.json 的 rows 只含对账表行。展示口径随之不同（各自的真实冻结 面），可接受；未来若要求统一需 CLI 侧统一留痕（第 3 层根治）。试过但放弃：在 assets 层实时重算 git diff 补数——引入实时窗口漂移，违背「归档留档冻结在收尾时点」 的既有语义。
