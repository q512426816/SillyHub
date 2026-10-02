---
author: qinyi
created_at: 2026-09-20T19:58:00
plan_level: full
---
# 实现计划（Plan）— 2026-09-20-scope-audit-cross-repo-platform

## Spike 前置验证
无——上游契约 v2 已在 sillyspec 仓定稿并归档（接口定义节即权威），平台侧为确定性消费改造，无技术不确定性需要 Spike。

## Wave 1（并行，无依赖）
- task-01
- task-02

## Wave 2（依赖 Wave 1）
- task-03

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon 投影契约 v2（cross_repo + repos[]） | W1 | P0 | — | FR-01, FR-02, D-001@v1, D-004@v2 | SillySpecAuditRow.cross_repo + SillySpecAuditRepo 族接口 + auditTable 投影（repoPath 白名单排除）+ daemon 测试 |
| task-02 | backend schema 与透传 | W1 | P0 | — | FR-03, D-002@v1 | ScopeAuditRow.cross_repo + ScopeAuditRepo 族 pydantic + get_scope_audit 透传 + backend 测试 |
| task-03 | gen:types 与前端按仓分组 | W2 | P0 | task-01,02 | FR-04, FR-05, FR-06, D-003@v1, D-005@v1 | gen:types（api-types.ts + openapi.json）+ 对账卡按仓分段/明细分节/回退 + 前端测试（含 mobile 回归） |

## 关键路径
task-02 → task-03（gen:types 依赖 backend schema 落地；task-01 与关键路径并行，task-03 同时消费其投影契约）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- `repoPath` 不出 daemon——投影白名单封闭（D-001@v1：本地路径隐私，ql-20260911-003-355a 先例）
- 全链 additive 兼容零版本门禁（D-002@v1）：旧 CLI（无 repos 键）/旧 daemon/旧 backend → 前端回退现状单段渲染；不新增 sillyspec_capability_missing 类错误
- 主仓行形状逐字段不变；单仓变更端到端与现状等价（回归测试钉住）
- chips 计数一律取 `repos[].totals`（CLI 单一源，不前端重算）
- `anchor_label` 短化只在 daemon 投影层生成：base 命中 `^[0-9a-f]{7,40}$` → slice(0,7)；语义锚/无 base → null；`anchor.label` 档位文案原样透传并始终并行渲染（D-004@v2）
- gen:types 纪律（规则 21）：先 `pnpm exec tsc --version` 预检 node_modules（坏则 `pnpm install --force`）；`api-types.ts` + `backend/openapi.json` 同一变更内提交；伴生产物只提交相关 diff
- 禁止跑全量测试，仅跑本次修改相关的测试（CLAUDE.md 规则 0）
- 错误/界面文案一律中文；代码兼容 Windows/Linux/macOS
- 不改 RPC method 名/端点路径/权限模型/错误映射族；quick 模式链路不动

## 全局验收标准
1. 三层相关测试全绿（daemon sillyspec-file-diff.test.ts / backend test_scope_file_diff.py / frontend scope-audit-command-card.test.tsx + mobile-change-detail.test.tsx 与 quicklog-drawer.test.tsx 回归）
2. 任务书验收：f85a6650 类多仓变更对账卡显示主仓段 + 各跨仓段真实三态与锚点档（分组渲染测试夹具钉住）
3. 单仓变更/旧链路回退：端到端渲染与现状等价（回退用例断言）
4. `pnpm gen:types` 零漂移（api-types.ts 含 cross_repo/repos 字段）
5. daemon `pnpm typecheck`、backend ruff/mypy（改动面）零新错
