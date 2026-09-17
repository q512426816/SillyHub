# verify lint 门在全新快照必挂：daemon 生成产物 build-id 未随快照供给

- 发现日期：2026-09-16（变更 2026-09-16-mobile-changes-parity verify Step 6）
- 状态：活跃坑（待工具修复）

## 现象

`verify` Step 6 noAI 质量扫描实测 `commands.lint` 全链退出码 2，失败点定位在链尾 `sillyhub-daemon pnpm typecheck`（tsc）。但：

- 主仓同链全绿：backend ruff 0 / ruff format 0 / mypy 0、frontend `pnpm lint` 0、daemon `tsc --noEmit` 0；
- 报错根因为 `Cannot find module './build-id.js'`——`sillyhub-daemon/src/build-id.ts` 是 **postinstall/prebuild 生成产物**（`node scripts/gen-build-id.mjs`，见 sillyhub-daemon/package.json:21-22；`sillyhub-daemon/.gitignore:6` 忽略 `src/build-id.ts`），git 不追踪；
- verify 门隔离快照（`%TEMP%/sillyspec-gate-*`：HEAD + 本变更文件 overlay）不跑 postinstall，生成产物必然缺失 → daemon tsc 必挂。worktree 同样缺（worktree-deps 用 junction 链接主仓 node_modules，跳过 postinstall）。

## 影响

任何变更（即使 0 个 daemon 文件）走 verify lint 硬门都可能被此环境问题阻断；目前只能 `SILLYSPEC_VERIFY_LINT_GATE=advisory` 绕过（审计留痕），失去 daemon typecheck 的真实门禁价值。

## 建议修复方向（工具侧）

verify 快照/worktree 供给链里补一步产物生成（如 lint 命令前对 sillyhub-daemon 跑 `node scripts/gen-build-id.mjs`，或 worktree-deps provisioning 对含 postinstall 的包执行 postinstall）。

## 临时绕过

`SILLYSPEC_VERIFY_LINT_GATE=advisory` + 在 verify-result.md 记录主仓全链实跑证据（见 2026-09-16-mobile-changes-parity/verify-result.md「测试结果」节）。

## 处置记录（2026-09-17 定时收口，机制+配置齐备，归档）

- **机制侧已在位**（并行会话同日落地，sillyspec 仓 51d6f6e「门禁摩擦五连修」）：`gate_snapshot.copy` 配置面——`createGateSnapshot` 按主仓 local.yaml 的 copy 清单把 gitignored 生成物 junction/复制进快照（overlay 之后应用、逐条 fail-open、活链接写穿警告）。本坑正是该机制的靶场景（同日「驾驭小结④」实证）。
- **配置侧本轮补齐**（平台仓 `.sillyspec/local.yaml`，机器本地）：`gate_snapshot.copy: [sillyhub-daemon/src/build-id.ts]`（快照侧）+ `worktree.supplyFiles: [sillyhub-daemon/src/build-id.ts]`（worktree 侧同坑——worktree-deps junction 跳过 postinstall 同样缺）。**其他机器需各配一份**（local.yaml gitignored，注释已写明）。
- **端到端实证**：对本仓真跑 `createGateSnapshot` → 快照内 `sillyhub-daemon/src/build-id.ts` 存在 ✅（copy 面报备 1 条目）；`applyGateSnapshotCopy` 单独冒烟同过。存量已建 worktree 需手动 copy 一次（供给只在 create 发生）。
- 效果：verify lint 硬门不再因环境缺生成物假挂，`SILLYSPEC_VERIFY_LINT_GATE=advisory` 绕过不再需要（保留为其他环境问题的出口）。归档。
