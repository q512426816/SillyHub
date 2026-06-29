---
author: WhaleFall
created_at: 2026-06-26T13:07:31
change: 2026-06-26-daemon-root-path-translation
---

# Plan: daemon root_path 翻译修复

**plan_level: full**

## 来源
- `design.md`（方案 A，§3-§11）
- `proposal.md` / `requirements.md`（FR-01~06，D-001~D-004）
- 调用点搜索（本文件末「调用点搜索记录」，plan 阶段 grep 实证，已反向修正 design 下发点）

## 范围
backend（`workspace` + `daemon.lease.context` + `agent.router/context_builder/service`）+ `sillyhub-daemon`（workspace/task-runner/daemon）。复用 `HOST_PATH_PREFIX`/`CONTAINER_PATH_PREFIX`，无新 env、无 DB 迁移、无 schema 变更。

## Wave 分组与任务

### Wave 1：backend 路径改写核心
- [x] task-01: `workspace/service.py` 新增 `resolve_root_path_for_daemon`（container→host，逆 `_rewrite_path`；daemon-client 原样；裸机未配前缀原样）+ 单测（server-local 改写 / daemon-client 原样 / 裸机 / Windows 反斜杠规范化）
- [x] task-02: `daemon/lease/context.py` lease claim payload 改写——:72（interactive，root_path=cwd or root_path）+ :240-241（batch，rootPath/root_path 双写）调 `resolve_root_path_for_daemon`（需在上下文取 path_source）

### Wave 2：backend 其他下发点（依赖 task-01）
- [x] task-03: `agent/router.py:268` execution-context 响应 root_path 改写（path_source 已可取于 :242）
- [x] task-04: 核对 `agent/context_builder.py --dir`（:569/572/579）+ `agent/service.py build_scan_bundle`（:1333/1399）root_path 入参——daemon 执行则改写，容器内执行不改

### Wave 3：daemon allowed_roots 自动放行（独立，可与 Wave 1/2 并行）
- [x] task-05: ~~`sillyhub-daemon` 新增 `ensureAllowedRoot`~~ **跳过（用户确认）**——execute 阶段 grep 实证 daemon `allowed_roots`（`assertWithinAllowedRoots`）只用于 `list_dir` RPC，不管 CC 执行 cwd；task-01~04 已修复核心 CC bug。详见 design D-002 澄清。

### Wave 4：端到端验证（依赖 task-02/03/04/05）
- [x] task-06: 端到端验证——代码层（全量 pytest 2009 passed 不回归 + mypy 无 task 文件错误）；端到端（rebuild backend + 触发 run 看 daemon cwd=项目根 + CC find 源码）推 verify/部署阶段

## 任务总表

| task | 优先级 | 依赖 | Wave |
|---|---|---|---|
| task-01 | P0 | — | 1 |
| task-02 | P0 | task-01 | 1 |
| task-03 | P1 | task-01 | 2 |
| task-04 | P1 | task-01 | 2 |
| task-05 | P0 | — | 3 |
| task-06 | P0 | task-02, task-03, task-04, task-05 | 4 |

## 关键路径
task-01 → task-02 → task-06（backend 改写核心 → lease 下发 → 端到端验证）。task-05（daemon allowed_roots）独立，可与 Wave 1/2 并行。

## D-xxx 覆盖矩阵

| 决策 | 覆盖 task |
|---|---|
| D-001 backend 端改写 | task-01, task-02, task-03, task-04 |
| D-002 daemon 自动放行 allowed_roots | task-05 |
| D-003 batch + interactive 双路径 | task-02（context.py batch+interactive）+ task-05（两路径调用） |
| D-004 不加 daemon 翻译 | 约束（无 task，不实现 daemon root_path_map） |

## 全局验收（含兼容性）
1. batch lease run：daemon terminal.log `cwd=项目根`（F:\WorkNew\SillyHub 等价），CC `find scan-docs/page.tsx` 命中，run 正常完成。
2. interactive session：cwd 同项目根，CC 能读源码。
3. daemon-client workspace：root_path 原样透传，行为不回归。
4. daemon allowed_roots：执行期运行时白名单含本次 root_path，config 静态值不变。
5. 裸机兼容：`HOST_PATH_PREFIX`/`CONTAINER_PATH_PREFIX` 未配时改写原样返回。
6. backend scanner 不回归：scan_docs/knowledge/task 仍走 `resolve_root_path_for_server`（容器路径），post_scan（`run_sync:766`）读 lease.metadata 容器路径不变。
7. 单测：`resolve_root_path_for_daemon` + `ensureAllowedRoot` 全过。
8. 兼容性：旧 daemon（未升级 task-05）收到宿主机路径但 allowed_roots 不含 → 失败，需 daemon 同步升级（同变更交付 + daemon 分发物 rebuild）。

## 调用点搜索记录（plan 阶段 grep 实证，已反向修正 design §3.2/§5/§6 下发点）
- `root_path` backend→daemon 下发边界（**改写**）：
  - `daemon/lease/context.py:72`（interactive lease claim payload root_path）
  - `daemon/lease/context.py:240-241`（batch lease claim payload rootPath/root_path 双写）
  - `agent/router.py:268`（execution-context 响应 root_path）
  - `agent/context_builder.py:569/572/579`（scan/init 命令 --dir）
- `lease.metadata["root_path"]` backend 内部消费（**不改**）：
  - `daemon/run_sync/service.py:766`（post_scan_validation，容器内 fs）
  - 写入点 `agent/placement.py:258/484`（保持容器路径）
- interactive session 的 rootPath 经 lease claim payload（context.py:72），无独立下发通道。
- 结论：改 context.py（claim payload）+ router.py + context_builder；**不改 placement.py**（被 backend 自身 run_sync:766 读，改了会破坏 backend 容器内 post_scan）。
