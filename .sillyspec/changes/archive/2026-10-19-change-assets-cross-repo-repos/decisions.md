---
author: flow-machine-draft
created_at: 2026-10-19T10:18:04.692Z
---
# 决策记录（Decisions）— 2026-10-19-change-assets-cross-repo-repos

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：读侧新增字段被误读成「主仓统计的一部分」——已在资产卡显式区分「主仓 patch / 跨仓各仓」并对 totals 不做相加。另一个风险是每次 assets 读取需解析可能数 MB 的 change-patch.json（repos 正文在场时），但既有实现本就整文件 JSON.parse 提取 files，增量可接受；如后续成为热点再做流式/缓存。放弃方案：①后端把 patch 正文一起回传给前端做切片——单仓正文 3.5MB 且会重复传输，违背「元数据进卡片、正文走全屏预览」的既有分工；②按仓切片端点（A2）——本次不需要，留待卡内直接看 diff 的需求出现再加。
