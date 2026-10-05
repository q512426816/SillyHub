---
author: flow-machine-draft
created_at: 2026-10-05T13:58:48.448Z
---
# 决策记录（Decisions）— 2026-10-05-remove-promo-film

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险是误删仍需要的文件——已核对 docs/promo 全部 31 个文件均由本会话生成（v1 变更与 v2 变更的交付物，无第三方内容），且 git 历史可完整恢复（git revert 6b6c18fc9）。放弃的方案：只删 v2 保留 v1——用户语义「生成的我不需要」覆盖两版，全删。
