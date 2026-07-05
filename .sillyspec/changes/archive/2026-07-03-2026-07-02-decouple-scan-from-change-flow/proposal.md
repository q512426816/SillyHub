---
author: qinyi
created_at: 2026-07-03 08:33:48
change: 2026-07-02-decouple-scan-from-change-flow
---

# Proposal: scan 从变更流程彻底移除

## 动机

变更流程当前把 scan（`sillyspec run scan`，为整个项目生成架构文档）作为每个新建变更的强制第一步。scan 本质是 workspace 级的一次性初始化动作，与单个变更的改动意图无关。已扫描 workspace（实证 `myaaa` 有 1335 份 scan-docs、`last_scanned_at=2026-07-02 14:48`）之后新建的变更仍被强制重扫，纯冗余；且 scan 段无审核面板，新建变更后页面无引导，体验断裂。

## 关键问题（为什么现有方案不够）

- scan 是 `202606190900_unify_workflow_stages`「统一 workspace/变更 stage 枚举」时塞进变更流程的副作用，偏离 `flows/change-lifecycle.md` 记录的 `DRAFT→{SCAN,BRAINSTORM}`（scan 可选）原始设计
- `2026-07-01-changes-align-sillyspec` 收敛 6 stage 含 scan（已 merge main），但重心在删 HumanGate / propose，未审视 scan 作为变更入口的合理性
- 变更流程 `StageEnum.SCAN` 与 agent 模块 workspace-scan（`run_type=scan`）是两套解耦路径，去掉前者不破坏后者

## 变更范围

- 变更流程 6 段 → 5 段（brainstorm/plan/execute/verify/archive）
- StageEnum 删 SCAN，TRANSITIONS 重构，service/parser 起点改 brainstorm
- 删 scan.md prompt + dispatch scan 配置
- 前端步骤条/筛选去 scan
- 新增未扫描 workspace 门禁
- alembic 存量迁移 + 测试更新

## 不在范围内（显式清单）

- 不改 sillyspec CLI（scan 是工具固有 stage，平台层屏蔽即可）
- 不改 agent 模块 workspace 扫描（`run_type=scan`）与 scan_docs 模块
- 不改工作区详情页扫描按钮
- 不重定位 scan 到 workspace 枚举（YAGNI）
- 不要求历史兼容（规则 10）

## 成功标准（可验证）

- **SC-1**：新建变更 `current_stage=brainstorm`（不再 scan）
- **SC-2**：变更详情页步骤条显示 5 段（无 scan 格）
- **SC-3**：已扫描 workspace 新建变更不被 scan 拦截，直接进 brainstorm
- **SC-4**：未扫描 workspace 新建变更被拦（409 + 引导先扫描）
- **SC-5**：workspace 扫描功能（工作区详情页 / agent `run_type=scan`）不受影响
- **SC-6**：后端 change/workflow 测试全通过（scan 断言改 brainstorm 后）
- **SC-7**：前端变更页测试全通过
