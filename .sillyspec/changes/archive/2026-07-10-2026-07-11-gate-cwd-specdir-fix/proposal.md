---
author: qinyi
created_at: 2026-07-11T23:30:00+08:00
---

# 提案 — gate-cwd-specdir-fix

## 问题

P3 driver gate pilot 的坑 3（SillyHub 侧）：gate verify-test 在 daemon-client 平台模式跑不通。sillyspec `runGate` 原本 cwd 一肩挑两担（跑测试 + 读 local.yaml），SillyHub 传什么都错——cwd=specDir 则 `cd backend` 找不到代码，cwd=项目根则 local.yaml 找不到。

## 方案

配合 sillyspec `runGate` 的 cwd/specBase 分离（`machine-interface.js:107` + `index.js:323` 接线）：SillyHub 侧 `cwd=workspace.root_path`（项目代码根，跑测试）+ `--spec-dir=SpecWorkspace.spec_root`（specDir，读 local.yaml/spec 产物）。命令白名单（R3）放行 `--spec-dir`（值校验防注入）。

## 影响

- `dispatch.py`（_run_gate_via_delegate 改签名）
- `run_sync/service.py`（_resolve_gate_spec_root 改返回二元组 + task-07 适配）
- `delegate.py`（_enforce_command_whitelist 尾部放行 --spec-dir）
- 测试适配（test_gate_via_delegate.py 7 测试 + test_run_sync_gate_decision_task.py mock）

## 前置

sillyspec gate CLI `index.js:323` 接线 specBase（已改本会话 + 45 测试绿，待 sillyspec 仓库 commit/push）。

## Non-Goals

- gate 真实 e2e 联调（待 sillyspec gate npm publish R4）
- `_resolve_gate_spec_root` 的 SpecWorkspace 解析逻辑重构（只改返回结构）
- server-local 跑 gate（task-01 仍 raise，不变）

## 关联

- P3 driver gate pilot（`archive/2026-07-10-...`，坑 3 follow-up）
- `docs/sillyspec/local.yaml-gate-pitfalls.md`（坑 3 记录）
