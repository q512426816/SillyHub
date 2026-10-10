---
author: qinyi
created_at: 2026-10-10T15:53:00+08:00
plan_level: light
execution_mode: main
---

# 轻量计划（Light Plan）：借用沙箱工作区上下文感知

## 来源

brainstorm 四件套（.sillyspec/changes/2026-10-10-borrow-sandbox-workspace-context/
下 design.md / proposal.md / requirements.md / decisions.md D-001~D-005）。独立
设计审查 review-2026-10-10-154531 双 pass，0 blocker，P3 备忘 4 条由对应任务
吸收（空 dict 归一 None 归 task-01；Workspace 模型字段存在性核验归 task-01
实现首步；测试绑定归各实现卡 acceptance）。

## 范围

- backend/app/modules/agent/placement.py —— 借用上下文 loader +
  `_stamp_borrow_sandbox_metadata` 第 4 参 + 三标记点接线（:512/:934/:1096）
- backend/app/modules/daemon/lease/context.py —— build_claim_payload
  interactive 分支白名单透传 `borrow_workspace_context`
- sillyhub-daemon/src/types.ts —— LeaseCtx 可选字段 `borrowWorkspaceContext`
- sillyhub-daemon/src/daemon.ts —— 归一化双读 + marker 分支渲染落盘（fail-open）
- NEW:sillyhub-daemon/src/borrow-sandbox-context.ts —— 渲染纯函数 + 文件名常量
- 测试：backend/app/modules/agent/tests/test_placement_borrow_integration.py、
  claim payload 透传测试（task-02 定位具体文件）、
  NEW:sillyhub-daemon/tests/borrow-sandbox-context.test.ts、
  sillyhub-daemon/tests/daemon-borrow-sandbox.test.ts

## 验收

- FR-01 满足：三标记点写 borrow_workspace_context、字段集正确、Workspace 缺行
  不阻塞不写键。
- FR-02 满足：AGENTS.md 含真实 root_path 与可读禁写声明；write-guard 零改动。
- FR-03 满足：claim payload 白名单透传 + daemon 归一化双读。
- FR-04 满足：AGENTS.md 落沙箱根；渲染失败 fail-open；旧 backend 无键不渲染。
- FR-05 满足：非借用 lease 零新键；新 backend 对旧 daemon 下发新键无害。
- 借用 agent 可基于 AGENTS.md 答出工作区名称/代码路径（人工抽查一次）。
- 相关面测试全绿：backend 借用相关 pytest 文件 + daemon 借用相关 vitest 文件
  + `pnpm typecheck`（daemon tsc 0 错）。禁止全量测试（CLAUDE.md 规则 0）。
- 写守卫（write-guard.ts）零改动——git diff 不含该文件。

## 覆盖矩阵（如存在 decisions.md）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-03 | 字段集含 root_path；AGENTS.md 可读禁写声明 |
| D-002@v1 | task-01, task-02, task-03 | lease 单键 → claim payload → 双读归一化全链 |
| D-003@v1 | task-03, task-04 | 模板固定 daemon 侧；write-guard 零 diff |
| D-004@v1 | task-04 | 渲染失败 warn 不阻塞断言 |
| D-005@v1 | task-01, task-02, task-04 | 缺键不写/不透传/不渲染断言 + 非借用零新键 |
