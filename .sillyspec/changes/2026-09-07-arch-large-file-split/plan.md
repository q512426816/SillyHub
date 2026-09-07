---
author: qinyi
created_at: 2026-09-07 08:36:44
plan_level: full
change: 2026-09-07-arch-large-file-split
---

# 实现计划（Plan）— 三端会话域大文件架构拆分

## Spike 前置验证

无独立 Spike——技术不确定性已在 brainstorm Design Grill 双轮源码审查中消解（ESM facade / Python 同名包 / bundler 目录化 / patch 命名空间规则均经独立子代理实测验证 pass）。task-01 产出符号基线，task-02 首个方法簇落地即顺带验证 facade 机制。

## Wave 结构（3 交付阶段 × 12 执行 Wave，遵循 D-003 顺序门控）

### 阶段 A：sillyhub-daemon（Wave 1–4）

## Wave 1（daemon 前置对账，无依赖）
- task-01

## Wave 2（daemon 两文件拆包，不同文件可并行）
- task-02
- task-03

## Wave 3（daemon 轻重构，依赖 Wave 2 产出的新包结构）
- task-04

## Wave 4（daemon 阶段验收——定向测试全绿门控，过了才进 backend）
- task-05

### 阶段 B：backend（Wave 5–8）

## Wave 5（backend 前置对账：import + patch 两类清单）
- task-06

## Wave 6（backend 四文件拆包，不同文件可并行）
- task-07
- task-08
- task-09
- task-10

## Wave 7（backend 轻重构，依赖 Wave 6 产出的新包结构）
- task-11

## Wave 8（backend 阶段验收——定向测试全绿 + openapi 零 diff 门控）
- task-12

### 阶段 C：frontend（Wave 9–11）+ 总验收（Wave 12）

## Wave 9（frontend 前置对账：7 符号 + lib/daemon 全量导出面）
- task-13

## Wave 10（frontend 两目录拆分，不同目录可并行）
- task-14
- task-15

## Wave 11（frontend 阶段验收门控）
- task-16

