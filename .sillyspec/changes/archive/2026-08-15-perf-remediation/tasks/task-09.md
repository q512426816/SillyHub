---
id: task-09
title: "daemon 门控清理"
title_zh: "_pollLoop 按通道拆分门控（lease WS 健康跳过）+ 落盘日志 7 天启动清理"
author: qinyi
created_at: 2026-08-15 07:00:00
priority: P1
depends_on: []
blocks: [task-10]
requirement_ids: [FR-11, FR-12]
decision_ids: [D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/ws-client.ts
  - sillyhub-daemon/src/terminal-observer.ts
  - sillyhub-daemon/src/policy/audit-sink.ts
  - sillyhub-daemon/tests/daemon.test.ts
  - sillyhub-daemon/tests/ws-client.test.ts
  - sillyhub-daemon/tests/terminal-observer.test.ts
  - sillyhub-daemon/tests/policy/audit-sink.test.ts
goal: >
  daemon _pollLoop（daemon.ts:2113）无条件双通道 30s 轮询改按通道拆分——lease 分支在 WS 健康时跳过（isConnected 且距最后一条 WS 消息小于 90 秒，TASK_AVAILABLE 推送兜底），change-write 分支保留 30 秒不动（该通道无 WS 推送，轮询是唯一分发通道）；另加启动时清理 7 天前的落盘日志（terminal-observer 的 runs 子目录与 audit-sink 的 failover jsonl）。
implementation:
  - ws-client.ts 在 isConnected getter（:207）附近加 lastMessageAt 只读 getter——记录最后一条 WS 消息到达时间戳，daemon.ts 门控条件消费；不改变 ws-client 既有行为
  - daemon.ts 的 _pollLoop 拆通道门控——lease 轮询分支加条件：wsClient.isConnected 为真且距今最后一条 WS 消息小于 90 秒时跳过本轮（靠 TASK_AVAILABLE 推送兜底分发）；WS 断连或消息陈旧（假活，R-05）时照常轮询，断连恢复仍 30 秒
  - change-write 轮询分支保持 30 秒不动——protocol 无 change-write 消息类型、change_writer 不走 ws_hub，轮询是唯一分发通道（Grill B-1 修订），禁止顺手门控
  - terminal-observer.ts 启动时清理 7 天前的 runs/leaseId 子目录（:78-94 附近，只清目录不动写入逻辑）
  - policy/audit-sink.ts 启动时清理 7 天前的 failover jsonl 文件（:174-183 附近，只清文件不动写入逻辑）
  - vitest 门控条件矩阵——已连接且消息新鲜等于跳过、断连等于执行、连接在但消息陈旧（大于 90 秒）等于执行；清理用例断言 7 天前的删、新文件不删
acceptance:
  - WS 连接且 90 秒内有消息时，lease 轮询该轮跳过（不发起 HTTP 请求）
  - WS 断连时 lease 轮询照常执行（30 秒周期恢复兜底）
  - WS 连接在但消息陈旧（假活）时 lease 轮询照常执行
  - change-write 分支轮询周期与行为不变（30 秒）
  - 启动清理只删 7 天前的 runs 子目录与 audit jsonl，新建文件不误删
verify:
  - cd sillyhub-daemon && pnpm test
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - 门控只作用于 lease 分支——change-write 分支 30 秒不动（Grill B-1：该通道无 WS 推送，门控会让 change 写任务失联）
  - lastMessageAt 只加只读 getter——不在 ws-client 暴露可写状态
  - 日志清理只在启动时执行一次，写入路径与日志格式不动（NFR-01）
  - 90 秒阈值与 7 天清理期为常量提取，便于测试注入时间
related_tests:
  - path: sillyhub-daemon/tests/daemon.test.ts
    reason: _pollLoop 门控条件矩阵（跳过/执行/假活执行）用例落点
  - path: sillyhub-daemon/tests/terminal-observer.test.ts
    reason: 7 天清理不误删新文件用例落点
  - path: sillyhub-daemon/tests/policy/audit-sink.test.ts
    reason: failover jsonl 启动清理用例落点
---
