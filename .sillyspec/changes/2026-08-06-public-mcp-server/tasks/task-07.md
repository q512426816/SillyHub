---
id: task-07
title: "[spike-B] 端到端实测 read_only worker 的 --allowedTools 传递链是否真通"
author: qinyi
created_at: 2026-08-06 14:10:00
priority: P0
depends_on:
  - task-06
blocks:
  - task-08
requirement_ids:
  - FR-05
decision_ids:
  - D-005@v2
allowed_paths:
  - spikes/read-only-allowedtools-spike.md
provides: []
expects_from: []
goal: >
  实测 backend worker_tool_config(read_only) → placement metadata['tool_config'] → daemon claim
  → stream-json.ts buildArgs 的 --allowedTools 端到端是否生效；厘清 execution.py:14-23 docstring
  「不强制」是否过时，以及 tool_config 二义性（结构体工具治理 vs 凭据 env map）是否干扰传递。
implementation:
  - 读 backend/app/modules/agent/execution.py 第 14-23 行与第 75 行，确认 worker_tool_config(read_only) 返回 mode/allowed_tools/max_turns 结构体
  - 读 placement.py 确认 metadata 中 tool_config 写入点与序列化方式（结构体原样存还是拆字段）
  - 读 sillyhub-daemon/src/adapters/stream-json.ts 第 281-337 行（toolConfig 消费出 --allowedTools）+ spawn-env.ts（tool_config 当 env 的二义消费）
  - 派一个 read_only worker 端到端实测，或跑现有 daemon vitest 验证 buildArgs 产出含 --allowedTools Read/Glob/Grep
  - 把结论（断点位置 / tool_config 二义是否干扰 / docstring 是否过时）写入 spikes/read-only-allowedtools-spike.md
acceptance:
  - spike 报告明确结论「传递链已通（--allowedTools 生效）」或「未通（断点在 backend/placement/daemon 哪一层）」
  - 厘清 tool_config 二义性是否干扰（结构体 buildArgs 消费 vs env map 消费 是否打架）
  - 厘清 execution.py:14-23 docstring「不强制」vs stream-json.ts 已消费 的真实状态（docstring 过时 / 文档与实现矛盾）
  - 据结论给 task-08 范围建议——已通则只修 docstring；未通则补通传递链 + 拆 tool_config 二义 key
verify:
  - spikes/read-only-allowedtools-spike.md 报告存在，且结论明确（通/未通 + 二义干扰判定 + task-08 范围建议）
constraints:
  - spike 只读 + 实测 + 写报告，不改任何生产代码（修复全部留 task-08）
  - 必须落到实测或测试运行，不能停留在纯读代码推测（docstring vs 实现矛盾要见到证据）
---
