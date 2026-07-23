---
id: task-03
title: daemon host_fs WS handler（sillyhub-daemon/src/host-fs-handler.ts 新建/扩 file-rpc + daemon.ts 注册，方法见 FR-02）（覆盖：FR-02）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P0
depends_on: [task-02]
blocks: [task-04]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/host-fs-handler.ts
  - sillyhub-daemon/src/daemon.ts
provides:
  - contract: HostFsHandler
    fields: [stat, read_file, list_dir, git_apply, git_rev_parse, pollution_archive, read_package_json, read_local_yaml]
expects_from:
  task-02:
    - contract: HostFsWsRpc
      needs: [send_rpc, rpc_id]
goal: >
  daemon 侧实现 host_fs.* WS handler，在宿主（Windows）执行 FR-02 八方法并返回结构化结果，注册到 per-daemon WS 供 backend 容器经 HostFsDelegate + ws_rpc 调用，完成 complete_lease 收尾的宿主操作。
implementation:
  - "新建 sillyhub-daemon/src/host-fs-handler.ts（spike-01 选型：新建文件 + 复用 file-rpc.ts 的 assertWithinAllowedRoots / toRpcError 辅助）"
  - "八方法宿主实现（每方法走「assertWithinAllowedRoots 守卫 → 执行 → toRpcError 兜底」：stat / read_file / list_dir 复用 / git_apply 三路径 / git_rev_parse / pollution_archive / read_package_json / read_local_yaml）"
  - "child_process git：用 execFile（非 shell，防注入；cwd:workdir，timeout:10000）统一返回 {ok, stdout, stderr} 经 toRpcError 映射"
  - "daemon.ts:2044 旁新增 _registerHostFsRpcHandler(ws)：八方法各调 ws.registerRpcHandler('host_fs.<method>', ...)（method 命名带 host_fs. 前缀与 design §7 一致）"
  - "ESM 导入：node:fs/promises、node:child_process execFile、node:util promisify、js-yaml、./file-rpc.js（.js 后缀 ESM 规范）"
acceptance:
  - "八方法各返回结构化结果（git_apply 返回 {ok, conflict_detail, skipped} 含 skipped 字段供 task-04 D-008 幂等消费；git_rev_parse/pollution_archive/read_package_json/read_local_yaml 字段对齐 backend 期望）"
  - "daemon.ts:2044 旁注册生效：_registerHostFsRpcHandler(ws) 被调，八方法 registerRpcHandler 各注册一次（生产路径不重复注册触发 ws-client.ts:336 overwrite warn）"
  - "单测（sillyhub-daemon/src/__tests__/host-fs-handler.test.ts）mock fs/promises + child_process.execFile：覆盖每方法 happy path + git_apply 三路径 + 越界 forbidden + git 命令失败映射"
  - "tsc 严格类型通过（result/error 结构体显式 interface，避免 unknown 透传）"
  - "handler 异常被自身 try/catch 消化（转 RpcError），绝不冒泡到 ws-client.ts _dispatchRpc 之外"
verify:
  - "cd sillyhub-daemon && pnpm exec tsc --noEmit && pnpm test"
constraints:
  - "git_apply 必须含 git apply --check 预检（D-008 幂等契约 + 支撑 task-04 patch_id 去重；patch 已 applied 或已含于工作树 → skipped:true 不重复 apply 避免冲突）"
  - "ESM 导入（.js 后缀 + import not require，对齐 file-rpc.ts / ws-client.ts 既有风格）"
  - "跨平台路径（Windows 反斜杠：复用 file-rpc.ts:82-95 的 isWin 归一 + pathResolve；git 命令用 execFile + cwd 不依赖 shell）"
  - "不阻塞 WS 主循环：handler 异步 async，ws-client.ts:402 void _dispatchRpc 已 fire-and-forget；本 handler 内不 await 长任务（git apply 大 patch <10s 超时兜底）"
  - "方法名前缀 host_fs. 与 design §7 method 字段对齐（避免与 list_dir/get_spec_bundle 命名空间冲突；backend task-02 ws_rpc 发送侧须同前缀，跨任务契约）"
  - "list_dir 复用不重写（file-rpc.ts:listDir 已落地 + 有测试；本 task 只 re-export 到 HostFsHandler 契约，零行为变更）"
