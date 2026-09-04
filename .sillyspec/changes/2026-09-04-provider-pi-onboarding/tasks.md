---
author: qinyi
created_at: 2026-09-04 10:47:00
---

# 任务清单（Tasks）

> 骨架：plan 阶段展开细节并写回本文件。

- [x] task-01: PiEventNormalizer 归一化器+事件 fixture 与用例
- [x] task-04: caps 三端 pi 键+EXPECTED_PROVIDERS+providers.ts 条目+cli.ts 装配行+detector minVersion
- [x] task-02: PiRpcDriver 核心（rpc 子进程/LF 分帧/命令收发/handle 契约/get_state 握手）(depends_on: task-01)
- [x] task-03: Driver 高级语义（inject 三模式/session_started 合成/agent_settled 收敛/ui_request 取消/resume/interrupt/crash 收敛）(depends_on: task-02)
- [x] task-05: 前端引擎白名单两处+provider 选择可用性测试 (depends_on: task-04)
- [x] task-06: subagent 实证（examples 扩展接入+事件归属实测→翻值或如实留 false）(depends_on: task-02,03)
- [ ] task-07: 真实 PI 会话冒烟（onboarding §8+PI 清单）+onboarding 案例锚与档B 盲区修复 (depends_on: task-03,05)
