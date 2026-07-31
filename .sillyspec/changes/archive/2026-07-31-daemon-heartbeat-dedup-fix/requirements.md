---
author: WhaleFall
created_at: 2026-07-30T15:51:14
---

# 需求（Requirements）— daemon 心跳卡死 + 回复重复修复

## 功能需求

### FR-01 daemon 持续 online（不卡死）
daemon 启动后持续运行，事件循环不冻死，>2min（跨过当前 2 分钟卡死点）backend 不标 offline，`last_heartbeat` 持续更新。
- 验收：daemon 启动后 >2min 仍 online（backend `/api/daemon/machines` status=online，last_heartbeat 持续更新）；`allowed_roots_synced_per_runtime` 不再每次 changed=1。

### FR-02 agent 回复不重复
agent 回复「半截+全文」不再双发，#35 场景（同段内容出现两次）消除。
- 验收：实测会话回复不重复（一段内容只出现一次），backend logs 无 #35 式累积重复。

### FR-03 isPathUnderAnyRoot sandbox 路径判定保持正确
`PolicyCache` 口径改动后，sandbox 路径权限判定（`isPathUnderAnyRoot`）对所有场景（子路径/junction/大小写/不存在路径/符号链接/borrow root）判定结果与改前一致，不越权不误判。
- 验收：路径判定测试覆盖所有场景 + 改前改后对照断言一致（B1 红线）。

## 约束
- `isPathUnderAnyRoot` 是 sandbox 安全判定，改动必须测试覆盖（R1/B1 execute 红线）
- 照搬 thinking 机制，不发明新机制
- 跨 daemon/backend，segmentId 透传一致（R3）
- 本轮最小修复 = 口径 + 短路（卡死）+ override 删 partial（重复）；R4 异步化视实跑结果决定（B3）