---

# task-03 daemon host_fs WS handler

## goal

daemon 侧实现 `host_fs.*` WS handler，在宿主（Windows）执行 FR-02 八方法（stat / read_file / list_dir / git_apply / git_rev_parse / pollution_archive / read_package_json / read_local_yaml）并返回结构化结果，注册到 per-daemon WS（DaemonWsHub 经 `ws-client.ts` 分发）。backend 容器通过 HostFsDelegate（task-01）+ ws_rpc（task-02）调用本 handler，完成 complete_lease 收尾的宿主操作（apply_patch / post_scan / stage_callback）。

## 依据

- design §5.2（daemon host_fs handler）+ §6 文件清单（host-fs-handler.ts 新增 / daemon.ts 注册）+ §7 host_fs WS RPC 协议（type/method/workspace_id/daemon_id/args/rpc_id ↔ type/rpc_id/result/error）。
- plan.md task-03 行（host-fs-handler.ts 新建/扩 file-rpc + daemon.ts 注册）+ 跨任务契约表（WS RPC 协议 provider task-02+task-03）。
- 现有 RPC 基础设施已就位（spike-01 应验证）：`ws-client.ts:333 registerRpcHandler` + `:484 _dispatchRpc`（取 handler → await → 回发 `MSG.RPC_RESULT` 带原 `rpc_id`，rpc_id 匹配由 task-02 backend 侧负责）；daemon.ts:2044-2092 已注册 `list_dir`（file-rpc.ts:listDir）+ `get_spec_bundle` 两个 handler——本 task 在同位置新增八方法注册，**不重建框架**。
- backend 语义参照（daemon 在宿主实现等价）：
  - `patch/service.py:48-161`（git_apply：`git apply --check` 预检 → 成功则 `git apply`；check 失败 + use_3way 则 `git apply --3way` 兜底）。
  - `agent/post_scan_validator.py:154-201`（git_rev_parse：`git -C <root> rev-parse HEAD` + safe.directory dubious ownership 重试）。
  - `agent/post_scan_validator.py:204-240`（pollution_archive：`shutil.move(source_root/.sillyspec → runtime_root/pollution/<scan_run_id>/.sillyspec)` + file_count）。
  - `agent/post_scan_validator.py:397-399`（read_local_yaml：`yaml.safe_load`；read_package_json：`json.loads` 取 `.scripts`）。

## implementation

1. **新建 `sillyhub-daemon/src/host-fs-handler.ts`**（spike-01 选型：新建文件 + 复用 `file-rpc.ts` 的 `assertWithinAllowedRoots` / `toRpcError` 辅助，而非把八方法塞进 file-rpc.ts——保持 list_dir 单一职责 + 文件可读性）。
2. **八方法宿主实现**（每方法走「assertWithinAllowedRoots 守卫 → 执行 → toRpcError 兜底」）：
   - `stat(path)` → `{ exists, is_dir, size }`（`fs/promises.lstat`，不存在返回 `{exists:false}` 而非抛 not_found，区分「文件不存在」与「读失败」）。
   - `read_file(path)` → `string`（`readFile` utf8；越界抛 `forbidden`）。
   - `list_dir(path)` → **直接复用 `file-rpc.ts:listDir`**（已实现， FR-02 列出但零增量）。
   - `git_apply({workdir, patch_data, use_3way})` → `{ ok, conflict_detail, skipped }`：先 `git apply --check`（D-008 幂等铺垫，check 通过且 patch 已含于工作树 → `skipped:true`；check 通过但需写入 → 跑 `git apply`；check 失败 + use_3way → `git apply --3way`；仍失败 → `ok:false, conflict_detail:<stderr>`，**不抛**，结构化回传让 backend 判定 PatchConflictError）。
   - `git_rev_parse({root})` → `{ commit, error }`（`git -C root rev-parse HEAD` + safe.directory dubious 重试；null/error 字段对齐 backend `_get_source_commit` 语义）。
   - `pollution_archive({source_root, runtime_root, scan_run_id})` → `{ archived, archive_path, file_count, error? }`（`fs.rename`/`cp` 移动 `source_root/.sillyspec` → `runtime_root/pollution/<scan_run_id>/.sillyspec`；rglob 等价用 `readdir` 递归算 file_count）。
   - `read_package_json({root})` → `dict | null`（`<root>/package.json` 不存在返 null；解析失败抛 internal）。
   - `read_local_yaml({root})` → `dict | null`（`<root>/.sillyspec/local.yaml`；用 `js-yaml` safeLoad——daemon 依赖已含；不存在返 null）。
