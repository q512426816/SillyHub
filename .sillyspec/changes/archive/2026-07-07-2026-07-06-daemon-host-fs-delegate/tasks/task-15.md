---
id: task-15
title: 模块文档同步（backend.md + sillyhub-daemon.md 注意事项 + 变更索引）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P2
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13, task-14]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - C:\Users\qinyi\.sillyhub\daemon\specs\56c70aa3-4067-4648-b139-aa5360b38ec4\docs\multi-agent-platform\modules\backend.md
  - C:\Users\qinyi\.sillyhub\daemon\specs\56c70aa3-4067-4648-b139-aa5360b38ec4\docs\multi-agent-platform\modules\sillyhub-daemon.md
provides: []
expects_from: {}
goal: >
  把本变更 2026-07-06-daemon-host-fs-delegate 的架构结论（HostFsDelegate 容器零宿主访问委托抽象 + complete_lease path_source 贯穿收尾链 + 8 处容器越界点统一 + 删死代码）写入 backend.md 与 sillyhub-daemon.md 的「注意事项」与「变更索引」区，作为后续维护 backend daemon 模块、lease 收尾链、daemon host_fs handler 的依据。
implementation:
  - "backend.md 注意事项区追加 2 条（HostFsDelegate 容器零宿主访问契约 + complete_lease 收尾链 path_source 贯穿）"
  - "backend.md 变更索引区追加 1 条（2026-07-06-daemon-host-fs-delegate 概述）"
  - "sillyhub-daemon.md 注意事项区追加 1 条（host_fs WS handler）"
  - "sillyhub-daemon.md 变更索引区追加 1 条（2026-07-06-daemon-host-fs-delegate 概述）"
acceptance:
  - "backend.md 注意事项含「HostFsDelegate 容器零宿主访问契约」+「complete_lease 收尾链 path_source 贯穿」两条；变更索引含 2026-07-06-daemon-host-fs-delegate 条目"
  - "sillyhub-daemon.md 注意事项含「host_fs WS handler」一条；变更索引含 2026-07-06-daemon-host-fs-delegate 条目"
  - "两文档变更均落在 MANUAL_NOTES_START/END 标记内，MANUAL_NOTES 标记本身未被破坏"
  - "注意事项条目格式对齐现有（加粗条目名 + 冒号 + 描述）；变更索引条目格式对齐现有（- <id> | <desc> ）"
verify:
  - "人工通读两文档（文档任务无自动化测试）"
  - "可选 grep 2026-07-06-daemon-host-fs-delegate 确认变更索引各命中 1 次（共 2 处）"
  - "可选 grep -c MANUAL_NOTES_START 确认各仍为 1（标记未被破坏）"
constraints:
  - "平台模式：仅写 specDir 下文档（docs/multi-agent-platform/modules/*.md），严禁写源码目录相对 .sillyspec/"
  - "追加到现有 MANUAL_NOTES 区末尾，不重排、不删除已有条目（scan 重生保留 MANUAL_NOTES 区，变更索引必须落在标记内才不被删）"
  - "不改 frontmatter（source_commit/created_at 等由 scan 维护）"
  - "仅文档，无代码/测试改动；本 task 不改任何源码"
  - "用语遵循中文 + 必要专业术语；不奉承、直接陈述"
---

# task-15 模块文档同步

## goal
把本变更 2026-07-06-daemon-host-fs-delegate 的架构结论（HostFsDelegate 容器零宿主访问委托抽象 + complete_lease path_source 贯穿收尾链 + 8 处容器越界点统一 + 删死代码）写入 `backend.md` 与 `sillyhub-daemon.md` 的「注意事项」与「变更索引」区，作为后续维护 backend daemon 模块、lease 收尾链、daemon host_fs handler 的依据。

## 依据
- design.md §1（8 处同源根因）+ §5.1（HostFsDelegate 接口）+ §5.2（daemon host_fs WS handler）+ §5.3（complete_lease path_source 贯穿）+ §7.5（生命周期契约表）。
- decisions.md D-001（完全委托 8 处）/ D-004（server-local 分流）/ D-005（per-daemon WS RPC）/ D-006（异步容错）/ D-008（apply_patch 幂等）/ D-009（post_scan 原语 RPC 方案 B）。
- plan.md §全局验收标准最后一条「模块文档 backend.md / sillyhub-daemon.md 同步本变更（注意事项 + 变更索引）」。
- 现有两文档注意事项区已有同类条目（如 backend.md 的 daemon-client dispatch 路径校验 ql-006、sillyhub-daemon.md 的 stderr forward ql-009/010），追加格式参照。

