---
author: qinyi
created_at: 2026-07-11T23:30:00+08:00
---

# 需求 — gate-cwd-specdir-fix

## 功能需求

- **FR-1**：`_resolve_gate_spec_root` 改返回 `(code_root, spec_dir)` 二元组——daemon-client: code_root=workspace.root_path + spec_dir=SpecWorkspace.spec_root；server-local: (None, None)；brownfield: spec_dir fallback code_root/.sillyspec
- **FR-2**：`_run_gate_via_delegate` 改签名 `(session, workspace, change_name, code_root, spec_dir, stage)`，cwd=code_root，spec_dir 非 None 时 args 加 `--spec-dir <spec_dir>`
- **FR-3**：`_enforce_command_whitelist` 尾部 flag 白名单加 `--spec-dir`（成对 flag+value，值校验非空 + within allowed roots，R3 安全）
- **FR-4**：task-07 `_run_gate_decision_task` 适配（解构 code_root/spec_dir）
- **FR-5**：测试适配（test_gate_via_delegate.py 7 测试 + test_run_sync_gate_decision_task.py mock 签名）

## 验收标准

- **AC-1**：gate verify-test 在 daemon-client 跑通——cwd=项目代码根（cd backend 成功）+ specBase=specDir（local.yaml 读到）
- **AC-2**：`--spec-dir` 注入被拒（白名单 within allowed roots；恶意 spec_dir 路径 raise HostFsDelegateError）
- **AC-3**：现有测试适配零回归（test_gate_via_delegate 7 测试改参数 + task-07 mock 签名 + backend 全量绿）
- **AC-4**：brownfield（无 SpecWorkspace）fallback——不加 --spec-dir，gate specBase=resolveSpecDir(code_root)，兼容
- **AC-5**：server-local gate 仍 raise（不变）

## 非目标

- gate 真实 e2e（待 sillyspec gate npm publish R4）
- _resolve_gate_spec_root 的 SpecWorkspace 解析逻辑重构（只改返回结构）
