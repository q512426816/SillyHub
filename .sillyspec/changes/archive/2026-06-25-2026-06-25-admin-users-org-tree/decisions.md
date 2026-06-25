---
author: WhaleFall
created_at: 2026-06-25T15:45:00
---

# decisions — admin/users 组织树筛选 决策台账

## D-001@v1 — include_children 固定 true（无 UI 切换开关）

- type: requirement
- status: accepted
- source: 对话式探索（Step 6）
- question: 点击组织节点时，右侧用户列表的过滤范围如何控制？
- answer: 固定「当前组织 + 所有下级」，无切换开关。后端 include_children 前端固定传 true。
- normalized_requirement: 点击组织节点 → 查该组织 + 所有下级组织成员；无 include_children UI 控件。
- impacts: Phase 2（list_users include_children 默认 True）/ Phase 3（router Query True）/ Phase 6（前端固定传 true）
- evidence: Step 6 用户选「固定含下级组织（推荐）」。
- priority: P1

## D-002@v1 — 组织树只显示 active；subtree 聚合含 disabled 下级成员

- type: boundary
- status: accepted
- source: 对话式探索（Step 6）+ 需求澄清（Step 7 内联）
- question: 组织树显示哪些组织？disabled 下级组织的成员是否计入父 subtree？
- answer: 树 UI 只显示 active 组织（disabled 不显示）；但 subtree_member_count / list_users 过滤按组织树**结构**聚合，含 disabled 下级组织的成员（用户仍绑定在那些组织）。
- normalized_requirement: 树渲染过滤 status==='active'；_descendant_ids / _subtree_member_count 不过滤 status（按 parent_id 结构）。
- impacts: Phase 5（组件过滤 active）/ Phase 1（_subtree_member_count 不过滤 status）
- evidence: Step 6 用户选「只显示启用(active)组织」；Step 7 内联处理 disabled 下级边界。
- priority: P1

## D-003@v1 — subtree_member_count = distinct user_id

- type: term
- status: accepted
- source: 需求澄清（Step 7 内联）
- question: subtree_member_count 的「成员」如何计数（一用户在子树内多个组织算几次）？
- answer: distinct user_id 计数——一用户在子树内多个组织只算 1 次，与 list_users 过滤 distinct 一致。
- normalized_requirement: `SELECT count(distinct user_id) FROM user_organizations WHERE organization_id IN subtree_ids`。
- impacts: Phase 1（_subtree_member_count 实现）/ Phase 7（distinct 去重验收）
- evidence: Step 7 内联；与 list_users exists 过滤语义一致。
- priority: P1

## D-004@v1 — list_users 用 exists 子查询过滤（无 join 去重）

- type: architecture
- status: accepted
- source: 方案选择（Step 8）
- question: 后端组织过滤的去重方式？
- answer: exists 子查询过滤 organization_id IN {root}∪_descendant_ids(root)，不 join user_organizations，User 行不重复，total/分页天然正确。
- normalized_requirement: list_users 加 `.where(exists(select(1).select_from(user_organizations).where(user_id==User.id & organization_id.in_(org_ids))))`。
- impacts: Phase 2
- evidence: Step 8 用户选「方案 A exists 子查询」；方案 B（join+group_by）group_by+分页复杂易错被否。
- priority: P0

## D-005@v1 — subtree_member_count 实时算，不缓存

- type: architecture
- status: accepted
- source: 方案选择（Step 8）
- question: subtree_member_count 是否缓存？
- answer: 实时算（每次 list_organizations/_to_read 调 _subtree_member_count）。数据量小未上线，缓存一致性复杂度不值。
- normalized_requirement: 不加缓存列/Redis；_to_read 每次实时算。
- impacts: Phase 1
- evidence: Step 8 方案 C（缓存）过度设计被否；R-02 记录未来量大可改批量预计算。
- priority: P2
