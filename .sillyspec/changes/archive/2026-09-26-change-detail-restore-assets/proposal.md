---
author: flow-machine-draft
created_at: 2026-09-26T05:54:31.127Z
---
# 提案书（Proposal）— 2026-09-26-change-detail-restore-assets

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:bde9b7b0287d2833bdfe24a13805990b4fb9bea40210bac3172831a2aa673f94:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-detail-restore-assets 留痕重锚 -->
任务原话转写：动机:304eba982 把并行会话(r18-full)基于旧分叉点的 page.tsx 整体夹带进 main,覆盖回滚了 9/25 已落地的三处变更详情页功能——沉淀资产卡(ChangeAssetsCard)挂载被删致右下角项目资产消失,STATUS_BADGE.thin 品牌紫徽章被删致轻量变更标识弱化,ScopeAuditCommandCard 的 archived 降级指路传参被删;组件与后端 /changes/{cid}/assets 端点均完好,仅需页面层恢复。

成功标准:
- 变更详情页 aside 重新挂载 ChangeAssetsCard(含 import 与挂载注释,对齐 a7eca0727 落地形态),且保留 304eba982 新增的 ChangeObservationEventsCard 不动
- STATUS_BADGE 恢复 thin 条目(label 轻量变更 variant default)与 quick 快速任务(存量)口径,注释恢复四态说明(对齐 01a9dfcbd)
- ScopeAuditCommandCard 调用处恢复 archived={isTerminalChange(change)} 传参与指路注释(对齐 9cb48847d)
- 前端聚焦测试(change-assets-card / scope-audit-command-card 组件套件)全绿,frontend tsc --noEmit 0 错
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:2256cb8a1a7bbed936447d44f2be9b8fe09d3b6190a354398a2b60acf91b961d:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-detail-restore-assets 留痕重锚 -->
按成功标准机械推导，共 5 条验收面：
1. 变更详情页 aside 重新挂载 ChangeAssetsCard(含 import 与挂载注释,对齐 a7eca0727 落地形态),且保留 304eba982 新增的 ChangeObservationEventsCard 不动
2. STATUS_BADGE 恢复 thin 条目(label 轻量变更 variant default)与 quick 快速任务(存量)口径,注释恢复四态说明(对齐 01a9dfcbd)
3. ScopeAuditCommandCard 调用处恢复 archived={isTerminalChange(change)} 传参与指路注释(对齐 9cb48847d)
4. 前端聚焦测试(change-assets-card
5. scope-audit-command-card 组件套件)全绿,frontend tsc --noEmit 0 错
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:d5be607277069bf1edc824dcfac4cc67deacb1bffab2fd51514478acc10697ce:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-detail-restore-assets 留痕重锚 -->
1. 变更详情页 aside 重新挂载 ChangeAssetsCard(含 import 与挂载注释,对齐 a7eca0727 落地形态),且保留 304eba982 新增的 ChangeObservationEventsCard 不动
2. STATUS_BADGE 恢复 thin 条目(label 轻量变更 variant default)与 quick 快速任务(存量)口径,注释恢复四态说明(对齐 01a9dfcbd)
3. ScopeAuditCommandCard 调用处恢复 archived={isTerminalChange(change)} 传参与指路注释(对齐 9cb48847d)
4. 前端聚焦测试(change-assets-card
5. scope-audit-command-card 组件套件)全绿,frontend tsc --noEmit 0 错
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
