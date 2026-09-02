---
schema_version: 1
doc_type: module-card
module_id: host-fs-handler
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 宿主文件系统 RPC（host-fs-handler）

## 定位

`host_fs.*` RPC 业务层：接收 backend 经 per-daemon WS（DaemonWsHub.send_rpc）转发
的宿主文件系统 / git 操作，在宿主机执行并返回结构化结果。complete_lease 收尾的
3 个宿主操作（apply_patch / post_scan / stage_callback）经 backend HostFsDelegate
调到本 handler。daemon 经此模块操作宿主仓库（含 worktree 隔离）。

## 契约摘要

- `HostFsHandler` 方法集：
  - fs 类：`stat`（`{exists,is_dir,size}`，不存在不抛）、`read_file`、`list_dir`
    （复用 file-rpc 并 re-export）、`read_package_json`、`read_local_yaml`、
    `pollution_archive`（对齐 backend post_scan_validator 的
    `_archive_and_clean_pollution`：污染文件归档 + 清理）。
  - git 类：`git_apply`（`{ok,conflict_detail,skipped}`）、`git_rev_parse`
    （`{commit,error}`）、`git_worktree_add`（`{ok,worktree_path,error}`）、
    `git_merge`（`{ok,conflicts,merged_files,error}`，conflict 含
    `{file,marker_lines}`）、`git_worktree_remove`（`{ok,error,branch_deleted?}`；
    ql-20260902-001 起可选 `branch` 参：remove 成功后 best-effort
    `git branch -D`，根治 workers/* 分支堆积，旧调用方不传零变化）。
  - `run_command`：唯一执行宿主命令的方法，白名单极窄。
- `isGateCommand(command, args)`：run_command 白名单判定，导出供测试。
- `HostFsHandlerOptions`、各 Result 接口与 backend HostFsDelegate 契约三端对齐。

## 关键逻辑

```
每方法统一骨架: assertWithinAllowedRoots 守卫(复用 file-rpc) → 执行 → toRpcError 兜底
git_apply 幂等(D-008): git apply --check
  → check 过 + patch 已含于工作树 → skipped:true 不重复 apply
  → check 过需写入 → git apply；check 败 + use_3way → --3way 兜底
  → 仍败 → {ok:false, conflict_detail:<stderr>} 不抛（backend 判 PatchConflictError）
git_merge 冲突解析: git diff --name-only --diff-filter=U + 读冲突标记行
  （<<<<<<< / ======= / >>>>>>>，≥2 行才算真冲突）→ 喂主 agent LLM 解决
run_command: isGateCommand 不命中 → exit_code 126 不执行，结构化回传
  命中模板: sillyspec gate verify --change <非空> --json [flag value 成对...]
git 命令: execFile(非 shell) + cwd:workdir（防注入）
超时双档(ql-20260902-001): 轻命令(apply/rev-parse 等) 10s；
  worktree add/merge/remove 是 IO 型重命令 120s（GIT_WORKTREE_TIMEOUT_MS）——
  10s 在大仓库(7705 文件) Windows 冷缓存下必杀 git worktree add，
  实证分身 worktree_create_failed 派发必败（git stderr 仅进度条无 fatal 行）
```

## 注意事项

- git 失败一律结构化回传不抛：worktree_add 失败让 backend 标 worker run failed 不
  崩 mission；worktree_remove 失败 backend 仅记 warning 不阻塞收尾。
- branch 删除 best-effort 语义（ql-20260902-001）：目录已删（ok=true）但
  `git branch -D` 失败 → `branch_deleted:false` + error 回传，**不翻 ok**——
  backend 只记日志；用 `-D` 不用 `-d`（调用方传分支即已判定无保留价值，
  `-d` 会因 not fully merged 误拒）。
- isGateCommand 与 backend delegate.py `_enforce_command_whitelist` **字符级对齐**
  （command 严格裸 `sillyspec` 防路径注入；头部 5 元素精确匹配；尾部 flag 成对
  消费）；改任何一侧必须同步另一侧。
- `git_merge.merged_files` 当前恒回 `[]`（git merge stdout 非结构化，留扩展），
  backend 消费以 conflicts 判定为准。
- run_command 超时（SIGTERM）回 exit_code 124，stderr 追加超时标记。
- `read_local_yaml` 用 js-yaml 解析、`read_package_json` 用 JSON.parse，二者同返
  ReadDictResult 形态（解析失败结构化回传不崩）。
- 本地 toRpcError 与 file-rpc 的私有实现等价（后者未导出），保持字面对齐。
- 权限走 daemon 实体级 allowed_roots（不做 per-runtime PolicyEngine 精细裁决，
  那是 list_dir 专属）；patch_id 去重本身在 backend（本 handler 只给 skipped 信号）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
