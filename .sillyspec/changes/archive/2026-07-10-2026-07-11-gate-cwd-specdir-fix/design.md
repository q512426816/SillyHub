---
author: qinyi
created_at: 2026-07-11T23:30:00+08:00
scale: small
---

# 设计文档 — gate-cwd-specdir-fix（P3 坑 3 SillyHub 侧修复）

## 1. 背景

P3 driver gate pilot（2026-07-10）实现 verify 阶段客观核验：gate verify-test 读 local.yaml `commands.test` 在 daemon 侧跑项目测试。sillyspec `runGate` 原本 cwd 一肩挑两担（既跑测试又读 local.yaml），daemon-client 平台模式下 SillyHub 传什么都错（P3 坑 3）：

- cwd=specDir（`~/.sillyhub/.../`）→ 跑测试 `cd backend` 失败（specDir 只有 spec 文档无代码）
- cwd=项目代码根 → 读 local.yaml 找不到（local.yaml 在 specDir，不在项目根/.sillyspec）

sillyspec 侧已改（`machine-interface.js:107` runGate 分离 cwd + specBase，`index.js:323` gate CLI 接线 specBase 透传 + `--spec-dir` 全局选项 `:161`）。SillyHub 侧需配合：cwd=项目代码根 + `--spec-dir`=specDir。

## 2. 设计目标

gate verify-test 在 daemon-client 平台模式下真跑通：
- **cwd（跑测试）= 项目代码根**（`workspace.root_path`，有 backend/frontend）
- **specBase（读 local.yaml/spec 产物）= specDir**（`SpecWorkspace.spec_root`）
- **命令白名单（R3）放行 `--spec-dir`**（值校验防注入）

## 3. 非目标

- gate 真实 e2e 联调（待 sillyspec gate npm publish，design §10 R4）
- `_resolve_gate_spec_root` 的 SpecWorkspace 解析逻辑重构（只改返回结构，解析规则不变）
- server-local 跑 gate（task-01 仍 raise，不变）

## 4. 拆分判断

无需拆分。单一目标（gate cwd/spec_dir 分离），~5 task，不满足拆分/批量。

## 4.5 决策/方案选择

**3 方案对比**（--spec-dir 传递方式 + 白名单改法）：

| 方案 | 做法 | 白名单改动 | 评估 |
|---|---|---|---|
| **A（选定）** | `--spec-dir` 尾部（gate verify 子命令选项位置，sillyspec :161 全局解析任意位置） | 头部不动，尾部加 `--spec-dir`（成对 flag+value，值校验 within allowed roots） | 符合 task-01 现有白名单结构（头部固定 + 尾部 flag），改动小，安全面扩最小（R5） |
| B | `--spec-dir` 全局（gate 前，args 头部） | 头部放行 `--spec-dir`（args[0] 检查改） | 符合 sillyspec 全局选项惯例，但白名单头部改大，安全损失 |
| C | 环境变量 `SILLYSPEC_SPEC_DIR`（env 注入，args 不变） | 白名单不改 | 最安全（不扩命令面），但 sillyspec runGate specBase 默认 `resolveSpecDir(cwd)` 不读 env，不支持 |

**选 A 理由**：白名单头部不动（R5 安全面扩最小）+ 尾部 `--spec-dir` 成对值校验（R1 注入防护）+ sillyspec `:161` 全局解析 + `:323` 透传 runGate.specBase（接线已就绪，本会话改 + 45 测试绿）。B 否决（头部扩面，安全损失大），C 否决（sillyspec 不支持 env specBase）。

## 5. 总体方案（方案 A：--spec-dir 尾部）

### 5.1 _resolve_gate_spec_root 分离返回 (code_root, spec_dir)

`run_sync/service.py` 的 `_resolve_gate_spec_root` 改返回二元组：

- **daemon-client**：`code_root = workspace.root_path`（宿主代码根）+ `spec_dir = SpecWorkspace.spec_root`（平台 specDir，有 local.yaml/spec 产物）
- **server-local**：不跑 gate（task-01 raise），返回 `(None, None)`
- **brownfield（无 SpecWorkspace）**：`spec_dir` fallback `code_root/.sillyspec`（local 模式兼容，gate specBase=resolveSpecDir(code_root)）

### 5.2 _run_gate_via_delegate cwd=code_root + args 加 --spec-dir

`dispatch.py` 的 `_run_gate_via_delegate(session, workspace, change_name, code_root, spec_dir, stage="verify")`：

- `args = ["gate", stage, "--change", change_name, "--json"]`，`spec_dir` 非 None 时追加 `["--spec-dir", spec_dir]`
- `cwd = code_root`（跑测试，gate 在项目代码根跑）
- `timeout = 720`（不变）
- sillyspec `:161` 全局解析 `--spec-dir`（任意位置）+ `:323` 透传 `runGate.specBase`

### 5.3 命令白名单放行 --spec-dir（R3 安全）

`delegate.py` 的 `_enforce_command_whitelist` 尾部 flag 白名单加 `--spec-dir`：

- 成对 flag+value（同 `--stage` 模式，:799-815）
- 值校验：非空 + within allowed roots（防注入；backend 构造 args 时 `spec_dir` 受控 = `SpecWorkspace.spec_root`，daemon handler `assertWithinAllowedRoots` 兜底）

### 5.4 task-07 适配

`_run_gate_decision_task` 调 `_resolve_gate_spec_root` 解构 `(code_root, spec_dir)`，传 `_run_gate_via_delegate`。

## 6. 文件变更清单