## Wave 12（总验收 + 模块文档同步）
- task-17

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | Wave1 前置对账：daemon 两文件全量导出面与引用方符号清单 | W1 | P0 | — | FR-02, D-004@v1 | 产出 facade 保底符号基线（对账文档入 changeDir） |
| task-02 | 拆分 session-manager.ts → interactive/session-manager/ 13 子模块 + 瘦 facade | W2 | P0 | task-01 | FR-02, FR-04, D-004@v1, D-005@v3 | 一次一簇、每簇搬完跑定向测试 |
| task-03 | 拆分 task-runner.ts → task-runner/ 8 子模块 + 瘦 facade | W2 | P0 | task-01 | FR-02, FR-04, D-004@v1, D-005@v3 | 与 task-02 不同文件可并行 |
| task-04 | daemon 轻重构：payload-utils + event-wire + dialogResult 收敛 | W3 | P1 | task-02, task-03 | FR-05, D-002@v1, D-005@v3 | 白名单 ①②⑥，每项独立提交+定向测试 |
| task-05 | daemon 阶段验收：定向测试全绿 + tsc --noEmit + 行数核查 | W4 | P0 | task-04 | FR-06, D-006@v1 | session-manager/task-runner 相关测试子集 |
| task-06 | Wave2 前置对账：import 语句 + patch 字符串目标两类清单 | W5 | P0 | task-05 | FR-02, D-007@v1 | R-04 对账基线 + D-007 延迟解析白名单 |
| task-07 | 拆分 router.py → router/ 9 文件包 | W6 | P0 | task-06 | FR-02, FR-04, D-004@v1 | 挂载顺序不变量 + 同形状路由保序对 |
| task-08 | 拆分 session/service.py → session/service/ 14 文件包 | W6 | P0 | task-06 | FR-02, FR-04, D-007@v1 | 6 私有符号 + patch 命名空间规则 |
| task-09 | 拆分 group/service.py → group/service/ 10 文件包 | W6 | P0 | task-06 | FR-02, FR-04, D-004@v1 | patch 命名空间规则按 task-06 白名单中 group.service 条目适用 |
| task-10 | 拆分 run_sync/service.py → run_sync/service/ 9 文件包 | W6 | P0 | task-06 | FR-02, FR-04, D-004@v1 | patch 命名空间规则按 task-06 白名单中 run_sync.service 条目适用；保持对 session.service 私有符号的既有导入 |
| task-11 | backend 轻重构：_background_tasks mixin + event_publish + attachment_pipeline | W7 | P1 | task-08, task-09, task-10 | FR-05, D-002@v1 | 白名单 ③④⑤，每项独立提交+定向测试 |
| task-12 | backend 阶段验收：定向测试全绿 + ruff + openapi.json 零 diff + 行数核查 | W8 | P0 | task-07, task-11 | FR-06, D-006@v1 | daemon/tests 相关子集；openapi 前后 diff 是 router 拆分（task-07）的直接验收证据 |
| task-13 | Wave3 前置对账：session-panel 7 符号 + lib/daemon 全量导出面清单 | W9 | P0 | task-12 | FR-02, D-004@v1 | index 再导出保底基线 |
| task-14 | 拆分 session-panel.tsx → session-panel/ 11 文件目录 | W10 | P0 | task-13 | FR-02, FR-04, D-005@v3 | index 7 符号再导出；page ≤3000 / dialog ≤2000 豁免 |
| task-15 | 拆分 lib/daemon.ts → lib/daemon/ 10 文件目录 | W10 | P0 | task-13 | FR-02, FR-04, D-004@v1 | 与 task-14 不同目录可并行 |
| task-16 | frontend 阶段验收：定向测试全绿 + tsc --noEmit + 行数核查 | W11 | P0 | task-14, task-15 | FR-06, D-006@v1 | components/daemon/__tests__ + lib/daemon mock 相关 |
| task-17 | 总验收 + 模块文档同步 | W12 | P1 | task-05, task-12, task-16 | FR-01, FR-04, FR-06, D-001@v1 | 8 文件行数汇总 + 在途 8 文件零改动核查 + 文档更新：SillyHub/modules/daemon.md（backend 拆分）、SillyHub/modules/frontend_components.md + frontend_lib.md（前端拆分）、multi-agent-platform/modules/sillyhub-daemon.md（daemon 侧源文件结构段） |

## 关键路径

task-01 → task-02 → task-04 → task-05 → task-06 → task-08 → task-11 → task-12 → task-13 → task-14 → task-16 → task-17（串行最长路径；task-03/07/09/10/15 为可并行旁支）

## 全局验收标准

1. **现有测试零修改通过**（D-006 硬验收）：三端定向测试子集全绿，任何测试文件内容不变。
2. **类型与 lint**：daemon `pnpm typecheck`（tsc --noEmit）、backend `uv run ruff check .`、frontend tsc 通过（按 local.yaml commands，只跑相关端）。
3. **行为零变化证据**：backend openapi.json 拆分前后零 diff；git diff 确认在途 8 文件（daemon.ts/hub-client.ts/config.ts/protocol.ts/sillyspec-manager.ts/backend protocol.py 等）零改动。
4. **行数达标**（D-005@v3）：新子模块 ≤800；核心编排 ≤2500；session-panel-page ≤3000、session-panel-dialog ≤2000 显式豁免。
5. **轻重构白名单 6 项**各带新增定向测试文件且通过；白名单外零行为改动。
6. 逐项核验结果由 verify 阶段写入 verify-result.md；task 级验收对照 TaskCard frontmatter acceptance 字段。

## 生产接线路径说明

design.md 提及入口文件 cli.ts / daemon.ts / main.py 仅作为**导入兼容的引用方**存在（facade 保持其 import 语句原样工作），本变更不修改任何入口文件——理由已在 design.md §5/§7 明示（62/23 个引用方零改动正是方案 A 的核心目标），故所有 task 的 allowed_paths 不含入口文件。
