---
author: flow-machine-draft
created_at: 2026-10-10T00:01:26.900Z
---
# 决策记录（Decisions）— 2026-10-10-daemon-tombstone-change-guard

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：白名单过严误伤合法 change 名（如未来出现含中文/空格的目录名）——现网 change_key 全部为 `YYYY-MM-DD-<slug>` 形态（目录名派生），正则与 backend 手动端点已长期同款，收紧面两端一致，误伤面为零增量。试过但放弃：在执行器 `_requireCommandPrecondition` 内加校验——该方法被 resolve/ghost_cleanup/tombstone_cleanup 三路共用，resolve 路径 change 经 CLI 数组形参已有 assertSafeChangeName，重复校验混淆守卫分工；且消息入口层一层拦截覆盖所有下发路径，更完整。
