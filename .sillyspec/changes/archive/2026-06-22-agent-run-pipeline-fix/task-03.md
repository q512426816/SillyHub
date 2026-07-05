---
id: task-03
title: "[A1][backend+daemon] claim payload 透传 specRoot/runtimeRoot + daemon 双保险翻译"
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/context.py
  - sillyhub-daemon/src/daemon.ts
author: qinyi
created_at: 2026-06-22T21:19:09
---

# task-03: [A1][backend+daemon] claim payload 透传 specRoot + daemon 双保险翻译

## 修改文件

- `backend/app/modules/daemon/lease/context.py:59-79`（`build_claim_payload` interactive 分支）— payload 新增 `specRoot` / `runtimeRoot` 字段，从 `lease_meta` 或 SpecWorkspace 查（当前 interactive 分支只透传 prompt，specRoot 缺失）
- `sillyhub-daemon/src/daemon.ts:1691-1705`（`_startInteractiveSession` 内 prompt 翻译段）— 在现有 SPEC_ROOT_MAP prompt 翻译**之后**追加双保险：若 `execPayload.specRoot` 存在且 prompt 仍含容器路径，再用 payload.specRoot 翻译一次

**注**：design.md §4.1 标的 `backend/app/modules/daemon/service.py:618-638` 是 daemon-service-split 变更**之前**的旧位置；实际函数已迁到 `backend/app/modules/daemon/lease/context.py:40` `build_claim_payload`，interactive 分支在 :59-79（service.py 现仅剩 537 行 facade 转发）。allowed_paths 已对应到真实文件。

## 覆盖来源

- design.md §4.1 A1 第 3 层（backend 防御性透传，不依赖 prompt 字符串）
- design.md §6 接口变更（interactive claim payload 新增 specRoot/runtimeRoot，向后兼容）
- design.md §9 兼容策略（daemon 旧版不读新字段回退 prompt 翻译）
- requirements.md FR-01

## 实现要求

1. **context.py interactive 分支补 specRoot**（:59-79）：当前 payload 只透传 prompt/provider/model/root_path 等，缺 specRoot。改：在 `return payload`（:79）之前追加：
   ```python
   # task-03（2026-06-22-agent-run-pipeline-fix）：透传 spec_root 给 daemon，
   # 与 prompt 内 SPEC_ROOT_MAP 翻译双保险——若 prompt 翻译漏（如 daemon
   # 未配 SPEC_ROOT_MAP），daemon 可直接读 payload.spec_root 做路径归一。
   # 来源优先级：lease_meta.spec_root > SpecWorkspace.spec_root 查 DB。
   spec_root = lease_meta.get("spec_root")
   if not spec_root:
       # lease_meta 缺则查 SpecWorkspace（interactive lease 的 workspace_id 透传）。
       ws_id = lease_meta.get("workspace_id")
       if ws_id:
           from app.modules.workspace.model import SpecWorkspace
           spec_ws = await session.get(SpecWorkspace, ws_id)
           if spec_ws and spec_ws.spec_root:
               spec_root = spec_ws.spec_root
   if spec_root:
       payload["specRoot"] = spec_root            # camelCase（daemon execPayload 消费）
       payload["spec_root"] = spec_root           # snake_case 双写（对齐既有 rootPath/root_path 模式）
       runtime_root = lease_meta.get("runtime_root")
       if runtime_root:
           payload["runtimeRoot"] = runtime_root
           payload["runtime_root"] = runtime_root
   ```
   插入位置：interactive 分支末尾、`return payload` 之前（:79 前）。不要影响 batch 分支（:81 起）。
2. **daemon.ts 双保险翻译**（:1691-1705 附近）：在现有 SPEC_ROOT_MAP prompt 翻译**之后**（即 :1705 之后、`const cwd = ...` 之前）追加：
   ```ts
   // task-03 双保险：若 prompt 仍含容器路径（/data/...）且 payload 显式给了 specRoot，
   // 用 payload.specRoot 做"容器路径 → specRoot 父目录"翻译。覆盖 SPEC_ROOT_MAP 未配 / 翻译漏的场景。
   // 语义：把 prompt 中 execPayload.specRoot 字面替换为"宿主视角 specRoot"——但 daemon
   // 不知道宿主 specRoot 长啥样，所以只能反向用 payload.specRoot 自身作为"应该出现的路径"
   // 做存在性校验：若 prompt 含 payload.specRoot（容器内路径），说明翻译未生效，
   // 记 warn 让用户检查 SPEC_ROOT_MAP 配置（翻译仍依赖 SPEC_ROOT_MAP）。
   const payloadSpecRoot = (execPayload.specRoot as string | undefined) ?? '';
   if (payloadSpecRoot && prompt.includes(payloadSpecRoot) && payloadSpecRoot.startsWith('/data/')) {
     this._logger.warn('interactive_spec_root_still_container_path', {
       lease_id: leaseId,
       payload_spec_root: payloadSpecRoot,
       hint: 'SPEC_ROOT_MAP 未配置或翻译未命中，agent 可能拿到容器内 /data/ 路径导致 EPERM',
     });
   }
   ```
   **说明**：daemon 没法独立做路径翻译（不知道宿主路径），真正的翻译仍由 task-02 的 SPEC_ROOT_MAP 完成。本字段的"双保险"价值在：(a) 给 daemon 一个可观测的 warn 点（prompt 翻译失败时报警）；(b) 给未来扩展留口（如 daemon 通过 RPC 问 backend 宿主路径）。design §4.1 第 3 层说"daemon 端 interactive 路径读取 payload.specRoot 做翻译"——daemon 没宿主路径信息无法独立翻译，本任务实现为"warn 监测 + 字段透传"，等价满足"双保险"语义（监测 + 可观测），不强行做无效翻译。
