---
author: WhaleFall
created_at: 2026-08-04 11:04:59
---

# 提案书（Proposal）

## 动机
daemon 早已上报版本（语义版本 `0.1.0` + 构建号 `git-sha-时间戳`），但用户在 /runtimes 看不到版本变化。根因有二：① backend 6 个 runtime 读端点漏 JOIN `daemon_instances`，版本字段恒 null；② 构建号只在 `pnpm bundle` 时更新，dev rebuild 不变。本变更让版本可见 + 每次编译构建号自动变。

## 关键问题
1. **版本看不见**：`GET /api/daemon/runtimes` 等 6 个端点 service 漏 JOIN `daemon_instances`、router 没 `_runtime_read` 填充，DTO `daemon_version/daemon_build_id` 恒 null。daemon 上报了、backend 存了，但读端点断链（`router.py:946` + `service.py:415-422`）。仅 machines 端点 JOIN 正常。
2. **改了 daemon 版本不变**：`BUILD_ID` 由 `src/build-id.ts` 提供，硬编码 `4c238ebe-...`，只有 `pnpm bundle`（打包分发，`build-bundle.sh:29-39`）重写；`pnpm build`（开发编译）不更新。本地开发 rebuild 构建号恒定。
3. **0.1.0 误解**：语义版本 `0.1.0` 是手动管理的大版本里程碑，本就不该每次提交变；用户要的"每次改都变"应由构建号（每次编译唯一标识）承载。

## 变更范围
- **A. sillyhub-daemon**：新增 `scripts/gen-build-id.mjs`（跨平台生成 `<git-sha>-<时间戳>`），`pnpm build`（prebuild）+ `pnpm bundle`（build-bundle.sh）共用；`src/build-id.ts` 移出版控（`.gitignore` + `postinstall`/`prebuild` 自动生成）。
- **B. backend**：`list_runtimes` 等 6 个 runtime 端点 service 加 `JOIN daemon_instances`，router 复用 `_runtime_read` 填充 `daemon_version/daemon_build_id`。

## 不在范围内（显式清单）
- 不改 daemon 上报逻辑（`hub-client.ts` 已正确上报）。
- 不改语义版本 0.1.0（`package.json`，手动管理大版本）。
- 不改前端 `/runtimes`（C-002 已用 machines 端点显示版本 + 构建号短码）。
- 不改 daemon 生命周期（register/heartbeat/session/lease/state 不变）。

## 成功标准（可验证）
- `GET /api/daemon/runtimes`（及 5 个单 runtime 端点）register 后返回 `daemon_version/daemon_build_id` 非 null（与 machines 端点一致）。
- `pnpm build` 后 `BUILD_ID` 变化（git sha + 新时间戳），dev rebuild 立即见效。
- `build-id.ts` 移出版控后，clone + `pnpm install` + `pnpm build` 不缺文件（postinstall/prebuild 生成）。
- `pnpm bundle` 后 `latest.json` version 仍能被 backend 正则提取（self-update 链路不破）。
- 旧 daemon（不上报版本）仍兼容（字段 Optional，instance=None 返回 None）。
