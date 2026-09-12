# 提案：群聊触发链锁窗口优雅降级 + 共识任务行先行提交

- change: 2026-09-12-group-trigger-lock-graceful
- date: 2026-09-12
- author: qinyi

## 问题

群聊多成员并行触发的存量锁窗口（archive/2026-09-10-group-agent-direct-chat verify 抓获）：

1. daemon 缺位/慢响应时，并发消息触发同批成员，第二个触发协程在成员行 `FOR UPDATE` 等锁超过全局 `lock_timeout=5s` → `asyncpg LockNotAvailableError` 无人接 → **整请求 500**（存量行为，关闭共识同复现）。
2. 共识模式下，主事务里 flush 未 commit 的共识任务行被 500 连带回滚——**消息已落时间线但任务蒸发**的不一致（共识模式放大面），sweeper 无从兜底。

## 方案（C，与用户确认）

- **①三段式锁降级**（shadow.py）：无锁快查复用 → FOR UPDATE 正常等（防双建语义原样）→ 超时 rollback 重读：复用或 4xx 报忙（落既有部分失败收集）。
- **②任务行先行提交**（messages.py）：gather 前显式 commit——任务与消息同生，触发失败由 sweeper 30s 超时收口 aborted（D-006 闭环按意图生效）。

## 影响面

- daemon 域 group 子域（shadow.py / messages.py）+ 新增测试文件。
- 不动：防双建 FOR UPDATE 语义、全局 lock_timeout、dispatch 挪出锁外重构（后续候选）。

## 验收

- 并发触发同成员：无 500（复用或 4xx 报忙，消息不丢）。
- 任务行在触发失败后仍存在且 sweeper 可收口。
- 群链路存量 208 测试全绿；真实环境并发前后对照复验。