| 文件 | 改动 |
|---|---|
| `backend/app/modules/daemon/run_sync/service.py` | `_resolve_gate_spec_root` 改返回 `(code_root, spec_dir)` 二元组 |
| `backend/app/modules/change/dispatch.py` | `_run_gate_via_delegate` 签名改 `code_root`+`spec_dir`，cwd=code_root，args 加 `--spec-dir` |
| `backend/app/modules/daemon/host_fs/delegate.py` | `_enforce_command_whitelist` 尾部 flag 白名单加 `--spec-dir`（成对+值校验） |

## 7. 接口定义

### _resolve_gate_spec_root（改返回）

```python
async def _resolve_gate_spec_root(
    self, gate_session, workspace, change
) -> tuple[str | None, str | None]:
    """返回 (code_root, spec_dir)。
    daemon-client: (workspace.root_path, SpecWorkspace.spec_root)
    server-local: (None, None)（gate 不跑，task-01 raise）
    brownfield: (workspace.root_path, workspace.root_path/.sillyspec)
    """
```

### _run_gate_via_delegate（改签名）

```python
async def _run_gate_via_delegate(
    session, workspace, change_name, code_root, spec_dir, stage="verify"
) -> dict:
    args = ["gate", stage, "--change", change_name, "--json"]
    if spec_dir:
        args += ["--spec-dir", spec_dir]
    # delegate.run_command(command="sillyspec", args=args, cwd=code_root, timeout=720)
```

## 7.5 生命周期契约表

**本变更不引入新生命周期契约**——只改 `_run_gate_via_delegate` 的 cwd/spec_dir 传递方式（cwd 从 specDir 改 code_root + args 加 `--spec-dir`），gate 决策流程的状态流转不变（close→enqueue→gate_task→cas→跑 gate→存 result→内联 sync/auto_dispatch，P3 design §7.5 已定义）。

仅「gate 执行 RPC」一个事件的字段变化（cwd/specBase 分离），状态变化无：

| 事件 | 发起方 | 接收方 | 必需字段（本变更改） | 状态变化 |
|---|---|---|---|---|
| gate 执行（RPC）| backend HostFsDelegate | daemon run_command | command=sillyspec, args=[gate,verify,--change,name,--json,**--spec-dir**,spec_dir], **cwd=code_root**（原 spec_root）, timeout=12min | 无（gate 跑，cwd 从 specDir 改 code_root；spec_dir 通过 --spec-dir 传，gate specBase 读 local.yaml 从 specDir）|

其余 7 个生命周期事件（close_interactive_run / gate enqueue / gate 完成 / auto_dispatch 决策 / gate 打回 exit1 / gate 失败 / reconcile 重启）**完全不变**——本变更不触碰这些事件的状态流转，详见 P3 design §7.5（`archive/2026-07-10-2026-07-10-p3-driver-gate-pilot/design.md`）。

## 8. 数据模型

无新列（`gate_status`/`gate_result` P3 task-04 已加）。

## 9. 兼容策略

- `spec_dir` None（server-local 或 brownfield 无 SpecWorkspace）→ 不加 `--spec-dir`（gate specBase 走默认 `resolveSpecDir(code_root)`，向后兼容）
- 老变更无 SpecWorkspace → fallback `code_root/.sillyspec`（local 模式）
- 纯增量可独立回退

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R1 | `--spec-dir` 值注入（恶意 spec_dir 路径） | 高 | 白名单 within allowed roots + backend 构造受控 `SpecWorkspace.spec_root`（非 daemon 任意传）+ daemon handler `assertWithinAllowedRoots` 兜底 |
| R2 | sillyspec gate CLI 接线遗漏（index.js:323） | 中 | 本会话已改（`runGate(specBase:specDir)` 透传）+ sillyspec 45 测试绿，待 sillyspec commit/push |
| R3 | daemon-client spec_dir 解析错（SpecWorkspace.spec_root 不存在） | 中 | 复用 P3 `_resolve_gate_spec_root` 的 SpecWorkspace 解析（已验证）+ brownfield fallback |
| R4 | gate 真实 e2e（cwd 对不对一跑才知道） | 中 | 待 sillyspec gate npm publish 发版后真实 daemon-client 联调 |
| R5 | task-01 白名单扩大（安全面） | 中 | 仅加 `--spec-dir` 一个 flag + 值校验（成对+within allowed roots），不放开头部位 |

## 自审

- ✅ 背景：P3 坑 3 + sillyspec cwd/specBase 分离（index.js:323 接线已改+45 测试绿）
- ✅ 方案 A 明确（--spec-dir 尾部 + 白名单尾部放行，不改头部）
- ✅ 接口签名：_resolve_gate_spec_root 二元组 + _run_gate_via_delegate 改签名（code_root+spec_dir）
- ✅ Grill 发现测试调用方（test_gate_via_delegate.py 7 测试 + task-07 mock 12 处 + e2e mock）已纳入 task-05
- ✅ R1-R5 风险全应对（R1 注入 within allowed roots / R2 sillyspec 接线已改 / R3 SpecWorkspace 复用 / R4 e2e 待发版 / R5 白名单仅扩 --spec-dir）
- ✅ 生命周期契约表（§7.5，不引入新契约，引用 P3 §7.5）
- ⚠️ e2e 验证待 sillyspec gate npm publish（R4，本变更代码逻辑就绪，发版后真跑确认 cwd/specBase 对）

## 关联

- P3 driver gate pilot：`archive/2026-07-10-2026-07-10-p3-driver-gate-pilot/`（坑 3 follow-up）
- sillyspec 改进：`machine-interface.js:107` runGate cwd/specBase 分离 + `index.js:323` gate CLI 接线 specBase + `index.js:161` --spec-dir 全局选项
- 坑记录：`docs/sillyspec/local.yaml-gate-pitfalls.md`（坑 3 SillyHub 侧）
- 记忆：`p3-driver-gate-pilot-design`（P3 坑 3 follow-up）
