---
author: flow-machine-draft
created_at: 2026-10-23T02:21:05.382Z
---
# 任务注册表（Tasks）— 2026-10-23-askuser-history-live-sync

- [x] task-01: page-helpers 新增 refetchDialogHistory（seq 防乱序 + 静默降级）；page onPermissionRequest 接线重拉——验证：session-panel-dialog.test「permission_request 到达 → 重拉 dialogHistory」（fetchSessionDialogHistory 以 sess-attach 被调 + dock 卡出现）
- [x] task-02: page/dialog onPermissionResolved 接线重拉（已答态权威数据）——验证：session-panel-dialog.test「permission_resolved 到达 → 再次重拉 dialogHistory」
- [x] task-03: dialog 挂载点同款接线（dialogHistorySeqRef 实例 + 直连 page-helpers import）——验证：dialog 建流闭包 sessionId 与 page 同构，dialog.test 65P 全绿
- [x] task-04: 乱序防护——验证：refetch-dialog-history.test「相邻两次拉取响应乱序 → 仅最新一次生效（旧序号响应被丢弃）」+「单次正常路径/失败静默降级」
- [x] task-05: 受影响测试全绿 + tsc 零错——实测：dialog.test 65P（含 2 新增）+ refetch 单测 2P + pre-session 回归 36P；tsc 零错（过滤并行 marquee 在途）