3. **daemon.ts execPayload 类型**：`execPayload` 是 `LeasePayload`（见 :1676 形参类型）。确认 `LeasePayload` interface 含 `specRoot?` / `runtimeRoot?` 字段；若不含，扩展 interface（在 daemon.ts 内的 interface 定义或 `types.ts` 内）。如 lease payload 归一化在 daemon.ts:1880 附近（`rawExec.rootPath ?? payload.rootPath`），同步加 `specRoot: rawExec.specRoot ?? payload.spec_root`。
4. **不动 batch 分支**：context.py:81 起的 batch 分支不透传 specRoot（batch 不走 interactive prompt 翻译路径，无此问题）。
5. **TDD**：写 backend pytest + daemon 单测覆盖。

## 接口定义

- **claim payload DTO 新字段**（interactive 分支，camelCase + snake_case 双写，对齐既有 `rootPath`/`root_path` 模式）：
  ```json
  {
    "specRoot": "/data/spec-workspaces/abc-123",
    "spec_root": "/data/spec-workspaces/abc-123",
    "runtimeRoot": "/data/spec-workspaces/abc-123/runtime",
    "runtime_root": "/data/spec-workspaces/abc-123/runtime"
  }
  ```
  字段均可选（None / undefined 时 daemon 回退 prompt 翻译）。
- **LeasePayload**（daemon 端 TS interface）扩展：
  ```ts
  interface LeasePayload {
    // ... 既有字段
    specRoot?: string;
    runtimeRoot?: string;
  }
  ```
- **daemon execPayload 归一化**（:1880 附近）：补 `specRoot: rawExec.specRoot ?? payload.spec_root`。
- **日志事件**（daemon 端）：`interactive_spec_root_still_container_path`（warn，含 lease_id / payload_spec_root / hint）。

## 边界处理（≥5 条，覆盖 null/兼容性/异常/不可变/歧义）

1. **specRoot undefined / None（旧 daemon 兼容）** — payload 不含该键（context.py `if spec_root:` 短路不写）→ daemon `execPayload.specRoot` 为 undefined → 双保险 warn 不触发 → 完全回退 task-02 的 SPEC_ROOT_MAP prompt 翻译。向后兼容（design §9）。
2. **specRoot 与 prompt 内路径不一致** — payload.spec_root 是 backend 视角的容器内路径（`/data/spec-workspaces/abc-123`），prompt 内的也是同源拼出的，两者本应一致；若 lease_meta 与 AgentRun.spec_root 快照不一致，**以 prompt 翻译后的为准**（agent 实际执行的是翻译后 prompt 里的路径）。payload.specRoot 只做 warn 监测，不做强制覆盖。
3. **lease_meta 缺 spec_root** — context.py 优先读 `lease_meta.get("spec_root")`，缺失时查 SpecWorkspace（用 lease_meta.workspace_id）。SpecWorkspace 也不存在或 spec_root 为 NULL → spec_root 保持 None → payload 不透传该字段（不报错，向后兼容）。
4. **workspace_id 缺失** — lease_meta 无 workspace_id（如非平台模式 quick-chat）→ 跳过 SpecWorkspace 查询 → spec_root 保持 lease_meta 原值（可能 None）。不报错。
5. **session 查询失败** — `await session.get(SpecWorkspace, ws_id)` 抛 DB 异常 → 让它冒泡到 build_claim_payload 调用方（不吞，与既有 batch 分支 AgentRun 查询一致）。backend claim 接口已有错误处理链。
6. **非平台模式（stage / server-local scan）** — interactive 分支也会被非平台 lease 触发（如 stage_dispatch）。spec_root 在非平台场景可能为相对路径或 None；payload 透传时不做语义判断（只透传字符串），daemon warn 只在 `payloadSpecRoot.startsWith('/data/')` 时触发，非平台 spec_root 不会误报。
7. **daemon execPayload 归一化漏读** — daemon.ts:1880 附近的 `rawExec.rootPath ?? payload.rootPath` 模式需同步补 specRoot；若漏补，`execPayload.specRoot` 为 undefined，双保险失效（但不影响 prompt 翻译，仍向后兼容）。
8. **既有测试 `test_dispatch_metadata.py:213` AC-05** — 该测试断言 batch 分支 payload 字段；本任务改的是 interactive 分支（:59-79），batch 测试不受影响。但需补 interactive 分支的 payload 字段断言测试。

