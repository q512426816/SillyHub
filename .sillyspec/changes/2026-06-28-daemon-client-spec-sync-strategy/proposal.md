---
author: qinyi
created_at: 2026-06-28 04:17:35
---

# Proposal

## 动机

daemon-client workspace（源码在客户端机器、backend 不可直读）当前创建时被强制设为 `spec_workspaces.strategy='platform-managed'`。此策略下 daemon 用独立缓存 `~/.sillyhub/daemon/specs/{ws}` 跑 sillyspec，源项目自带的 `rootPath/.sillyspec`（用户原本用 SillySpec 管理的项目内容）被完全旁路。当用户把一个已有 `.sillyspec` 的项目作为 daemon-client workspace 接入平台时，平台上的 scan-docs/knowledge/runtime/changes 初始全空，源项目已有内容缺失。

核心问题：用户无法选择源项目已有 `.sillyspec` 如何同步到平台 specRoot/runtimeRoot。

## 关键问题

1. **源项目 .sillyspec 被完全旁路**：daemon `--spec-root` 指向独立缓存 `~/.sillyhub/daemon/specs/{ws}`（daemon.ts:2279），从不读源项目 `rootPath/.sillyspec`。已有 docs/changes/runtime 无法进入平台。
2. **strategy 字段预留但未落地**：`spec_workspaces.strategy` 已有三值（platform-managed/repo-mirrored/repo-native），但 daemon-client 路径只实现 platform-managed，另两个值的语义从未实现（`_ensure_empty_spec_workspace:1116` 硬编码 platform-managed）。
3. **strategy 未透传到 daemon**：daemon 端完全不感知 strategy（grep 零匹配），backend dispatch 时 `spec_strategy="platform-managed"` 硬编码（agent/service.py:1374），即使 strategy 字段有值也传不到 daemon 决策。

## 变更范围

让 daemon-client workspace 创建时用户可选 spec 同步 strategy（三值），方案 A（lease 透传 + daemon 自治）：

- **Phase 1 backend**：WorkspaceCreate 加 spec_strategy 字段；workspace 创建时落 spec_workspaces.strategy；scan lease payload 经 daemon/lease/context.py 透传 strategy；AgentRun.spec_strategy 读真实值；model.py 更新 repo-mirrored 注释。
- **Phase 2 daemon**：types.ts LeaseCtx 加 specStrategy；daemon.ts 读取传入 pullSpecBundle；pullSpecBundle 加 strategy+rootPath 按三分支（platform-managed 现状/repo-mirrored 单次 fs.cp/repo-native 建 junction 跳过覆盖）。
- **Phase 3 daemon**：junction 生命周期（复用/降级）+ repo-native rm 防误删守卫 + packSpecDir 穿 junction push 适配。
- **Phase 4**：前端创建表单 strategy 选项 UI；backend + daemon + 跨平台测试；模块文档更新。
- **Phase 5（task-14 补全）**：daemon-client workspace 详情页加「扫描」入口触发首次/重新 scan-generate（修复 daemon-client 经 create 入口创建后无 scan 触发机制，导致 repo-native/repo-mirrored 下源项目 .sillyspec 数据不回灌平台）；前端 scanGenerate 补 spec_strategy 透传。

## 不在范围内（显式清单）

- **不做 server-local workspace 的 strategy 选项**（D-003）：server-local repo-native 软链接落 backend Docker 容器内，机制不同于 daemon-client 客户端 junction，后续单独变更。
- **不做 strategy 运行时切换**：v1 创建时定死。
- **不做 repo-mirrored 持续双向同步**：D-002 明确仅初始化单次快照。
- **不改 sillyspec CLI 的 `--spec-root` 语义**、不改 daemon 缓存路径。
- **不改 tar transport 通路本身**（build_bundle/apply_sync/postSpecSync 整树覆写语义不变）。
- **不做 server-local 的 .runtime 补全**（copytree 排除 .runtime 的改进，独立变更）。

## 成功标准（可验证）

- **默认零回归**：不传 spec_strategy 时 daemon-client 创建与 scan 行为与现状完全一致（platform-managed，空 spec_root 等 scan）。
- **repo-mirrored 可用**：选 repo-mirrored + 源项目含 .sillyspec，首次 scan 后平台 specRoot 含源项目已有内容（scan-docs/knowledge 非空）。
- **repo-native 可用**：选 repo-native + 源项目含 .sillyspec，daemon 建 junction，scan 直接写源项目，平台经 postSpecSync 落镜像；源项目不存在 .sillyspec 时降级单次导入。
- **安全**：repo-native 下 `rm(specDir)` 被跳过，不会顺 junction 误删源项目 .sillyspec（单测覆盖）。
- **跨平台**：Windows junction（fs.symlink 'junction' 无需提权）/ Linux·macOS symlink 均可建。
- **透传契约**：scan lease payload 含 specStrategy 字段（backend dispatch 集成测覆盖）。
- **首次 scan 可触发**：daemon-client workspace 创建后，经详情页「扫描」按钮触发 scan-generate，repo-native/repo-mirrored 下源项目 .sillyspec 数据回灌平台 specRoot（scan-docs/changes 非空，修复 task-01~13 遗留的创建后无 scan 入口缺口）。
