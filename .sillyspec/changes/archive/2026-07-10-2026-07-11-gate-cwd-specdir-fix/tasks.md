---
author: qinyi
created_at: 2026-07-11T23:30:00+08:00
---

# 任务列表 — gate-cwd-specdir-fix（初步，plan 阶段拆 Wave + TaskCard）

> 实现细节见 design.md §5/§7。plan 阶段细化 Wave 分组 + 同文件串行。

## task-01: _resolve_gate_spec_root 分离返回 (code_root, spec_dir)
- 文件：`run_sync/service.py`
- 改：返回二元组（daemon-client: workspace.root_path + SpecWorkspace.spec_root；server-local: None,None；brownfield: fallback code_root/.sillyspec）
- 依赖：无

## task-02: _run_gate_via_delegate 改签名 + cwd=code_root + args 加 --spec-dir
- 文件：`dispatch.py`
- 改：签名 `(session, workspace, change_name, code_root, spec_dir, stage)`，cwd=code_root，spec_dir 非 None 时 args 加 `--spec-dir`
- 依赖：task-01（code_root/spec_dir 来源）

## task-03: _enforce_command_whitelist 尾部放行 --spec-dir
- 文件：`delegate.py`
- 改：尾部 flag 白名单加 `--spec-dir`（成对+值校验 within allowed roots，仿 --stage 模式）
- 依赖：无（与 task-02 同改白名单相关，但 delegate.py 独立）

## task-04: task-07 _run_gate_decision_task 适配
- 文件：`run_sync/service.py`
- 改：解构 `_resolve_gate_spec_root` 二元组，传 `_run_gate_via_delegate`
- 依赖：task-01（_resolve_gate_spec_root 改）+ task-02（_run_gate_via_delegate 签名）

## task-05: 测试适配（改参数 + mock 签名）
- 文件：`test_gate_via_delegate.py`（7 测试 spec_root→code_root+spec_dir）+ `test_run_sync_gate_decision_task.py`（mock 签名）+ `test_gate_e2e.py`（mock）
- 依赖：task-02（签名定）

## task-06: 新增测试（白名单 --spec-dir + cwd/spec_dir 分离 + 注入拒）
- 文件：`test_delegate_run_command.py`（白名单 --spec-dir 放行+拒恶意）+ `test_gate_via_delegate.py`（cwd=code_root 传对）
- 依赖：task-01/02/03

## 关键路径

task-01 → task-02 → task-04 → task-05/06（_resolve_gate_spec_root 改返回 → _run_gate_via_delegate 签名 → task-07 适配 → 测试）。

## 同文件串行

- `run_sync/service.py`：task-01（_resolve_gate_spec_root）→ task-04（task-07 适配）
- `dispatch.py`：task-02（_run_gate_via_delegate）
- `delegate.py`：task-03（白名单）