## 非目标

- 不让 daemon 独立做"容器路径 → 宿主路径"翻译（daemon 无宿主路径信息，翻译仍依赖 SPEC_ROOT_MAP）。
- 不改 batch 分支 payload（batch 不走 interactive prompt 翻译）。
- 不改 AgentRun 表结构（spec_root 字段已存在，migrations/202606100900_create_spec_workspaces.py:33）。
- 不改 backend `/execution-context` 路由（router.py:225 已返回 spec_root，本任务只补 claim payload）。
- 不处理 spec_root 快照与 lease_meta 不一致的修复（YAGNI，以翻译后 prompt 为准）。
- 不改 daemon-start.bat（仓库内无此文件，task-02 已文档约定）。

## TDD 步骤

1. **写测试**：扩展 `backend/app/modules/daemon/tests/test_lease_service.py` 或 `test_lease_context.py`（若不存在则新建）：
   - `test_build_claim_payload_interactive_includes_spec_root_from_meta`：构造 interactive lease，lease_meta 含 `spec_root='/data/spec-workspaces/abc'` → 调 `build_claim_payload` → payload 含 `specRoot='/data/spec-workspaces/abc'` 与 `spec_root`（双写）。
   - `test_build_claim_payload_interactive_spec_root_from_workspace`：lease_meta 无 spec_root，含 workspace_id；DB 中 SpecWorkspace.spec_root='/data/spec-workspaces/xyz' → payload.specRoot 等于该值。
   - `test_build_claim_payload_interactive_no_spec_root`：lease_meta 无 spec_root 无 workspace_id → payload 不含 specRoot 键（向后兼容）。
   - `test_build_claim_payload_batch_unchanged`：batch lease 跑通 → payload 不含 specRoot（确认未污染 batch 分支）。
2. **写测试**：扩展 `sillyhub-daemon/src/__tests__/daemon-interactive.test.ts` 或新建 `daemon-spec-root-payload.test.ts`：
   - execPayload.specRoot='/data/spec-workspaces/abc' + prompt 含该路径 → 触发 warn 日志 `interactive_spec_root_still_container_path`。
   - execPayload 无 specRoot → warn 不触发。
   - execPayload.specRoot 不以 `/data/` 开头（非容器路径）→ warn 不触发。
3. **确认失败**：改代码前跑测试，全部失败。
4. **写代码**：按"实现要求"改 context.py（interactive 分支补 specRoot 透传）与 daemon.ts（LeasePayload 扩展 + 归一化 + warn 监测）。
5. **确认通过**：重跑测试，全部通过。
6. **回归**：`cd backend && mypy app && pytest`；`cd sillyhub-daemon && pnpm typecheck && pnpm test`；既有 `test_dispatch_metadata.py` AC-05 仍通过。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | backend 跑 interactive lease claim（lease_meta.spec_root 存在） | 返回 payload JSON 含 `specRoot` 与 `spec_root` 字段，值 = lease_meta.spec_root |
| AC-02 | lease_meta 无 spec_root、含 workspace_id（SpecWorkspace.spec_root 存在） | payload.specRoot 来自 SpecWorkspace 查询结果 |
| AC-03 | lease_meta 无 spec_root 无 workspace_id | payload 不含 specRoot 键（向后兼容，不报错） |
| AC-04 | batch lease claim（kind=batch） | payload 不含 specRoot（batch 分支未污染） |
| AC-05 | daemon 收到 execPayload.specRoot='/data/spec-workspaces/abc' + prompt 含该路径 | 日志出现 `interactive_spec_root_still_container_path`（warn） |
| AC-06 | daemon 收到的 prompt 经 SPEC_ROOT_MAP 翻译后不含容器路径 | warn 不触发（翻译成功，双保险未误报） |
| AC-07 | daemon execPayload 无 specRoot 字段 | warn 不触发；prompt 翻译照常（向后兼容） |
| AC-08 | `cd backend && mypy app` | 无类型错误 |
| AC-09 | `cd backend && pytest`（含新测试） | 全部通过 |
| AC-10 | `cd sillyhub-daemon && pnpm typecheck && pnpm test` | 全部通过；LeasePayload 类型扩展无破坏 |
