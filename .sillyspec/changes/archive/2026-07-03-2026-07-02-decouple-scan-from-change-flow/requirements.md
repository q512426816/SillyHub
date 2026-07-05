---
author: qinyi
created_at: 2026-07-03 08:33:48
change: 2026-07-02-decouple-scan-from-change-flow
---

# Requirements: scan 从变更流程彻底移除

## 角色表

| 角色 | 描述 |
|---|---|
| 变更发起人 | 新建变更的用户，期望直接进入需求分析 |
| 智能体 | 执行 brainstorm/plan/execute/verify/archive 各阶段 |
| workspace owner | 负责工作区初始化扫描（工作区详情页扫描按钮） |

## 功能需求

### FR-01 变更流程收敛 5 段
StageEnum 删除 SCAN，`spec_stages()` 返回 `[brainstorm, plan, execute, verify, archive]`，TRANSITIONS 去掉 `SCAN→BRAINSTORM`。
- **Given** 变更流程的 stage 枚举
- **When** 查询 `spec_stages()`
- **Then** 返回 5 段，不含 scan

### FR-02 新建变更起点 brainstorm
`service.py:654-655` draft→brainstorm；`parser.py:589` scan→brainstorm。
- **Given** 变更 `current_stage` 为空或 draft
- **When** transition 被调用
- **Then** current 视为 brainstorm（不再 scan）

### FR-03 删除 scan stage 派发资源
删除 `prompts/scan.md`；`STAGE_AGENT_CONFIG` 删 SCAN 项；`STAGE_ORDER` 去 scan。
- **Given** dispatch 查询 scan stage 配置
- **When** `get_config_for_stage("scan")`
- **Then** 返回 None（scan 不再是变更 stage）

### FR-04 前端步骤条 5 段
`changes/[cid]/page.tsx` `WORKFLOW_STAGES` 去 scan；`changes/page.tsx` 阶段筛选去 scan。
- **Given** 用户打开变更详情页
- **When** 步骤条渲染
- **Then** 显示 5 段（需求分析/规划/执行/验证/归档）

### FR-05 未扫描 workspace 门禁
新建变更时，`workspace.last_scanned_at IS NULL` 或该 workspace 无 scan_docs → 拒绝（409）+ 引导先扫描。
- **Given** 一个从未扫描的 workspace
- **When** 用户新建变更
- **Then** 返回 409 + 「请先扫描工作区」
- **Given** 一个已扫描 workspace
- **When** 用户新建变更
- **Then** 成功，`current_stage=brainstorm`

### FR-06 存量数据迁移
alembic：`changes.current_stage='scan'` → `'brainstorm'`；`down_revision` 接当前真实 head。
- **Given** 存量变更 `current_stage=scan`
- **When** migration upgrade 执行
- **Then** `current_stage=brainstorm`

## 非功能需求

- **NFR-01** 跨平台兼容（Win/Linux/macOS），纯 Python/TS 逻辑，无 OS 相关代码
- **NFR-02** 不破坏 workspace 扫描（agent `run_type=scan` / scan_docs 模块不动）
- **NFR-03** sillyspec.db 单一真相源原则不破坏（平台层屏蔽 scan，db 记录不改）
- **NFR-04** 审核面板投影不受影响（projection 本就不投影 scan）

## 决策覆盖关系

| 需求 | 覆盖决策 |
|---|---|
| FR-01 / FR-02 / FR-03 | D-001@V1（彻底删 SCAN） |
| NFR（不重定位） | D-002@V1 |
| NFR（接受偏离 CLI） | D-003@V1 |
| FR-05 | D-004@V1（未扫描门禁） |
| FR-06 | D-005@V1（存量重置） |