3. **child_process git**：用 `node:child_process` 的 `execFile`（非 shell，防注入；`cwd:workdir` 设工作目录，`timeout:10000` 对齐 backend），统一返回 `{ok, stdout, stderr}` 经 `toRpcError` 映射。
4. **daemon.ts 注册**：在 `_wsLoop`（daemon.ts:2044 现有 `_registerListDirRpcHandler` / `_registerGetSpecBundleRpcHandler` 旁）新增 `_registerHostFsRpcHandler(ws)`：对八方法各调 `ws.registerRpcHandler('host_fs.<method>', ...)`（method 命名带 `host_fs.` 前缀与 design §7 协议 `method` 字段一致；handler 内取 `params`（ws-client.ts:492 已归一化 `params` 子对象），透传 `workspace_id` 仅用于日志、实际路径由 args 提供）。
5. **ESM 导入**：`import { stat, lstat, readFile, readdir, rename, mkdir } from 'node:fs/promises'`；`import { execFile } from 'node:child_process'`；`import { promisify } from 'node:util'`；`import yaml from 'js-yaml'`；`import { assertWithinAllowedRoots, toRpcError, listDir } from './file-rpc.js'`（`.js` 后缀 ESM 规范）。

## 验收标准

- 八方法各返回结构化结果（签名见 provides；git_apply 返回 `{ok, conflict_detail, skipped}` 含 skipped 字段供 task-04 D-008 幂等消费；git_rev_parse/pollution_archive/read_package_json/read_local_yaml 字段对齐 backend 期望）。
- daemon.ts:2044 旁注册生效：`_registerHostFsRpcHandler(ws)` 被调，八方法 `registerRpcHandler` 各注册一次（生产路径不重复注册触发 ws-client.ts:336 overwrite warn）。
- 单测（`sillyhub-daemon/src/__tests__/host-fs-handler.test.ts`）mock fs/promises + child_process.execFile：覆盖每方法 happy path + git_apply 三路径（check 通过 apply / check 通过 skipped / check 失败 3way 兜底）+ 越界 forbidden + git 命令失败映射。
- tsc 严格类型通过（result/error 结构体显式 interface，避免 `unknown` 透传）。
- handler 异常被自身 try/catch 消化（转 RpcError），**绝不冒泡到 ws-client.ts `_dispatchRpc` 之外**（design §4.1 3，ws-client.ts:512-519 已有兜底但 handler 侧结构化返回优先）。

## verify

```bash
cd sillyhub-daemon && pnpm exec tsc --noEmit && pnpm test
```

（host-fs-handler 单测全绿；现有 list_dir / get_spec_bundle / ws-client 测试零回归。）

## constraints

- **git_apply 必须含 `git apply --check` 预检**（D-008 幂等契约 + 支撑 task-04 patch_id 去重双保险；patch 已 applied 或已含于工作树 → `skipped:true` 不重复 apply 避免冲突）。
- **ESM 导入**（`.js` 后缀 + `import` not `require`，对齐 file-rpc.ts / ws-client.ts 既有风格）。
- **跨平台路径**（Windows 反斜杠：复用 `file-rpc.ts:82-95` 的 `isWin` 归一 + `pathResolve`；git 命令用 `execFile` + `cwd` 不依赖 shell）。
- **不阻塞 WS 主循环**：handler 异步（async），ws-client.ts:402 `void _dispatchRpc` 已 fire-and-forget；本 handler 内不 `await` 长任务（git apply 大 patch <10s 超时兜底）。
- **方法名前缀 `host_fs.`** 与 design §7 `method` 字段对齐（避免与 `list_dir`/`get_spec_bundle` 命名空间冲突；backend task-02 ws_rpc 发送侧须同前缀，跨任务契约）。
- **list_dir 复用不重写**（file-rpc.ts:listDir 已落地 + 有测试；本 task 只 re-export 到 HostFsHandler 契约，零行为变更）。
