---
author: qinyi
created_at: 2026-09-07 13:50:00
plan_level: full
---

# 实现计划（Plan）— 变更中心冲突对比弹窗 + quick 条目 ql 编号展示

> 来源：design.md（Grill 三轮终审 pass）+ requirements.md（FR-01~10）+ decisions.md（D-001~004）。
> 技术不确定性低（RPC/diff/弹窗全有仓内先例，Grill 已实测全部锚点），无 Spike。

## Wave 1（并行，无依赖）
- task-01
- task-03

## Wave 2（依赖前序 Wave）
- task-02
- task-04

## Wave 3（依赖前序 Wave）
- task-05

## Wave 4（依赖前序 Wave）
- task-06

## Wave 5（依赖前序 Wave）
- task-07
- task-08

## Wave 6（依赖前序 Wave）
- task-09

## Wave 7（依赖前序 Wave）
- task-10
- task-11

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon 快照 RPC 测试先行 | W1 | P0 | — | FR-07, FR-08 | conflictSnapshot/ql_id/截断/防逃逸用例 |
| task-02 | daemon conflictSnapshot + RPC 注册 + ql_id 心跳补报 | W2 | P0 | task-01 | FR-01, FR-05, D-001@v1, D-004@v1 | sillyspec-manager.ts + daemon.ts |
| task-03 | backend compare 测试先行 | W1 | P0 | — | FR-06, FR-07, FR-08 | 权限/白名单/504/diff/截断/containment |
| task-04 | backend compare service + 端点 + DTO ql_id | W2 | P0 | task-03 | FR-02, FR-03, FR-06, D-001@v1 | sillyspec_compare.py + router.py |
| task-05 | gen:types 重新生成类型 | W3 | P0 | task-04 | FR-10 | api-types.ts + openapi.json 同变更提交 |
| task-06 | frontend 弹窗与行改造测试先行 | W4 | P0 | task-05 | FR-02, FR-03, FR-04 | modal 新测 + section 适配 + 总览卡 ql 标题单测 |
| task-07 | frontend compare 弹窗实现 | W5 | P0 | task-05, task-06 | FR-02, FR-03, FR-04, FR-09, D-002@v1, D-003@v1 | conflict-compare-modal.tsx + lib/daemon.ts |
| task-08 | 冲突行改造 + 总览卡 ql 标题 | W5 | P0 | task-05, task-06 | FR-01, FR-05, FR-06, D-004@v1 | platform-sync-section.tsx + changes-overview-card.tsx |
| task-09 | 三端本变更测试与类型检查全跑 | W6 | P0 | task-02,04,07,08 | 全局 | vitest×2 + pytest + tsc×2 |
| task-10 | 实机集成验收（3 条存量冲突链路） | W7 | P0 | task-09 | FR-01~06 | integration-critical 证据：弹窗→对比→裁决下发 |
| task-11 | 模块文档更新 | W7 | P1 | task-09 | — | modules/sillyhub-daemon.md + backend.md |

## 关键路径

task-03 → task-04 → task-05 → task-07 → task-09 → task-10（backend schema 是前端开工的咽喉；集成验收是交付咽喉）

## 全局验收标准

1. 三端本变更相关测试全绿（仅跑相关测试，全量留 CI）；frontend/daemon tsc 通过。
2. 集成冒烟（integration-critical 强制）：本机 daemon 在线实跑——3 条存量冲突行只显示「查看对比」；spec 树冲突弹窗可见文件清单 + 左右 diff 高亮；进度冲突弹窗可见关键信息对比表；弹窗内「保本地/取平台」二次确认后下发成功并关闭。
3. 权限负例：非机器所有者且非管理员用户看不到「查看对比」，直接调 compare 端点返回 404。
4. 存量 quick 冲突（guard.json 已清）标题兜底显示原始 ID（D-004 已知限制，不算失败）；新增 quick 冲突能显示 ql 编号。
5. 未触发本功能时现有行为不变：裁决通道、ghost 清理、心跳投影三字段语义不变（ql_id 为新增可选字段）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-04 | 集成验收 task-10：弹窗实时拉到双方内容 |
| D-002@v1 | task-07, task-08 | 行上无裁决按钮；弹窗底部裁决可用 |
| D-003@v1 | task-07 | 进度弹窗为对比表非 JSON |
| D-004@v1 | task-02, task-08 | 心跳 ql_id 透出；行标题 ql 规则+兜底 |
| FR-01 | task-08 | 行改造+离线禁用 |
| FR-02 | task-07 | spec 弹窗文件清单+diff |
| FR-03 | task-07 | 进度对比表 |
| FR-04 | task-07 | 弹窗裁决复用 resolve 通道 |
| FR-05 | task-02, task-08 | ql 标题链路与兜底 |
| FR-06 | task-04, task-08 | 权限契约统一+404 |
| FR-07 | task-02, task-04 | 四道截断护栏测试 |
| FR-08 | task-02, task-04 | realpath/containment 测试 |
| FR-09 | task-04, task-07 | 15s 超时+loading/重试态 |
| FR-10 | task-05 | gen:types 产物入库 |
