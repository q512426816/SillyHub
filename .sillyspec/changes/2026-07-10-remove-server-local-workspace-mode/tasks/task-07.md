---
id: task-07
title: Refactor prompt --spec-root transport decision to single daemon-client path
title_zh: core/spec_paths transport 决策重构（transport_for_path_source/resolve_prompt_spec_root/resolve_root_path_for_daemon）为单一 daemon-client
author: qinyi
created_at: 2026-07-10 23:45:39
priority: P0
depends_on: [task-01]
blocks: [task-13, task-15]
requirement_ids: [FR-6]
decision_ids: [D-007]
allowed_paths:
  - backend/app/core/spec_paths.py
  - backend/app/modules/agent/context_builder.py
  - backend/app/modules/workspace/service.py
---

## goal

把整套 per-workspace transport 决策（建立在已删的 `path_source` 字段上）收敛为单一
daemon-client 路径，确保 prompt `--spec-root` 计算链（R-08）与 container→host 路径逆运算不断链。
覆盖 design §6 的 `transport_for_path_source` / `resolve_prompt_spec_root` /
`resolve_root_path_for_daemon` 三函数重构（D-007 P0-4 补的遗漏文件）。

> **位置修正（execute 必读）**：design §6 与本任务原 brief 把三函数归到 `core/spec_paths.py`，
> 实测**不符**。`core/spec_paths.py`（170 行）只有 `SpecPathResolver` 类，零 `path_source`/
> `transport_for` 引用。三函数真实落点：
> - `transport_for_path_source`(328) + `resolve_prompt_spec_root`(352) →
>   `app/modules/agent/context_builder.py:328-401`
> - `resolve_root_path_for_daemon`(93) → `app/modules/workspace/service.py:93-126`
>
> 因此 `allowed_paths` 扩列两个真实文件；`core/spec_paths.py` 本身**无需改动**（保留在
> allowed_paths 仅因 design §6 原文列入，execute 阶段若核实仍为零改动则跳过即可）。
> 边界：`resolve_root_path_for_daemon` 的 server-local 分支删除由 task-03 主导（task-03
> implementation 第 1 点），本任务负责 prompt `--spec-root` 链（`transport_for_path_source` +
> `resolve_prompt_spec_root`）的彻底简化并校验整条链端到端不断；两任务同 Wave 2，需协同避免
> 对 `resolve_root_path_for_daemon` 重复改签名。

## implementation

### context_builder.py（主战场，328-401）

1. **`transport_for_path_source`(328-349)**：整套函数建立在 `path_source` 二元映射上，
   daemon-client 唯一后失去存在意义——**删整个函数**。原映射：daemon-client→`"tar"`、
   server-local→`"shared"`。单一化后 prompt spec-root 永远走 daemon 本地 tar 约定路径
   （`~/.sillyhub/daemon/specs/{ws_id}`，daemon 侧 `spec-sync.resolveSpecDir(wsId)` 一致）。
2. **`resolve_prompt_spec_root`(352-401)**：重构为单一路径——删 `path_source: str | None = None`
   入参与 `if path_source is None: transport = settings.spec_transport` 全局兜底分支、
   `transport = transport_for_path_source(path_source)` 调用。函数体简化为永远返回 daemon 本地
   路径 `~/.sillyhub/daemon/specs/{ws_id}`（保留 ws_id + settings 入参签名以最小化调用方改动，
   或一并删 settings 入参——按 grep 调用方择优，调用方见下）。**注意**：保留 warn 日志兜底
   逻辑无意义（transport 恒定），一并删 `prompt_spec_root_unknown_transport_fallback_shared`。
3. **`build_scan_bundle`(404-468)**：签名删 `path_source: str | None = None`(412)；删
   `root_path = resolve_root_path_for_daemon(root_path, path_source)`(440) 的 path_source 实参
   （task-03 改函数签名后单参）；删 `host_spec_root = resolve_prompt_spec_root(ws_id, settings,
   path_source=path_source)`(467) 的 path_source 实参，或直接内联 daemon 本地路径。
4. **grep 调用方同步**：`resolve_prompt_spec_root` / `transport_for_path_source` 的所有调用方
   （`build_claim_payload` / stage bundle builder / `build_scan_bundle` 等 context_builder 内
   及跨模块引用）删 path_source 透传。`transport_for_path_source` 删后确认无残留 import。

### spec_paths.py（核实，预期零改动）

5. 读全文核实 `SpecPathResolver` 类无 `path_source` / `platform_managed` 与 path_source 耦合的
   死代码注释（docstring 第 90-91 行提及 "server-local" 字样属注释，按 design P1-4 一并清理
   陈旧文案）。若仅注释提及则改注释；若零引用则本文件跳过。

## 验收标准

- `transport_for_path_source` 函数删除；`resolve_prompt_spec_root` 不再接收 `path_source`，
  永远返回 daemon 本地约定路径 `~/.sillyhub/daemon/specs/{ws_id}`。
- prompt `--spec-root` 计算链（context_builder → build_claim_payload → build_scan_bundle →
  stage prompt）端到端无 `path_source` 残留、无 `transport_for_path_source` 调用。
- daemon-client 工作区 spec-root 解析结果与 daemon 侧 `spec-sync.resolveSpecDir(wsId)` 输出
  一致（R-08，端到端在 task-15 验证）。
- `core/spec_paths.py` 经核实后状态明确（零改动或仅注释清理）。

## verify

```bash
cd backend && uv run pytest app/core -q
cd backend && uv run pytest app/modules/agent -q
cd backend && uv run mypy app/core app/modules/agent/context_builder.py
```

mypy 重点查 context_builder 调用方签名一致性；agent 模块 pytest 覆盖 `build_scan_bundle` /
stage bundle 的 prompt spec-root 断言（task-06 同 Wave 改 agent 其余 path_source，本任务负责
transport helper 子集）。

## constraints

- 协同 task-03（`resolve_root_path_for_daemon` 签名）+ task-06（context_builder 其余 path_source
  贯穿）避免重复改同一行；本任务聚焦 transport helper 三函数。
- 不展开 tilde（`~` 字面量由 daemon 侧展开，backend 只拼字符串，保留现有契约）。
- 不改 daemon 侧 `spec-sync.resolveSpecDir(wsId)` 输出（backend 拼的路径必须与之逐字符一致）。
- `core/spec_paths.py` 不强制改动——若核实零 path_source 引用则该文件本任务跳过，仅保留在
  allowed_paths 以兼容 design §6 原文。
