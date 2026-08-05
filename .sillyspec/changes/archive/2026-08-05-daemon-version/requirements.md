---
author: WhaleFall
created_at: 2026-08-04 11:04:59
---

# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 开发者 | 改 daemon 代码、`pnpm build` 编译、查 /runtimes 确认版本 |
| daemon 客户端 | 上报版本（已有），经 `/api/daemon/register` + heartbeat |
| 平台调用方 | 调 `GET /api/daemon/runtimes` 等，期望返回 `daemon_version` |

## 功能需求

### FR-01: runtime 读端点返回 daemon 版本（覆盖 D-004@v1）
**Given** 一个已注册的 daemon（`daemon_instances` 有 version/build_id）
**When** 调用 `GET /api/daemon/runtimes`（或单 runtime read/update/disable/enable/offline）
**Then** 响应 `daemon_version/daemon_build_id` 非 null，与 machines 端点一致

**Given** 旧 daemon 未上报版本（`daemon_instances.version` 为 NULL）
**When** 调用上述端点
**Then** `daemon_version/daemon_build_id` 为 null（行为不变，不报错）

### FR-02: 构建号每次 build 自动变化（覆盖 D-001@v1, D-002@v1）
**Given** daemon 源码有改动并 git commit
**When** 执行 `pnpm build`（tsc）
**Then** `src/build-id.ts` 的 `BUILD_ID` 重新生成为 `<新 git short sha>-<yyyymmddhhmmss>`，与上次 build 不同

**Given** 在非 git 目录执行 `pnpm build`
**When** `gen-build-id.mjs` 无法取 git sha
**Then** `BUILD_ID` fallback 为 `"unknown-<yyyymmddhhmmss>"`（仍带时间戳，tsc 不报错）

### FR-03: build-id.ts 移出版控后 tsc 不缺文件（覆盖 D-003@v1）
**Given** 全新 clone 仓库（无 `src/build-id.ts`）
**When** 执行 `pnpm install`
**Then** postinstall 触发 `gen-build-id.mjs` 生成 `src/build-id.ts`（默认值），后续 `pnpm build` 正常

**Given** `build-id.ts` 已在 `.gitignore`
**When** 执行 `pnpm build`
**Then** prebuild 重新生成 `build-id.ts`，`git status` 不显示该文件改动

## 非功能需求
- **兼容性**：旧 daemon 不上报版本时行为不变（Optional 字段 + instance=None 守卫）；项目未上线不要求历史兼容（CLAUDE.md 规则 11）。
- **跨平台**：`gen-build-id.mjs` 在 Windows/Linux/macOS 均跑（node + spawnSync git，git 缺失 fallback），符合 CLAUDE.md 规则 13。
- **可回退**：`build-id.ts` 可手动写回版控（移除 .gitignore）；JOIN 改动可回退（端点恢复裸 model_validate）。
- **可测试**：JOIN 修复有 register→list 断言；gen-build-id 有正则提取回归（守护 self-update 链路 `_compute_daemon_version`）。

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02 | 构建号承载"每次改都变"，语义版本手动管理 |
| D-002@v1 | FR-02 | 方案1 共享 gen-build-id.mjs（dev/prod 同源，否决运行时探测/post-tsc）|
| D-003@v1 | FR-03 | build-id.ts 移出版控 + postinstall/prebuild 双保险生成 |
| D-004@v1 | FR-01 | backend 6 端点 JOIN 修复，不动 daemon 上报与前端 |
