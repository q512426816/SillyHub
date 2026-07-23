---
author: qinyi
created_at: 2026-07-11 23:30:36
change: 2026-07-11-daemon-client-container-overreach
---

# Proposal: daemon-client 容器越界修复

## 问题

backend 跑在 Docker 容器里，宿主机文件够不到。daemon-client 架构下宿主文件操作必须经 `HostFsDelegate` 委托 daemon，或操作容器内可达的平台托管目录（`spec_ws.spec_root`）。经 Design Grill 三轮核实，当前真问题收敛为三类遗留代码（与最初基于过时记忆的判断不同）：

1. **archive 模块整块死代码**（`backend/app/modules/archive/`）：server-local 时代遗留的 `archive_change` / `distill_knowledge` 两端点——前端零调用、daemon-client 下容器内 `shutil.move` 恒被跳过（`change_dir.exists()` 恒 False）、与 stage dispatch 的 archive stage 完全重叠。归档的正确归属（sillyspec 工具做）**已在代码落地**（`STAGE_AGENT_CONFIG[ARCHIVE]`，daemon agent 跑 `sillyspec run archive`），archive 模块是平行冗余死代码。

2. **`_ensure_change_dir_in_worktree` 容器越界活路径**（`agent/service.py:1208`）：propose/plan/execute/archive 四写阶段恒触发容器内 `shutil.copytree`（源宿主路径、目标容器路径，跨界）；worktree 本身也在容器内创建。execute stage 已改 `requires_worktree=False`（verify 的 D-004），其余未跟上。

3. **scanner/parser 扁平布局 bug**：daemon-client 平台模式下 `spec_root` 是扁平根（无 `.sillyspec` 包裹），但 PostScanValidator（`:156`）/ WorkspaceScanner（`:78-130`）/ WorkspaceParser（`:108`）三处假设老包裹布局 → scan 校验恒报错、rescan 恒 WARN_NO_SILLYSPEC。

> 记忆 `daemon-client-container-overreach-root-cause` 标称"complete_lease 收尾 3 处未修"**已过时**——`2026-07-10-remove-server-local-workspace-mode` task-08/09 已让 apply_patch/post_scan_validation/stage_callback 全链路委托 delegate。

## 方案

**Phase 1 — 删 archive 死代码 + 补 status 投影**：删 backend `archive/` 模块 + 前端 `lib/archive.ts` + 孤立权限常量；补 archive stage 完成时 `change.status="archived"` 投影（唯一新代码，删端点后无人写 status）。归档完全走已有 stage dispatch。

**Phase 2 — change_dir 删死路径**：propose/plan/execute/archive `requires_worktree` 全改 False（对齐 verify）；删 `_ensure_change_dir_in_worktree` + 调用点。

**Phase 3 — scanner/parser 扁平修复**：PostScanValidator:156 改扁平根；WorkspaceScanner scan() 语义翻转；WorkspaceParser projects_subdir 改扁平。

**delegate 写原语不需要**（D-001@v2）：archive 改删死代码后无写宿主源码场景，delegate 现有 9 方法已够。daemon 零改动、不涉及 allowed_roots、无 DB migration。纯 backend + frontend。

## 非目标

- 不补 delegate 写原语（无需求）
- 不清理其他 server-local worktree 遗留死代码（read_verify_result / diff_collector / git_gateway / tool_gateway / worktree 子系统）——独立后续 cleanup
- 不强删 worktree lease 创建逻辑（`_try_acquire_lease` / `WorktreeService.acquire`）——requires_worktree 改 False 后入口死代码，保留不强删（D-003）
- 不改 delegate 协议 / daemon host-fs-handler / DB schema / 生命周期状态机

## 涉及模块

backend（archive 删 / agent 改 / change 改 / workspace 改 / auth 改）+ frontend（archive 死代码删）。跨子项目 backend + frontend。详见 `design.md` §6 文件变更清单。
