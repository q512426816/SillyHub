---
id: task-07
title: post_scan_validation 改 HostFsDelegate（run_sync/service.py + post_scan_validator.py，按 D-009 方案 B 暴露原语）（覆盖：FR-03, D-003@V1, D-009@V1）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P0
depends_on: [task-04, task-05]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@V1, D-009@V1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
  - backend/app/modules/daemon/post_scan_validator.py
provides: []
expects_from:
  task-01:
    - contract: HostFsDelegate
      needs: [git_rev_parse, pollution_archive, read_package_json]
  task-05:
    - contract: CompleteLeasePathSource
      needs: [path_source]
goal: >
  把 post_scan_validation 链路里的 backend 容器内 git/shutil/read 宿主操作改成 HostFsDelegate 原语 RPC（D-009 方案 B），修 daemon-client 模式 post_scan 校验静默失效，server-local 零回归。
implementation:
  - "run_sync/service.py 入口取 task-05 透传的 path_source，构造 HostFsDelegate 注入 PostScanValidator，外层 try/except 保留（RPC 失败 warn 不阻塞 lease completed）"
  - "agent/post_scan_validator.py 增 delegate/path_source 参，validate 按 path_source 分流：server-local 保留原生 subprocess/shutil 实现，daemon-client 改 delegate.git_rev_parse/pollution_archive/read_package_json"
  - "validate 改 async（server-local 分支用 asyncio.to_thread 包原同步函数；判定逻辑、污染清点、状态机全留 backend 不动）"
acceptance:
  - "daemon-client scan lease complete 时 post_scan 校验真实执行：污染检测命中、commit 获取、package.json script 校验经 HostFsDelegate RPC 回流，不再静默走 exists() 兜底返回空"
  - "server-local 现有 PostScanValidator 行为字节级不变（subprocess/shutil 本地路径）"
  - "校验判定规则不变（ScanRunStatus 状态转移、降级 warning 边界一致）"
  - "_run_post_scan_validation 写入 lease.metadata_['post_scan_validation'] 结构不变（前端/下游消费方零感知）"
verify:
  - "cd backend && uv run pytest app/modules/daemon/run_sync/ app/modules/daemon/"
constraints:
  - "D-009 方案 B：判定逻辑留 backend，不把 PostScanValidator 整块搬 daemon（daemon 只暴露原语，避免校验规则双端重复）"
  - "RPC 失败按 D-006 / design §7.5：warn 不阻塞 lease completed（complete_lease 不 500、不翻转 scan 成功语义）"
  - "server-local NFR-02 零回归（path_source 分流本地分支，subprocess/shutil 原实现保留）"
  - "design §6 与本卡 allowed_paths 的 daemon/post_scan_validator.py 为笔误，实际改 agent/post_scan_validator.py；纠正 allowed_paths 另起 quick"
---

## goal

把 `_run_post_scan_validation` 链路里的 backend 容器内 git / shutil / read 宿主操作改成 HostFsDelegate 原语 RPC（D-009 方案 B：daemon 只暴露 `git_rev_parse` / `pollution_archive` / `read_package_json` 原语，backend 保留污染判定与状态编排语义），修「daemon-client 模式 post_scan 校验静默失效」（design §1 标的第 6 处容器越界）。server-local 行为零回归。

## 源码依据

- 调用点：`backend/app/modules/daemon/run_sync/service.py:938-1006 _run_post_scan_validation`（lease 收尾锚点，从 `lease.metadata_` 取 root_path/spec_root/runtime_root 喂 PostScanValidator）。
- 校验实现：`backend/app/modules/agent/post_scan_validator.py`（注意：design §6 与本卡 allowed_paths 写 `daemon/` 是笔误，真实在 `agent/`；落地按真实路径改）。
  - `_get_source_commit` (L146-201)：`subprocess.run(["git","-C",source_root,"rev-parse","HEAD"])` + safe.directory 兜底 → 原语 `git_rev_parse`。
  - `_archive_and_clean_pollution` (L204-240)：`shutil.move` + `rglob/*is_file` 清点 → 原语 `pollution_archive`。
  - `_check_local_config` (L379-475)：`package.json` `read_text + json.loads` 取 scripts → 原语 `read_package_json`。
  - 保留 backend：`_check_log_patterns` / `_check_source_pollution` / `_check_output_paths` / `_determine_status`（判定语义不搬 daemon）。

