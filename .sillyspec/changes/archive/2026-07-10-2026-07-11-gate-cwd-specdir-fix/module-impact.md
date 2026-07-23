---
author: qinyi
created_at: 2026-07-11T01:35:00+08:00
---

# 模块影响分析 — gate-cwd-specdir-fix（P3 坑 3 修复）

## 变更概述

配合 sillyspec runGate 的 cwd/specBase 分离，修复 P3 坑 3：gate verify-test 在 daemon-client 平台模式跑不通（cwd 一肩挑两担）。SillyHub 侧 cwd=项目代码根（跑测试）+ spec_dir via --spec-dir（读 local.yaml/spec 产物）。

## 影响模块（backend 3 文件）

| 文件 | 改动 |
|---|---|
| `app/modules/daemon/run_sync/service.py` | `_resolve_gate_spec_root` 改返回 `(code_root, spec_dir)` 二元组；task-07 `_run_gate_decision_task` 解构二元组传 `_run_gate_via_delegate` |
| `app/modules/change/dispatch.py` | `_run_gate_via_delegate` 签名改 `(code_root, spec_dir, stage)`，cwd=code_root，spec_dir 非 None 时 args 加 `--spec-dir` |
| `app/modules/daemon/host_fs/delegate.py` | `_enforce_command_whitelist` 尾部 flag 白名单加 `--spec-dir`（成对+值校验防路径遍历注入） |

## 新增/改动接口

- `_resolve_gate_spec_root(gate_session, workspace, change) -> tuple[str | None, str | None]`（改返回二元组）
- `_run_gate_via_delegate(session, workspace, change_name, code_root, spec_dir, stage="verify")`（改签名，cwd=code_root + args 加 --spec-dir）
- `_GATE_VERIFY_TAIL_FLAG_WHITELIST` 加 `--spec-dir`（值校验 .. 拒注入）

## 数据模型

无新列（gate_status/gate_result P3 已加）。

## 风险等级

integration-critical（gate 调用链 + 命令白名单安全层）。design §10 R1-R5 全应对。

## 回退

纯增量可回退：_resolve_gate_spec_root 返回单值 + _run_gate_via_delegate 签名 spec_root + 白名单删 --spec-dir。回退后 gate 回到 P3 坑 3 状态（daemon-client 跑不通，但不崩）。
