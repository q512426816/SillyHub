---
id: task-10
title: start_scan_dispatch 重构（agent/service.py:1330）（覆盖：FR-04）
author: qinyi
created_at: 2026-07-06 19:28:16
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@V1, D-004@V1]
allowed_paths:
  - backend/app/modules/agent/service.py
provides: []
expects_from:
  task-01:
    - contract: HostFsDelegate
      needs: [stat, list_dir]
goal: >
  把 start_scan_dispatch 入口的容器内 stat/路径校验重构为 HostFsDelegate 调用，path_source 分流内聚到 delegate，server-local 行为不变。
implementation:
  - "读源定位 AgentService.start_scan_dispatch 入口：path_source 取值→resolve_root_path_for_server→if server_root is not None 块内一组宿主 stat（daemon-client 时整块被跳过、静默放行）"
  - "构造 HostFsDelegate（task-01 提供），用 delegate.stat 替换 work_dir.exists/.is_dir，资产保护检测改用 delegate.list_dir(changes)+delegate.stat(sillyspec.db)，错误文案与 details 结构保持不变"
  - "内聚分流：删 if server_root is not None 包裹与 resolve_root_path_for_server 调用，path_source 二分逻辑下沉到 delegate 内部"
  - "不动 dispatch 后段（build_scan_bundle/AgentSession/AgentRun/placement/path_source 透传），仅改入口校验块"
  - "与 task-09（resolve_work_dir）同文件，execute 时按 task-09→task-10 顺序合并改 agent/service.py 避免行号漂移"
acceptance:
  - "daemon-client workspace 触发 scan dispatch：root_path 校验与 .sillyspec 资产保护检测经 HostFsDelegate RPC 在宿主执行（不再被 server_root is None 静默跳过）"
  - "server-local workspace：dispatch 行为零回归，资产保护检测仍命中已托管项目"
  - "grep -n resolve_root_path_for_server backend/app/modules/agent/service.py：start_scan_dispatch 内不再出现该调用"
  - "grep -rn 'path_source != daemon-client' backend/app/modules/agent/service.py：start_scan_dispatch 路径无新增散落 if"
verify:
  - "cd backend && uv run pytest app/modules/agent/ -q"
constraints:
  - "与 task-09 同改 backend/app/modules/agent/service.py，execute 阶段合并提交、按 task-09→task-10 顺序应用避免行号冲突"
  - "仅重构，不改 scan dispatch 协议（build_scan_bundle/placement/lease payload 不动）、不改错误文案与 details 字段"
  - "依赖 task-01 的 HostFsDelegate stat/list_dir；RPC 失败按 task-04 容错策略（warn+不阻塞 dispatch，server-local 等价本地分支兜底），本任务不实现超时/重试"
  - "零回归：server-local 现有 scan/资产保护测试全绿（NFR-02）"
---

# task-10 start_scan_dispatch 重构

## goal

把 `start_scan_dispatch`（`backend/app/modules/agent/service.py:~1329-1360`）入口的容器内 `stat` / 路径校验重构为 `HostFsDelegate` 调用，去掉靠 `resolve_root_path_for_server` 返回 `None` + `if server_root is not None` 实现的隐式 path_source 散落分流。daemon-client 模式下「root_path 存在/是目录」与「.sillyspec 资产保护」检测改由 HostFsDelegate RPC 在宿主做；server-local 模式行为不变（path_source 分流内聚到 delegate，D-004）。

## implementation

1. 读源定位：`AgentService.start_scan_dispatch` 入口 `path_source = workspace.path_source if workspace else "server-local"`（line 1303）→ `server_root = resolve_root_path_for_server(root_path, path_source)`（line 1330）→ `if server_root is not None:` 块（line 1331-1360）内做 `work_dir.exists()` / `.is_dir()` / `(work_dir / ".sillyspec")` / `_changes_dir.iterdir()` / `(local_ss / "sillyspec.db").exists()` 一组宿主 stat，daemon-client 时整块被跳过（校验缺位、静默放行）。
2. 构造 HostFsDelegate（task-01 提供），在 dispatch 入口统一调用：
   - 用 `delegate.stat(workspace, server_root_or_root_path)` 替换 `work_dir.exists()` / `.is_dir()`（exists/is_dir/size 一次返回）。
   - 资产保护检测：`.sillyspec/changes/` 非空 + `sillyspec.db` 存在两判定，改用 `delegate.list_dir(workspace, "<root>/.sillyspec/changes")` + `delegate.stat(workspace, "<root>/.sillyspec/sillyspec.db")`（命中任一即 `_has_assets=True`）。
   - 错误信息保持原 `AgentRunError` 文案与 `details` 结构（root_path / server_path / sillyspec_dir）不变，仅判定来源从本地 stat 换 delegate。
3. 内聚分流：删掉 `if server_root is not None:` 包裹 + 顶部的 `resolve_root_path_for_server` 调用，path_source 二分逻辑下沉到 delegate 内部（daemon-client→WS RPC，server-local→本地容器 stat），调用方只描述「要校验什么」。
4. 不动 dispatch 后段（build_scan_bundle / AgentSession / AgentRun / placement / `path_source` 透传到 bundle line 1384），本任务仅改入口校验块。
5. 注意：`resolve_work_dir`（line 265，task-09）与本任务同文件，execute 时按 task-09+task-10 合并改 `agent/service.py`，避免行号漂移反复。

## 验收标准

- daemon-client workspace 触发 scan dispatch：root_path 校验与 `.sillyspec` 资产保护检测经 HostFsDelegate RPC 在宿主执行（不再被 `server_root is None` 静默跳过）。
- server-local workspace：dispatch 行为零回归，资产保护检测仍命中已托管项目（现有保护语义不变）。
- `grep -n "resolve_root_path_for_server" backend/app/modules/agent/service.py`：`start_scan_dispatch` 内不再出现该调用（path_source 分流内聚到 delegate）。
- `grep -rn "path_source != ['\"]daemon-client['\"]" backend/app/modules/agent/service.py`：`start_scan_dispatch` 路径无新增散落 if（task-09 处理 resolve_work_dir 那处，本任务不动）。

## verify

```bash
cd backend && uv run pytest app/modules/agent/ -q
```

补充：`grep -n "start_scan_dispatch" backend/app/modules/agent/` 确认测试覆盖（daemon-client + server-local 双路径），若资产保护分支无 daemon-client 用例补一条断言 RPC 命中。

## constraints

- 与 task-09 同改 `backend/app/modules/agent/service.py`，execute 阶段合并提交、按 task-09→task-10 顺序应用避免行号冲突。
- 仅重构，不改 scan dispatch 协议（build_scan_bundle / placement / lease payload 不动）、不改错误文案与 details 字段。
- 依赖 task-01 的 HostFsDelegate `stat` / `list_dir`；RPC 失败按 task-04 容错策略（warn + 不阻塞 dispatch，server-local 等价本地分支兜底），本任务不实现超时/重试。
- 零回归：server-local 现有 scan / 资产保护测试全绿（NFR-02）。
