# TASKS.md — fix/scan-dispatch-spec-root-params

## 目标
让 SillyHub dispatch 调用 `sillyspec run scan` 时显式传入 `--spec-root` / `--runtime-root` / `--workspace-id` / `--scan-run-id`，确保 scan 结果落入 workspace.spec_root 而非平台仓库 .sillyspec/docs/。

## 改动范围

### Task-01: 修改 build_scan_bundle 的 step_prompt
- 文件: `backend/app/modules/agent/context_builder.py`
- 当前 prompt 让 CC 调 `sillyspec init --dir {spec_root}` 和 `sillyspec run scan --dir {spec_root}`
- 修改为：
  ```
  sillyspec init --dir {spec_root}
  sillyspec run scan --dir {spec_root} --spec-root {spec_root} --runtime-root {runtime_root} --workspace-id {workspace_id} --scan-run-id {run_id}
  ```
- 需要在 build_scan_bundle 参数中新增 `run_id` 和 `runtime_root`
- runtime_root 推导为 `{spec_root}/../runtime/{workspace_id}` 或直接用 `str(Path(spec_root).parent / "runtime" / str(workspace_id))`
- 确保 init 和 run 的 `--dir` 也指向 spec_root（sillyspec 用这个来定位 .sillyspec/）

### Task-02: 修改 start_scan_dispatch 传入 run_id
- 文件: `backend/app/modules/agent/service.py`
- `start_scan_dispatch` 先创建 AgentRun 拿到 run.id，然后把 run.id 传给 build_scan_bundle
- 当前是先 build bundle 再创建 run，需要调换顺序，或者先创建 run 再 build bundle

### Task-03: scan 完成后触发 reparse + manifest 校验
- 文件: `backend/app/modules/agent/service.py`
- 在 `_execute_scan_run` 的第 6 步后，如果 exit_code == 0：
  1. 检查 `{spec_root}/manifest.json` 是否存在
  2. 如果存在，读取 manifest.source_commit，校验与 `git -C {root_path} rev-parse HEAD` 一致
  3. 调用 ScanDocsService.reparse() 从 spec_root 重新解析文档到 DB
- 需要用独立 session 调 reparse（因为 _execute_scan_run 已经在一个 session 里）

### Task-04: 修改 _build_stage_dispatch_prompt 支持 scan stage
- 文件: `backend/app/modules/agent/adapters/claude_code.py`
- 当 `bundle.stage == "scan"` 时，prompt 中的命令也要包含平台参数：
  `sillyspec run scan --spec-root {spec_root} --runtime-root {runtime_root} --workspace-id {workspace_id} --scan-run-id {scan_run_id}`
- 从 bundle.platform_metadata 读取这些值

### Task-05: 补测试
- 测试 build_scan_bundle 的 prompt 包含正确的 --spec-root 等参数
- 测试 _execute_scan_run 完成后触发 reparse
- Mock git HEAD 校验

## 约束
- 子进程 cwd = workspace.root_path（不是 lease_path）
- sillyspec 的 --dir 参数指向 spec_root（sillyspec 用它来定位 .sillyspec/ 目录）
- 不要污染平台仓库 .sillyspec/docs/
- 保持 fire-and-forget（不阻塞 HTTP 响应）

## 关键参考
- sillyspec CLI 参数：`--spec-root`、`--runtime-root`、`--workspace-id`、`--scan-run-id`
- SpecWorkspaceService：`backend/app/modules/spec_workspace/service.py`
- ScanDocsService：`backend/app/modules/scan_docs/service.py`
- config.py 的 resolve_spec_data_root() 已确保 spec_root 是绝对路径
