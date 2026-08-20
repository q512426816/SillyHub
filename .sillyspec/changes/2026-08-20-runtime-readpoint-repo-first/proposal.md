---
schema_version: 1
doc_type: proposal
change_name: 2026-08-20-runtime-readpoint-repo-first
author: qinyi
created_at: 2026-08-20T02:20:00+00:00
---

# Proposal：运行时状态读点修正（仓库优先，缓存回退）

## 一句话

`/workspaces/[id]/runtime` 页经 daemon 实时读取的目标目录从「spec 快照缓存」修正为「优先当前用户 binding 的本机仓库 `<root>/.sillyspec/.runtime/`」，缓存回退；RPC 仅加可选参数，老 daemon 自然兼容。

## 问题

前序变更 2026-08-19-runtime-live-daemon-read 把数据源切到 daemon 实时读取，但读点固定在 `~/.sillyhub/daemon/specs/<wsId>/`。platform-managed 策略下该缓存由平台 bundle 拉取构成，而 bundle 同步设计上排除 `.runtime/` 整树与 `sillyspec.db`；当前 agent 驱动执行流把运行时产物全部写进成员本机仓库的 `.sillyspec/.runtime/`。两者错位导致页面稳定显示「当前工作区没有运行时数据」空态（已实测复现：本工作区缓存无 `.runtime`，仓库 `.runtime` 数据齐全且 `progress dump` 可用）。

## 方案要点

1. backend 四个 `runtime.*` RPC params 加 `root_path`（当前用户 binding 行，经 `resolve_root_path_for_daemon` 容器→宿主改写）。
2. daemon 读点选择：`root_path` 过 `assertWithinAllowedRoots` 且 `<root>/.sillyspec/.runtime` 存在 → 读仓库；否则回退缓存（校验失败也回退，页面不因脏配置挂）。
3. 前端 user-inputs 显示截断（50000 字符取尾部）+ 副标题文案更新。

## 收益

- 所有工作区 / 成员 / 策略统一修复，页面显示真实工作流状态。
- 老 daemon 忽略新参数，零版本门控、零迁移、可即时回滚（停发参数即回现状）。
- 安全复用 explorer 同款 realpath 级防线，攻击面不扩大。

## 非目标 / Non-Goals

- **不做双源合并**：仓库 `.runtime` 存在时，平台触发 scan/gate 写缓存的数据不可见（首版接受，未来需要再做 mtime 合并）。
- **不改 SpecWorkspace 策略**：不把工作区切 repo-native（方案 B 已否决：缓存残留静默降级坑 + 牵动整个同步行为）。
- **不给 user-inputs 传输加大小上限**：观察期不加（1.4MB 实测在 WS 限制内；加限会让数据静默不完整）。
- **不做 runtime 页 UI 重构**：仅截断与文案。

## 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 成员 binding root_path 失效（换目录/换机器） | 低 | 校验失败回退缓存，页面保持可用 |
| 新老 daemon 混布期间行为不一致 | 低 | 不一致方向是「修好 vs 现状」，无破坏性 |
| 大 user-inputs 渲染卡顿 | 低 | 前端截断 50000 字符 |
