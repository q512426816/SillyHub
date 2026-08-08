---
id: task-10
title: allowed_roots integration guide + smoke pre-check script
title_zh: allowed_roots 集成指引 + smoke 前置硬校验脚本
author: qinyi
created_at: 2026-08-08 17:39:23
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: []
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\docs\integrations\sillyspec-dispatch.md
  - C:\Users\qinyi\IdeaProjects\multi-agent-platform\scripts\check-dispatch-allowed-roots.mjs
---

## goal
> 写路径A 部署集成指引（workspace root_path=SillySpec 仓根 + daemon allowed_roots 两源配置约定）+ smoke 前置硬校验脚本（dispatch 前验证 daemon allowed_roots 含 caller 仓根，不含则非零退出 + 中文引导），让 R-03 在部署期 fail-fast 而非 dispatch 时才报 forbidden。

## implementation
- 新建 `docs/integrations/sillyspec-dispatch.md`：
  - 部署模型：路径A workspace root_path = SillySpec caller 仓根；worker cwd = 仓内 worktree（`.sillyspec/.runtime/worktrees/<change>/`），落仓内前缀故单个仓根即放行整族 worktree
  - allowed_roots 两源（须都含仓根）：① 本地 config `~/.sillyhub/daemon/config-<server_hash>.json` 的 `allowed_roots` 数组（`DaemonConfig.allowed_roots`，config.ts:282，默认 `[homedir()]`）→ 喂 `assertWithinAllowedRoots`（file-rpc.ts:70，host-fs-handler 的 run_command cwd / list_dir / 文件操作走这条，越界抛 `forbidden 'path outside allowed_roots'`）；② backend runtime overlay `PolicyEngine.allowedRoots`（filesystem-policy.ts，经心跳/WS 下发的 per-runtime 策略）→ agent 写类工具（claude Write/Edit）走这条，deny 文案「目标目录未配置为可写目录」
  - 配置示例（JSON 片段：`allowed_roots` 追加仓根绝对路径，不展开 `~`，Windows 盘符保留）+ runtime overlay 配置入口指引
  - 守卫触发点表 + 排查指引（forbidden → 查本地 config；deny 写类 → 查 backend runtime policy）
- 新建 `scripts/check-dispatch-allowed-roots.mjs`（纯 Node ESM，不依赖 daemon 进程）：
  - 接受 `--repo-root <path>`（默认 `process.cwd()`）+ 可选 `--server-url`（定位 per-server config，缺省扫 `~/.sillyhub/daemon/config-*.json` 全量校验）
  - 读 config 取 `allowed_roots`，对仓根做 `realpath` + 边界敏感前缀比较（复用 file-rpc.ts:88 `under` 语义：`resolved===root` 或 `startsWith(root+sep)`，Windows 盘符 toLowerCase 归一）
  - 仓根不在任一 root → `process.exit(1)` + 中文引导（追加到哪个 config 字段 + JSON 示例 + runtime overlay 提示）；config 缺失 / 无 allowed_roots 也判失败（fail-closed）

## acceptance
- 文档含：root_path=仓根约定 + allowed_roots 两源（本地 config / runtime overlay）+ 守卫触发点（assertWithinAllowedRoots / PolicyEngine）+ 配置 JSON 示例
- 脚本：仓根在 allowed_roots → EXIT 0；不在 / config 缺失 → EXIT 1 + 引导文案
- 跨平台：Windows 盘符大小写归一 + POSIX 大小写敏感均正确（对照 file-rpc.ts:82-95）
- 脚本不启动 / 不依赖 daemon 进程，纯读 config.json 文件

## verify
- `node scripts/check-dispatch-allowed-roots.mjs --repo-root <已配仓根>` → EXIT 0
- `node scripts/check-dispatch-allowed-roots.mjs --repo-root <未配路径>` → EXIT 1 + 引导
- 人工对照：文档守卫描述 vs `file-rpc.ts:70` + `config.ts:282/352` + `policy/filesystem-policy.ts:201` 一致

## constraints
- 纯文档 + 独立脚本，不改 `src/` / `backend/` 代码（allowed_roots 配置机制已存在，复用）
- 与 task-12（sillyspec probe.js 运行期 rootPath 越界校验）互补：本脚本=部署期一次性自检，probe.js=dispatch 前运行期校验；与 task-13（端到端 smoke）分工：本任务非端到端
- 脚本 fail-closed：读不到 config / allowed_roots 空 → 判失败 + 引导（不 fallback homedir）
- 跨仓边界：脚本读 SillyHub daemon config（本仓产物），caller 仓根经 `--repo-root` 传入，不耦合 sillyspec 仓源码
