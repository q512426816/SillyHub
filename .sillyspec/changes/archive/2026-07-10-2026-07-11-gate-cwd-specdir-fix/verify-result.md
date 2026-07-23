---
author: qinyi
created_at: 2026-07-11T01:30:00+08:00
---

# 验证报告 — gate-cwd-specdir-fix（P3 坑 3 修复）

## 结论

**PASS WITH NOTES**

代码实现 + 测试全绿（6 task，backend 777+56 passed 零回归）。SillyHub 侧配合 sillyspec runGate cwd/specBase 分离（machine-interface.js:107 + index.js:323 接线）已就绪。真实 daemon-client e2e（gate verify-test 27s）待 sillyspec gate npm publish 发版（design §10 R4）。

## 任务完成度

6/6 task 全完成（plan.md 6 task）：

| task | 内容 | FR |
|---|---|---|
| task-01 | _resolve_gate_spec_root 改返回 (code_root, spec_dir) 二元组 | FR-1 ✓ |
| task-02 | _run_gate_via_delegate 签名 (code_root, spec_dir) + cwd=code_root + args 加 --spec-dir | FR-2 ✓ |
| task-03 | _enforce_command_whitelist 尾部放行 --spec-dir（值校验防注入 R3） | FR-3 ✓ |
| task-04 | task-07 _run_gate_decision_task 适配（解构二元组） | FR-4 ✓ |
| task-05 | 测试适配（7 测试 + task-07 mock） | FR-5 ✓ |
| task-06 | 新测试（白名单 --spec-dir 注入拒 + cwd=code_root） | AC-1/2 ✓ |

## 设计一致性

design §4.5（方案 A --spec-dir 尾部）+ §5（总体方案）+ §7（接口签名）+ §7.5（生命周期契约表，gate 执行 RPC cwd/specBase 分离）+ §10（R1-R5 风险）全实现一致。R1 注入（值校验 .. 拒）/ R2 sillyspec 接线（index.js:323 已改+45 测试绿）/ R3 SpecWorkspace 复用 / R4 e2e 待发版 / R5 白名单仅扩 --spec-dir。

## 探针结果

- `_resolve_gate_spec_root` 返回 `tuple[str | None, str | None]`（service.py，二元组）✓
- `_run_gate_via_delegate` 签名 `(session, workspace, change_name, code_root, spec_dir, stage)`（dispatch.py）+ cwd=code_root + spec_dir 非 None 时 args 加 `--spec-dir` ✓
- `_enforce_command_whitelist` 白名单 `{"--stage", "--spec-dir"}`（delegate.py）+ while 循环 --spec-dir 值校验（.. 拒）✓
- sillyspec gate CLI index.js:323 接线 specBase（已改本会话 + 45 测试绿，待 sillyspec commit/push）✓

## 测试结果

主仓库（apply + commit fab9ff6c 后）全绿零回归：

- **gate 测试 56 passed**（test_delegate_run_command 21 含 task-06 TestGateSpecDirWhitelist 2 case 拒注入 + test_gate_via_delegate 8 + test_run_sync_gate_decision_task + test_gate_e2e）
- **change/daemon 模块 777 passed**（零回归，2 skip 预存 propose 债）
- **mypy 446 files 0 issue** + **ruff All checks passed**

## 变更风险等级

**integration-critical**（design 含 gate/daemon/session/agent_run/lifecycle 关键词）。

design §10 R1-R5 全应对（见上）。

## Runtime Evidence（integration-critical 必填）

### 已验证（代码 + mock 测试）

- **AC-1 gate daemon-client 跑通（cwd=code_root + specBase=specDir via --spec-dir）**：test_gate_via_delegate.py 7 测试断言 cwd="/code/root"（code_root，非 spec_dir）+ args 含 `--spec-dir /spec/dir`。_run_gate_via_delegate 签名 code_root+spec_dir，cwd=code_root 跑测试，spec_dir via --spec-dir 让 sillyspec gate specBase 读 specDir local.yaml。
- **AC-2 --spec-dir 注入拒**：test_delegate_run_command.py TestGateSpecDirWhitelist（task-06 新增）—— `--spec-dir ../../../etc/passwd` 路径遍历 raise HostFsDelegateError + `--spec-dir` 缺值 raise（白名单 within allowed roots + 成对校验）。
- **AC-3 现有测试零回归**：test_gate_via_delegate 7 测试改参数（spec_root→code_root+spec_dir）+ task-07 mock 适配，change/daemon 777 passed 零回归。
- **AC-4 brownfield fallback**：_resolve_gate_spec_root 无 SpecWorkspace 时返回 (code_root, None)，_run_gate_via_delegate spec_dir=None 不加 --spec-dir（gate specBase 走默认 resolveSpecDir(code_root)，local 模式兼容）。
- **AC-5 server-local gate 仍 raise**：task-01 _enforce_command_whitelist 不变 server-local raise（gate 必须 daemon 跑）。

### 待真实集成验证（design §10 R4 硬前置）

1. **真实 daemon-client + sillyspec gate verify 27s e2e**——cwd=workspace.root_path（cd backend 成功）+ specBase=SpecWorkspace.spec_root（local.yaml 读到）+ gate verify-test 跑项目测试。待 sillyspec gate npm publish 发版（本机 npm link 开发版可用）。
2. **sillyspec gate CLI index.js:323 接线 specBase 待 commit/push**（sillyspec 仓库）—— SillyHub 侧方案 A 跑通的前提，本会话已改 + sillyspec 45 测试绿。
3. **生产 PG migration apply**：本变更无新 migration（P3 task-04 已加 gate 列），无 PG 影响。

### 阻断降级说明

本变更修复 gate 在 daemon-client 跑不通的坑 3（cwd 一肩挑两担）。修复后 gate verify-test 能在项目代码根跑测试 + 从 specDir 读 local.yaml。sillyspec gate 未发版时 verify stage 仍走 Z1 阻断（design §5.6，不变）。本变更是 P3 gate 真跑的 SillyHub 侧前置修复。
