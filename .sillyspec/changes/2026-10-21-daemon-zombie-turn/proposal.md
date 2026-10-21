---
author: flow-machine-draft
created_at: 2026-10-21T07:19:34.302Z
---
# 提案书（Proposal）— 2026-10-21-daemon-zombie-turn

## 动机

任务原话转写：修复 daemon 会话僵尸轮与打断无效

动机与背景：生产会话 49d893ab（腾讯云）打断后 0.6s 一条「后台任务通知」inject 竞态到达，daemon ack 了 inject 却从未启动轮次，产生无 started_at 的悬挂 run（生产样本 5f23cf5f/fa110c23，最终靠 daemon 掉线被 sweep 收敛为 daemon_interrupted）。用户连按 10 次打断全部 acked 但 daemon 侧 turn-control 对非 running 状态静默 return false 且不回传，后端不设防、前端无超时回退，表现为「打断不了」。

成功标准：
- inject 在会话非 idle 时不再 ack 了事：排队补启或拒绝，不产生无 started_at 的悬挂 run
- interrupt 对非 running 的 no-op 结果回传后端；后端对 acked-but-ineffective 打断立即收敛 pending run 并通知前端
- 后端主动清扫「创建后 N 秒未被 daemon 启动」的 pending run（N 可配置）
- 前端打断 15s 超时回退提示，不再永久停在「打断中」

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. inject 在会话非 idle 时不再 ack 了事：排队补启或拒绝，不产生无 started_at 的悬挂 run
2. interrupt 对非 running 的 no-op 结果回传后端；后端对 acked-but-ineffective 打断立即收敛 pending run 并通知前端
3. 后端主动清扫「创建后 N 秒未被 daemon 启动」的 pending run（N 可配置）
4. 前端打断 15s 超时回退提示，不再永久停在「打断中」

## 成功标准（可验证）

1. inject 在会话非 idle 时不再 ack 了事：排队补启或拒绝，不产生无 started_at 的悬挂 run
2. interrupt 对非 running 的 no-op 结果回传后端；后端对 acked-but-ineffective 打断立即收敛 pending run 并通知前端
3. 后端主动清扫「创建后 N 秒未被 daemon 启动」的 pending run（N 可配置）
4. 前端打断 15s 超时回退提示，不再永久停在「打断中」
