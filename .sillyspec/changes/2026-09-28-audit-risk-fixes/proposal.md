---
author: flow-machine-draft
created_at: 2026-09-27T21:39:32.121Z
---
# 提案书（Proposal）— 2026-09-28-audit-risk-fixes

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:d1476c4776db6a1df84d5532fb841f2c9260a9e10266d09d06a20035c50867c5:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-audit-risk-fixes 留痕重锚 -->
任务原话转写：24h 审查高置信缺口统一收口：knowledge 治理写 RPC 缺 allowed_roots containment（写校验弱于读）、mobile detailOpen 无守卫致 desktop 状态污染 mobile 双挂组件、thin/quick 出身判定 desktop/mobile 口径分叉、变更列表删除按钮被整行导航劫持，及三处 P3（exc.details 恒 fallback、_safe_module_doc NUL 崩溃、黑名单误拦 Windows 合法 & 路径）。
成功标准：
- KnowledgeGovernanceHandler digest/action 双点过 assertWithinAllowedRoots（daemon.ts 注入 rootsProvider），越界 root 拒 forbidden 且不 spawn CLI
- knowledge root 黑名单收窄到异常值字符集，Windows 合法目录字符 & $ ' ` ; 不再误拦
- mobile variant 下 detailColumnVisible 恒 false，localStorage 跨视口不再双挂 TaskExecutionPanel/SessionUsageBar
- mobile-change-detail thin/quick 卡判定对齐 desktop isThinLineageChange（归档 thin 与 change_type=quick 落轻量卡）
- 变更列表删除按钮与标题链接 stopPropagation，点击不再触发整行 location.assign
- DaemonRpcRemoteError 重映射改用 exc.code 且 timeout→504 其余→502，错误码不再恒 remote_error
- _safe_module_doc 拦 NUL 字节，含 \0 的 doc 不读盘整条丢弃
- 聚焦测试全绿（daemon handler / session 变体 / mobile 详情 / changes 页 / test_governance / test_assets）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:691cadcd64a7a3c4558dc4dd154759e1be99746046ca489b4f1cafea4fa58239:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-audit-risk-fixes 留痕重锚 -->
按成功标准机械推导，共 11 条验收面：
1. KnowledgeGovernanceHandler digest/action 双点过 assertWithinAllowedRoots（daemon.ts 注入 rootsProvider），越界 root 拒 forbidden 且不 spawn CLI
2. knowledge root 黑名单收窄到异常值字符集，Windows 合法目录字符 & $ ' `
3. 不再误拦
4. mobile variant 下 detailColumnVisible 恒 false，localStorage 跨视口不再双挂 TaskExecutionPanel
5. SessionUsageBar
6. mobile-change-detail thin
7. quick 卡判定对齐 desktop isThinLineageChange（归档 thin 与 change_type=quick 落轻量卡）
8. 变更列表删除按钮与标题链接 stopPropagation，点击不再触发整行 location.assign
9. DaemonRpcRemoteError 重映射改用 exc.code 且 timeout→504 其余→502，错误码不再恒 remote_error
10. _safe_module_doc 拦 NUL 字节，含 \0 的 doc 不读盘整条丢弃
11. 聚焦测试全绿（daemon handler / session 变体 / mobile 详情 / changes 页 / test_governance / test_assets）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:4ba2c338f5277ab35cc6797da0a975d3e88d5be28ab93dc75c6683b2e0154ec3:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-audit-risk-fixes 留痕重锚 -->
1. KnowledgeGovernanceHandler digest/action 双点过 assertWithinAllowedRoots（daemon.ts 注入 rootsProvider），越界 root 拒 forbidden 且不 spawn CLI
2. knowledge root 黑名单收窄到异常值字符集，Windows 合法目录字符 & $ ' `
3. 不再误拦
4. mobile variant 下 detailColumnVisible 恒 false，localStorage 跨视口不再双挂 TaskExecutionPanel
5. SessionUsageBar
6. mobile-change-detail thin
7. quick 卡判定对齐 desktop isThinLineageChange（归档 thin 与 change_type=quick 落轻量卡）
8. 变更列表删除按钮与标题链接 stopPropagation，点击不再触发整行 location.assign
9. DaemonRpcRemoteError 重映射改用 exc.code 且 timeout→504 其余→502，错误码不再恒 remote_error
10. _safe_module_doc 拦 NUL 字节，含 \0 的 doc 不读盘整条丢弃
11. 聚焦测试全绿（daemon handler / session 变体 / mobile 详情 / changes 页 / test_governance / test_assets）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
