---
author: WhaleFall
created_at: 2026-06-26 12:32:47
change: 2026-06-26-daemon-root-path-translation
---

# Proposal: daemon workspace root_path 容器→宿主机路径翻译修复

## 问题
backend（Docker 容器）把 workspace `root_path` 以**容器路径**（`/host-projects/WorkNew/SillyHub`）原样透传给 daemon（宿主机进程）的三处（`agent/router.py:268` execution-context、`agent/placement.py:258,484` lease.metadata、`agent/context_builder.py --dir`）。daemon `statSync` 容器路径失败 → fallback 创建空目录 → CC 在空目录执行，找不到项目源码，反复搜索失败后 `status=cancelled`。daemon `allowed_roots` 也不含项目路径，即使 cwd 对也访问不了源码。

## 方案（A：backend 下发宿主机路径）
- backend 新增 `resolve_root_path_for_daemon`（container→host，逆现有 `_rewrite_path`），在下发 daemon 的边界改写：`daemon/lease/context.py`（lease claim payload :72 interactive / :240-241 batch）+ `agent/router.py:268` execution-context + `agent/context_builder.py --dir`。server-local 走 container→host，daemon-client 原样透传；**不改** `placement.py` lease.metadata（backend 内部读，保持容器路径）。
- daemon 新增 `ensureAllowedRoot`，收到 root_path 后动态加入运行时 allowed_roots（零配置）。
- 复用现有 `HOST_PATH_PREFIX`/`CONTAINER_PATH_PREFIX` env，不新增配置、无 DB 迁移、不动 `translateSpecRoot`。
- batch（prepareWorkspace）+ interactive（cwd）双路径覆盖；裸机（未配前缀）原样返回兼容。

## 影响模块
`daemon`（backend `app/modules/agent` + `app/modules/workspace` + `sillyhub-daemon/src`）。

## Non-Goals（不在范围内）
- 不改 `translateSpecRoot`（prompt 的 spec_root 翻译保持，向后兼容）。
- 不改 DB `workspace.root_path` 存储语义（仍是 backend 视角容器路径，供 backend scanner 用）。
- 不新增 daemon 端 `root_path_map` 翻译（不可移植，`2026-06-22-a1-backend-host-path` 已否决）。
- 不处理 `agent_run_logs.dedup_key` schema 漂移（已由运维 hotfix 修复，quicklog ql-20260626-003）。

## 决策
D-001 backend 端改写 / D-002 daemon 自动放行 allowed_roots / D-003 batch+interactive 双路径 / D-004 不新增 daemon 端 root_path 翻译。

详见 `design.md`。
