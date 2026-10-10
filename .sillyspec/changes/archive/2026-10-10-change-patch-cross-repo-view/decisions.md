---
author: flow-machine-draft
created_at: 2026-10-10T11:45:59.165Z
---
# 决策记录（Decisions）— 2026-10-10-change-patch-cross-repo-view

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：patch 正文内联使 change-patch.json 体积增大（跨仓多文件大 diff），预览链若对 JSON 全量 parse 可能耗内存——但 DiffView 已有 2000 行增量渲染兜底 DOM 面，且折叠默认收起，渲染成本可控；JSON.parse 本身是预览链既有成本，非本变更引入。 试过但放弃的方案：① 在变更中心 scope-audit 实时查询链（command-card）加 patch 面——该链是实时对账（快照说当下），无冻结正文书，且要动 daemon 投影白名单（repoPath 剥离逻辑），面大不做；冻结正文归属 change-patch.json 读侧。② patch 正文落独立文件族（change-patch-cross-repo/<key>.patch）——违背 2026-10-09-close-trace-single-set 单套两件纪律，producer 侧设计已显式否决（D-001@v1），平台侧不翻案。
