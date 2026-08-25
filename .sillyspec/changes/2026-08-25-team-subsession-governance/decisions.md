---
author: qinyi
created_at: 2026-08-25 20:05:00
---

# 决策记录（Decisions）— 团队分身子会话化 P1 治理地基

## D-001@v1 — 子会话挂载用 parent_session_id 会话树

- **status**: accepted（用户 2026-08-25 拍板方案 B）
- **question**: 分身子会话与 mission 的挂载关系怎么表达？
- **options**:
  - A. AgentSession.mission_id 直接锚 mission——查询最简，但表达"分身属于任务"而非
    "会话派会话"，与用户愿景（会话树、可递归）不符；
  - B. parent_session_id 会话树——直接表达会话父子结构，通用性最强；mission 归属
    沿树爬根解析，查询复杂度用 mission_worker_sessions 一层枚举吸收。**selected**；
  - C. run 升级可交互不建会话——违背 session↔lease 1:1（D-005@v1 既有决策），否决。
- **impacts**: model.py 加列 + 解析函数；P2 递归时树深即治理载体。

## D-002@v1 — 完成信号 = worker_done 显式标记

- **status**: accepted（用户拍板）
- **question**: 怎么定义"分身干完了"？
- **options**: 显式收尾标记（分身调 worker_done，可重复置位）**selected**；会话
  直接 end（可靠但与"可追问"冲突，放弃会话能力）；turn 终态+冷却（模糊易误判，
  即现状要修的 bug）。
- **impacts**: FR-04；SETNX 幂等键随重开工 DEL。

## D-003@v1 — 分身受限 MCP server 仅含 worker_done

- **status**: accepted（Design Grill P0-1 修正产物）
- **question**: 分身 stage=mission_worker 被 daemon 谓词排除（CC-12 防递归），
  worker_done 工具如何到达分身？
- **options**: daemon 为 mission_worker 注入仅含 worker_done 的受限 server
  **selected**；平台侧检测收尾消息（不可靠，违背 D-002 显式信号）；给分身全量
  5 工具（= 放开递归，P2 范围越界）。
- **impacts**: 否决 brainstorm v1 的"daemon 零改动"声明；mcp-server.ts env 门控；
  P2 下放派发工具时升 D-003@v2 走独立决策（含深度治理）。

## D-004@v1 — owner=mission.created_by + placement 代表钉定

- **status**: accepted（用户拍板归属 + Grill P1-4 修正实现）
- **question**: 分身会话 owner 归谁？跨 ws 代表机器派发如何与 owner 校验共存？
- **decision**: owner=mission 创建者；placement 增代表 binding 钉定模式
  （resolve_representative_binding 解析 + 跳 runtime 属主校验；anchor 自有优先）。
- **impacts**: inject/权限卡片/门户/审计 owner-only 机制零改动。

## D-005@v1 — derive 走虚拟 run 映射包装

- **status**: accepted（Design Grill P1-2 修正产物）
- **question**: derive_status 是 run 级纯函数，子会话（会话级生命）怎么进派生？
- **options**: 包装 mission_derive_status（虚拟 run 映射 + workers_only 模式 +
  done 优先于终态 failed）**selected**——不改纯函数签名，存量调用零回归；直接改
  derive_status 签名（波及全调用方，风险大）。
- **impacts**: 五个消费点换包装；workers_only 对齐 converge_explicit（D-010
  既有决策）与 schedule_loop 信号 1 收窄语义。
