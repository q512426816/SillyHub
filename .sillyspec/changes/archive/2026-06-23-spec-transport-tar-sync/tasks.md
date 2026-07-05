---
author: qinyi
created_at: 2026-06-23 10:38:24
change: 2026-06-23-spec-transport-tar-sync
---

# Tasks: spec 文档回传 backend 独占（transport 双模式）

> 任务只列名称 + 文件路径 + 覆盖 FR/D-xxx@v1，细节（Wave 依赖、验收、AC）在 plan 阶段展开。
> **决策覆盖声明**：本变更全部决策 D-001@v1 D-002@v1 D-003@v1 D-004@v1 D-005@v1 D-006@v1 D-007@v1 均被以下任务覆盖（D-005@v1 数据可清约束体现在 task-07 回退路径，无独立任务）。

## Wave 1: scan 链路打通

- [ ] task-01: backend config 加 `spec_transport` 字段（读 `SPEC_TRANSPORT`，默认 shared，枚举校验） — `backend/app/core/config.py` — FR-01, D-001@v1, D-002@v1
- [ ] task-02: 新增 `resolve_prompt_spec_root` helper + `build_scan_bundle` 按 transport 分支（shared 宿主路径保持现状） — `backend/app/modules/agent/context_builder.py` — FR-02, FR-03, D-001@v1, D-004@v1, D-006@v1
- [ ] task-03: `build_claim_payload` interactive 分支 tar 模式透传 `workspace_id` + `transport`、不透传 `spec_root` — `backend/app/modules/daemon/lease/context.py` — FR-04, D-007@v1
- [ ] task-04: 新增 `spec-sync.ts` 共享 utility（`pullSpecBundle`/`packSpecDir`/`resolveSpecDir`/`postSpecSync`，含首次 pull 404 容错） — `sillyhub-daemon/src/spec-sync.ts`（新增） — FR-05, FR-06, D-003@v1, D-007@v1
- [ ] task-05: `task-runner.ts` `runLease` 改调 spec-sync utility（batch 行为不变，纯重构） — `sillyhub-daemon/src/task-runner.ts` — D-007@v1
- [ ] task-06: `daemon.ts` `_startInteractiveSession` tar 模式 pull + `onSessionEnd` tar 模式 `postSpecSync` — `sillyhub-daemon/src/daemon.ts` — FR-05, FR-06, D-003@v1, D-004@v1, D-007@v1
- [ ] task-07: 确认 `/spec-workspace/sync` 端点对 platform-managed + tar 放行；`apply_sync` 复用无改动；回退路径（清 SPEC_TRANSPORT + 重 scan，D-005@v1 数据可清） — `backend/app/modules/spec_workspace/router.py`, `service.py` — FR-07, D-005@v1, R-05
- [ ] task-08: 修正 `test_context_builder` 行 142/162 + 新增 transport 分支断言 — `backend/tests/modules/agent/test_context_builder.py` — FR-08, D-006@v1
- [ ] task-09: 新增 daemon spec-sync + interactive 接入测试；backend `build_claim_payload` tar 透传测试 — `sillyhub-daemon/tests/`, `backend/tests/` — FR-04, FR-05, FR-06

## Wave 2: 全 spec 写盘链路（stage）

- [ ] task-10: `start_stage_dispatch` `platform_args` 按 transport 分支（复用 helper） — `backend/app/modules/agent/service.py` — FR-03, D-001@v1
- [ ] task-11: stage 链路测试（propose/plan/execute 走 interactive，复用 Wave1 的 spec-sync） — `backend/tests/`, `sillyhub-daemon/tests/` — FR-03, D-007@v1

## Wave 3: 验证 + 文档

- [ ] task-12: 端到端验证 `SPEC_TRANSPORT=tar` 异机拓扑 scan 全流程文件落 backend `/data/{ws}` — 手动/integration — SC-2, SC-3, SC-4
- [ ] task-13: scan 文档同步（ARCHITECTURE/CONVENTIONS 更新 transport 双模式） — `.sillyspec/docs/` — SC-1
