---
author: flow-machine-draft
created_at: 2026-10-14T03:20:15.087Z
---
# 决策记录（Decisions）— 2026-10-14-change-center-lineage-tag-and-filter

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：`_resolve_thin_lineage_keys` 全 workspace 拉行 + outerjoin progress 肥 JSON，大 workspace 下列表请求变慢。评估：与现网 `pending_review_only` 聚焦路径同量级（后者已有 Redis read-through 缓存先例），v1 先现算不加缓存，超预期再按先例挂缓存，不阻塞本变更。死路①：把三分支直译 SQL（PG jsonb + SQLite json_each 跨方言 JSON 展开）——方言分裂、防御解析逻辑（畸形 steps 容忍）难复刻，放弃。死路②：changes 表物化 `is_thin` 列——出身是投影语义（依赖 progress JSON 与时间窗），同步成本高且易漂移（注释↔实现不一致是万恶之源），放弃。死路③：筛选沿用 `current_stage != 'thin'` 取反——漏归档兜底行、与行内标签口径分裂，放弃。