## implementation
### backend.md（注意事项区追加 2 条）
1. **HostFsDelegate 容器零宿主访问契约**：backend 容器不再直接对 `workspace.root_path` 做 stat/git/read 宿主操作；统一经 `app/modules/daemon/host_fs/delegate.py` 的 `HostFsDelegate`（接口 stat/read_file/list_dir/git_apply/git_rev_parse/pollution_archive/read_package_json/read_local_yaml），按 `path_source` 分流——`daemon-client` 走 per-daemon WS RPC（`host_fs.*` method，D-005/D-007），`server-local` 本地容器直接做（D-004 零回归）。新增宿主操作点默认经 HostFsDelegate，不再散落 `if path_source != 'daemon-client'`（NFR-03 grep 守卫）。
2. **complete_lease 收尾链 path_source 贯穿**：`lease/service.py:278 complete_lease` 入口经 lease→agent_run→workspace 反查 `workspace.path_source`，透传到 3 个收尾回调（apply_patch / post_scan_validation / stage_callback），daemon-client 时回调内走 HostFsDelegate RPC，server-local 保留本地行为。RPC 失败不阻塞 lease completed（warn + ql-009 failure log 兜底，D-006）；apply_patch 幂等（patch_id 去重 + daemon `git apply --check` 预检，D-008）；post_scan 走方案 B 原语 RPC（D-009，backend 保留校验逻辑）。

### backend.md（变更索引区追加 1 条）
- `2026-07-06-daemon-host-fs-delegate | backend 容器零宿主访问：HostFsDelegate 委托抽象（path_source 分流 daemon-client WS RPC / server-local 本地）+ complete_lease path_source 贯穿 3 收尾回调（apply_patch/post_scan/stage_callback）+ 8 处容器越界统一（dispatch 5 + complete_lease 3）+ 删 _run_sillyspec_background 死代码。D-001/004/005/006/008/009@V1。`

### sillyhub-daemon.md（注意事项区追加 1 条）
- **host_fs WS handler**：新建 `src/host-fs-handler.ts`（或扩 file-rpc，spike-01 决策），注册到 per-daemon WS（DaemonWsHub）接收 `host_fs.*` 请求在宿主执行 git/stat/read。复用 daemon-entity-binding 的 DaemonWsHub.send_rpc 做请求/响应 rpc_id 匹配（D-005，非新 HTTP server / 非新端口）。daemon-client 模式下 backend HostFsDelegate 经此 handler 调用宿主 git apply / rev-parse / pollution archive / package.json 读取等；handler 实现 git apply 幂等（D-008 `--check` 预检）+ 30s 超时/重连幂等对齐 D-006。

### sillyhub-daemon.md（变更索引区追加 1 条）
- `2026-07-06-daemon-host-fs-delegate | 新增 host_fs WS handler（注册 per-daemon WS，rpc_id 匹配 backend HostFsDelegate 请求，宿主执行 stat/read/git_apply/rev_parse/pollution_archive/package.json，D-005/D-007）+ apply_patch 幂等 --check 预检（D-008）。`

### 格式约束
- 追加到现有 `<!-- MANUAL_NOTES_START -->` … `<!-- MANUAL_NOTES_END -->` 区内、变更索引列表末尾（紧跟上一条 `2026-07-06-component-readonly-split` / `ql-20260706-010-a076` 之后），不破坏 MANUAL_NOTES 标记。
- 注意事项条目以「**条目名**：」开头，参照现有格式（如 `**scan 命令路径加引号**：`、`**dialog 审批不超时**：`）。
- 变更索引条目以 `- <change_id> | <一句话> ` 格式，参照现有行。

## 验收标准
- backend.md 注意事项含「HostFsDelegate 容器零宿主访问契约」+「complete_lease 收尾链 path_source 贯穿」两条；变更索引含 `2026-07-06-daemon-host-fs-delegate` 条目。
- sillyhub-daemon.md 注意事项含「host_fs WS handler」一条；变更索引含 `2026-07-06-daemon-host-fs-delegate` 条目。
- 两文档变更均落在 MANUAL_NOTES_START/END 标记内，MANUAL_NOTES 标记本身未被破坏。
- 注意事项条目格式对齐现有（加粗条目名 + 冒号 + 描述）；变更索引条目格式对齐现有（`- <id> | <desc> `）。

## verify
- 人工通读两文档注意事项 + 变更索引区，确认新增条目语义完整、无错别字（无自动化测试）。
- 可选：`grep "2026-07-06-daemon-host-fs-delegate" backend.md sillyhub-daemon.md` 确认变更索引各命中 1 次（共 2 处）。
- 可选：`grep -c "MANUAL_NOTES_START" backend.md sillyhub-daemon.md` 确认各仍为 1（标记未被破坏）。

## constraints
- 平台模式：仅写 specDir 下文档（`docs/multi-agent-platform/modules/*.md`），严禁写源码目录相对 `.sillyspec/`（参照 sillyspec-must-run-at-repo-root 记忆）。
- 追加到现有 MANUAL_NOTES 区末尾，不重排、不删除已有条目；scan 重生会覆盖模块文档主体但保留 MANUAL_NOTES 区（参照 scan-regenerates-module-docs 记忆），故变更索引必须落在标记内才不被 scan 删。
- 不改 frontmatter（source_commit/created_at 等由 scan 维护）。
- 仅文档，无代码/测试改动；本 task 不改任何源码。
- 用语遵循中文（项目规则 11）+ 必要专业术语；不奉承、直接陈述（项目规则 13）。