## implementation

1. **run_sync/service.py** `_run_post_scan_validation`：
   - 入口取 task-05 透传的 `path_source`（`CompleteLeasePathSource` 契约，从 lease→agent_run→workspace 反查；若 task-05 改为函数入参，按其签名接）。
   - 构造 `HostFsDelegate(session, ws_hub)`，注入 `PostScanValidator(..., delegate=delegate, path_source=path_source)`。
   - 外层 try/except 保留（design §7.5：RPC 失败 warn + 不阻塞 lease completed，不翻转 scan 成功语义）。
2. **agent/post_scan_validator.py**：
   - `__init__` 增参 `delegate: HostFsDelegate | None = None`、`path_source: str = "server-local"`（向后兼容 server-local 默认走原 subprocess 路径，NFR-02）。
   - `validate()` 调用点分流：
     - server-local：保留 `_get_source_commit` / `_archive_and_clean_pollution` / `_check_local_config` 原生实现（零回归）。
     - daemon-client：三处改 `await delegate.git_rev_parse(...)` / `await delegate.pollution_archive(...)` / `await delegate.read_package_json(...)`；判定（是否污染、commit 缺失降级 warning、local.yaml script 缺失）仍在 backend 编排（D-009 方案 B）。
   - `validate()` 改 async（PostScanValidator 实例化已是同步类，仅 validate 路径涉及 RPC；server-local 分支用 `asyncio.to_thread` 包原同步函数避免阻塞事件循环，或拆 sync/async 两条 validate 入口——实现时取不破坏现有 caller 的最小改法，task-08 前后均调用此方法需对齐）。
3. **判定规则不动**：污染文件清点（rglob）、错误模式正则（ERROR_PATTERNS）、`_determine_status` 状态机全留 backend。

## 验收标准

- daemon-client scan lease complete 时 post_scan 校验真实执行：污染检测命中（`source_root_pollution`）、commit 获取、package.json script 校验经 HostFsDelegate RPC 回流（不再因容器内 FileNotFoundError 静默走 exists() 兜底返回空）。
- server-local 现有 PostScanValidator 行为字节级不变（subprocess/shutil 本地路径）。
- 校验判定规则不变（`ScanRunStatus` 状态转移、降级 warning 边界一致）。
- `_run_post_scan_validation` 写入 `lease.metadata_['post_scan_validation']` 结构不变（前端/下游消费方零感知）。

## verify

```
cd backend && uv run pytest app/modules/daemon/run_sync/ app/modules/daemon/ app/modules/agent/post_scan_validator*
```

补 daemon-client RPC 双路径单测（mock HostFsDelegate：git_rev_parse 返回 commit / pollution_archive 返回 archived:true / read_package_json 返回 scripts map）+ server-local 零回归。

## constraints

- D-009 方案 B：判定逻辑留 backend，不把 PostScanValidator 整块搬 daemon（daemon 只暴露原语，避免校验规则双端重复）。
- RPC 失败按 D-006 / design §7.5：warn 不阻塞 lease completed（complete_lease 不 500、不翻转 scan 成功语义）。
- server-local NFR-02 零回归（path_source 分流本地分支，subprocess/shutil 原实现保留）。
- design §6 与本卡 frontmatter `allowed_paths` 的 `daemon/post_scan_validator.py` 为笔误，实际改 `agent/post_scan_validator.py`；若需纠正 allowed_paths 另起 quick（不擅改 frontmatter）。
