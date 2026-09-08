---
author: qinyi
created_at: 2026-09-07 08:32:48
---
# 提案书（Proposal）

## 动机

三端会话域 8 个巨型文件（合计约 4.1 万行）是当前代码库最大的可维护性债务：知识库已登记 daemon god 文件「无低风险切片路径」，且 daemon.ts 从 2026-08-18 的 4047 行膨胀到 7711 行——债务在加速累积。本变更通过有边界的系统性拆分止住趋势，让每个文件回到可独立理解的规模。

## 关键问题

1. **单文件认知超载**：session-manager.ts（5438 行）单类 4900 行、18 个方法簇混居；backend session/service.py（7176 行）单类 6200 行、create_session 单方法 1055 行。任何一处修改都需要在数千行上下文中定位，review 与回归成本极高。
2. **重复实现并行演化**：`_fire_background_task` 在 session 与 run_sync 逐字节相同；`_eventToReportDict` 与 `_eventToMessages` 平行维护；session 与 group 各持一份附件校验/装配管线；5+ 处同构 Redis publish helper——修一处漏一处。
3. **测试面与源文件强耦合的假象**：实际上兼容层方案（Python 同名包/TS facade/bundler 目录化）能让 133+ 文件的导入与 157 处 patch、55 处 vi.mock 全部零改动，拆分的真实成本远低于直觉，值得一次性系统推进。

## 变更范围

- 拆分 8 个文件：daemon 的 session-manager.ts / task-runner.ts（瘦 facade + 子包）；backend 的 router.py / session/service.py / group/service.py / run_sync/service.py（同名包替代模块）；frontend 的 session-panel.tsx / lib/daemon.ts（目录化 + index 聚合再导出）。
- 6 项白名单轻重构（鸭子读取器统一 / event-wire 收敛 / 后台任务 mixin / Redis publish 统一 / 附件管线收敛 / dialogResult 收敛）。
- 3 Wave 顺序交付：Wave 1 daemon → Wave 2 backend → Wave 3 frontend，每 Wave 定向测试全绿再进下一个。

## 不在范围内（显式清单）

- 不做 notify_* payload Pydantic 化（会改 OpenAPI schema 触发 gen:types 连锁）
- 不合并 session-panel page/dialog 两模式重复 handler 为共享 hook（闭包状态风险）
- 不做 mixin / Object.assign 原型扩展式类拆分
- 不做三端契约类型统一、不重划模块边界、不改对外 API/DTO/事件格式
- 不拆测试文件、不清理无关历史代码
- 不碰在途变更 conflict-resolve-entry 的 8 个文件（daemon.ts、hub-client.ts、config.ts、protocol.ts、sillyspec-manager.ts、backend protocol.py / runtime/service.py / ws_hub.py / lease/context.py）

## 成功标准（可验证）

- 8 个原文件行数达标：新拆出文件 ≤800 行、核心编排 ≤2500 行（显式豁免：session-panel-page.tsx ≤3000、session-panel-dialog.tsx ≤2000）
- 全部现有测试**零修改**通过（导入路径 / vi.mock 路径 / patch 字符串目标全兼容）
- 类型检查与 lint 通过（daemon tsc、backend ruff、frontend tsc）
- 拆分后 openapi.json 与拆分前零差异
- 6 项轻重构各有定向测试且通过
