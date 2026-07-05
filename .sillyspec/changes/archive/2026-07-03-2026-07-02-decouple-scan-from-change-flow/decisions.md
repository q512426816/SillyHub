---
author: qinyi
created_at: 2026-07-03 08:33:48
change: 2026-07-02-decouple-scan-from-change-flow
---

# Decisions: scan 从变更流程彻底移除

> 决策台账。稳定 ID 格式 `D-xxx@V1`（大写 V，遵循 sillyspec 决策 ID 校验）。

## D-001@V1 — scan 从变更流程彻底移除（方案 A）

- **决策**：StageEnum 删 SCAN，变更收敛 5 段（brainstorm/plan/execute/verify/archive），新建变更从 brainstorm 起
- **理由**：用户明确「彻底移除 + 最简彻底」；状态机最干净，无死状态
- **排除的替代方案**：
  - 方案 B（保留 SCAN 枚举、默认绕过）——留不被走的死状态，语义不彻底
  - 方案 C（scan 重定位到 workspace 枚举）——见 D-002

## D-002@V1 — 不重定位 scan 到 workspace 枚举

- **决策**：排除方案 C，不为 scan 新建 workspace 级 StageEnum
- **理由**：scan 在 agent 模块已用 `run_type=scan` 解耦承载，再搞枚举属过度设计（YAGNI）

## D-003@V1 — 接受 StageEnum 偏离 sillyspec CLI 的 stage

- **决策**：平台 StageEnum 5 段，不再和 sillyspec CLI 的 6 stage（含 scan）一一对应
- **理由**：平台层屏蔽 CLI 的 scan stage 不影响功能（sillyspec.db 仍记录 CLI stage，平台只读不写）；变更流程语义清晰优先于枚举对齐
- **影响**：changes-align-sillyspec 的「6 stage 完全对齐工具契约」在此点被修正（仅 scan 项）

## D-004@V1 — 新增未扫描 workspace 门禁

- **决策**：新建变更时检查 workspace 是否已扫描，未扫描（`last_scanned_at IS NULL` 或无 scan_docs）则拒绝（409）+ 引导先扫描
- **理由**：scan 移除后，未扫描 workspace 直接进 brainstorm 会缺项目地图，质量风险；门禁仅拦「从未扫描」的 workspace，已扫描的不受影响，与用户「不要被扫描烦扰」诉求不矛盾

## D-005@V1 — 存量 current_stage=scan 一律迁移到 brainstorm

- **决策**：alembic 一律迁移，不要求历史兼容
- **理由**：CLAUDE.md 规则 10，项目未上线允许重置开发/测试数据
