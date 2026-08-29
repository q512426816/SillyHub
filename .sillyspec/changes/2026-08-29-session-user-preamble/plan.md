---
author: qinyi
created_at: 2026-08-29 23:31:20
---

# 实现计划（Plan）

> scale=small 分支说明：本变更按 brainstorm small 分流走
> `sillyspec run quick --linked-changes`（quick 会话 quick-e1cbb3f4 /
> ql-20260829-012-2eb3）完成实现，**无独立 plan 阶段**。本文件是 verify
> 产物完整性要求的落档记录：计划即「quick 单任务」，不虚构 Wave 拆分。

## 任务与波次

| 任务 | 内容 | 状态 |
|---|---|---|
| ql-20260829-012-2eb3 | 按 design.md 实现三前导函数 + create_session 首轮接线 + 测试 | ✅ 已完成（quick 会话收口） |

## 实现顺序（实际执行序）

1. backend/app/modules/daemon/session/context.py——新增 `build_user_preamble`
   / `build_platform_rules_preamble` / `build_sillyspec_preamble` + admin/auth 模型导入。
2. backend/app/modules/daemon/session/service.py——create_session 前导段组装三前导
   （写事务外，workspace 口径与 AgentSession 同式），`_prefix_parts` 扩至七段。
3. backend/app/modules/daemon/tests/test_session_user_preamble.py——三组 14 用例
   （单测 + API 集成）。

## 验证口径

- 相关测试：新测试 + 同组装点回归 + inject/session 相邻回归（46+76 用例）。
- lint/mypy：本变更三文件 0 问题（全仓并行脏文件问题另行记录于 verify-result.md）。
- 验收基准：design.md 四项 FR（详见 verify-result.md 决策追踪矩阵）。
