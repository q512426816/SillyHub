---
schema_version: 1
doc_type: module-card
module_id: spikes
author: qinyi
created_at: 2026-06-04T10:30:00+08:00
---

# spikes

## 定位
**技术验证模块**，承载 V1 开工前的 3 个强制前置 Spike 验证。

负责：
- Git 凭据与执行环境隔离可行性验证（`01-git-isolation`）
- SillySpec Native Layout 解析性能与正确性验证（`02-workspace-scan`）
- Claude Code 子进程可控性与沙箱隔离验证（`03-claude-code`）

不负责：
- 不参与生产环境业务逻辑
- 不提供长期运行的公共服务
- Spike 通过后，其验证结论会被其他模块（如 `workspace`、`agent`）吸收实现

## 契约摘要

### 01-git-isolation
- **输入**: 两个独立 GitHub 仓库 URL + 对应 PAT
- **输出**: 验证报告（6 项检查是否 PASS）
- **核心能力**:
  - 通过 `env -i` + 临时 `HOME` / `GIT_CONFIG_GLOBAL` / `GIT_ASKPASS` 构造完全隔离的执行环境
  - 验证并发 push 场景下 PAT 互不可见、commit author 各自正确
  - 验证结束后临时根目录彻底销毁（`shred -u`）

### 02-workspace-scan
- **输入**: 仓库根目录路径
- **输出**: `WorkspaceScan` JSON（components / changes / warnings / elapsed_ms）
- **核心能力**:
  - 解析 `.sillyspec/projects/*.yaml` 为 `ProjectComponent`
  - 解析 `.sillyspec/changes/{change,archive}/*` 为 `Change`（含 frontmatter）
  - 性能要求：单 workspace 扫描 ≤ 200ms（10×20 规模）
  - 容错：缺字段触发 warning 而非崩溃

### 03-claude-code
- **输入**: 任务 prompt + 可选 sample_seed
- **输出**: 验证报告（exit_code / files_in_workdir / leaked_to_home / no_credential_leak）
- **核心能力**:
  - 通过 `subprocess` 启动 Claude Code CLI，限制其在指定 workdir 内动作
  - 构造隔离 HOME（`HOME` + `USERPROFILE`），防止越权写入
  - 环境变量白名单透传（代理、ComSpec、SystemRoot 等）
  - 验证 stdout/stderr 无 API key 泄露

## 关键逻辑

### 02-workspace-scan 主流程
```
scan(root):
  t0 = now()
  sillyspec = root / ".sillyspec"
  if not sillyspec.is_dir(): return WorkspaceScan(is_sillyspec=false)

  components = []
  for yml in (sillyspec / "projects").glob("*.yaml"):
    comp = parse_component(yml)
    if comp.component_key in seen_keys: skip
    components.append(comp)

  changes = []
  for location in ["change", "archive"]:
    for d in (sillyspec / "changes" / location).iterdir():
      changes.append(parse_change(d, location))

  return WorkspaceScan(
    components, changes,
    elapsed_ms = (now() - t0) * 1000
  )
```

### 03-claude-code 主流程
```
run_claude_in_box(task_prompt):
  tmp = mkdtemp(prefix="cc-spike-")
  workdir = tmp / "repo"; home = tmp / "home"
  (workdir / "sample").mkdir()

  argv = [
    claude_bin,
    "-p", task_prompt,
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "acceptEdits",
    "--allowedTools", "Read,Write,Edit",
    "--add-dir", str(workdir),
    "--max-turns", "5",
  ]

  proc = subprocess.run(
    argv, cwd=workdir,
    env=whitelist_env(HOME=str(home, ...)),
    stdin=DEVNULL, capture_output=True,
    timeout=300
  )

  leaked = [f for f in home.rglob("*") if f.is_file()]
  return {
    exit_code=proc.returncode,
    files_in_workdir=[...],
    leaked_to_home=leaked,
    no_credential_leak=(API_KEY not in proc.stdout)
  }
```

## 注意事项

### 维护提醒
1. **Spike 验证是一次性的**：3/3 全部通过后（2026-05-25），模块主要作为历史记录保留
2. **REPORT.md 是权威文档**：验证结论、关键发现、残留风险全部记录在 `REPORT.md`
3. **凭据安全**：Spike 使用的 PAT / API Key 必须在验证后立即撤销（见 REPORT.md 凭据后续动作）

### 已知限制
1. **平台依赖**：
   - 01/03 依赖 Claude Code CLI + Git ≥ 2.40
   - 02 依赖 Python ≥ 3.12 + pyyaml + python-frontmatter + pydantic
2. **性能阈值**：02 的 200ms 阈值基于本地 SSD，网络存储需重新评估
3. **残留风险**（详见 REPORT.md）：
   - R-spk-01: Claude Code CLI 升级可能破坏 flag 语义
   - R-spk-02: 智谱 GLM 与 Anthropic 官方接口兼容差异
   - R-spk-04: stdout 理论上仍可能漏 key，需 V4 正则脱敏

### 修改时需同步检查的模块
- 若修改 02 解析逻辑：需同步 `workspace` 模块的 `WorkspaceScanner` 服务
- 若修改 03 子进程模板：需同步 `agent` 模块的 `AgentAdapter` 实现
- 若更新 Spike 结论：需更新 ROADMAP.md 的前置门禁状态

## 人工备注

<!-- MANUAL_NOTES_START -->

**Spike 通过时间线**：
- 2026-05-25: 3/3 全部 PASS，V1 前置门禁解除

**给后续实现的输入**（摘自 REPORT.md）：
- `GitIdentityManager` 必须使用 `GIT_CONFIG_GLOBAL` + 临时 `HOME` 模型
- `WorkspaceScanner` V1 形态：纯同步 + 全量扫描即可，无须 watcher
- `AgentAdapter` 启动模板见 `03-claude-code` 主流程注释

**失败分支处理**（如需重跑 Spike）：
- 01 失败：平台核心安全模型不成立，重新选型
- 02 失败：重新评估 SillySpec 协议稳定性
- 03 失败：V4 Agent Adapter 需改用 Docker 沙箱

<!-- MANUAL_NOTES_END -->
