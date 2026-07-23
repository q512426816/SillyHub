---
author: qinyi
created_at: 2026-07-08T21:55:21
id: task-10
title: bundle + 部署 daemon
priority: P0
estimated_hours: 2
depends_on: []
blocks: []
allowed_paths:
  - sillyhub-daemon/scripts/build-bundle.sh
goal: 打 daemon bundle + rebuild backend 镜像同步分发物 + 重启 daemon（self-update 二次启动）+ 端到端冒烟验证
implementation: 执行 build-bundle.sh 打单文件 bundle；docker compose build/up backend 同步分发物并确认 health；按 --server 区分停 daemon 后二次启动至 start.log 出现 daemon.started 无 need_restart；跑 verify stage 端到端冒烟
acceptance: bundle 产物存在且 --version 正常；backend health commit_sha 非 unknown；daemon 启动→self-update 退出→二次启动驻留无 need_restart；端到端 verify 不 5min 超时；sillyspec CLI 写临时路径不 deny
verify: node build/bundle/sillyhub-daemon.js --version；curl http://127.0.0.1:8001/health；start.log 到 daemon.started 无 need_restart；前端 daemon 列表 online
constraints: 改 daemon 必须 rebuild backend 镜像否则 self-update 退出循环；停 daemon 按 --server 区分别 taskkill /IM 通杀；Windows daemon-start.bat 需 CRLF；本变更无 migration 但若 worktree 部署需确认已 merge
covers: [R-04]
---
# task-10: bundle + 部署 daemon

## 文件
执行 sillyhub-daemon/scripts/build-bundle.sh
执行 docker compose rebuild backend
执行 daemon 重启流程

## 操作步骤
### 1. 打 daemon bundle
1. 在 `sillyhub-daemon/` 根目录执行 `bash scripts/build-bundle.sh`（scripts/build-bundle.sh:1-61）：
   - 步骤 [0/3] 注入 BUILD_ID（git short SHA + 时间戳）到 `src/build-id.ts`。
   - [1/3] `pnpm build`（tsc 编译 src→dist）。
   - [2/3] `pnpm exec ncc build dist/cli.js -o build/bundle`（单文件内联）。
   - [3/3] 复制 `index.js → sillyhub-daemon.js`。
2. 验证产物：`node build/bundle/sillyhub-daemon.js --version` 能输出版本号。
3. 产物路径：`sillyhub-daemon/build/bundle/sillyhub-daemon.js`（install.sh 下载此文件名，backend 镜像分发物同步用）。

### 2. rebuild backend 镜像（同步分发物）
4. backend 镜像内嵌 daemon bundle 作为分发物（daemon self-update 按 backend manifest 对齐本地 bundle，参考 memory `daemon-self-update-downgrades-manual-bundle`）。改了 daemon 代码必须 rebuild backend 镜像，否则 daemon 启动 self-update 比对发现本地 bundle 与 manifest 不一致 → need_restart 退出循环。
5. 在项目根 `C:\Users\qinyi\IdeaProjects\multi-agent-platform` 执行：
   ```bash
   docker compose build backend
   docker compose up -d backend
   ```
6. 确认 backend health：`curl http://127.0.0.1:8001/health`（用 127.0.0.1 非 localhost，IPv6 坑，参考 memory `docker-localhost-ipv6-use-127.0.0.1`），`commit_sha` 非.unknown。

### 3. 重启 daemon（self-update 二次启动）
7. 停当前 daemon（按 `--server` 区分，勿 taskkill /IM 通杀，参考 memory `claude-exe-orphan-cleanup` / `multi-daemon-instances`）。
8. 启动 daemon（`daemon-start.bat` 或手动 `node sillyhub-daemon.js --server <url>`）：
   - 首次启动：daemon self-update 发现 bundle 与 backend manifest 不一致 → need_restart 自动退出。
   - 等待 `~/.sillyhub/daemon/start.log` 出现 `daemon.started`（无 need_restart）。
   - 二次启动：daemon 与 manifest 对齐，正常驻留。
9. 验证 daemon 在线：backend `/runtimes` 或前端 daemon 列表显示该 daemon online；`start.log` 无 need_restart 退出记录。
10. 验证 permissionMode 改回 default（task-02 生效）：daemon 日志无 "Runtime Policy 拒绝 c:\dev\null" 之类 bypassPermissions 下的 canUseTool 调用残留（bypass 撤回后 canUseTool 仍注入但走 scan 模式分流）。

### 4. 端到端冒烟
11. 跑一次 verify stage dispatch（或 scan），观察：
    - AskUserQuestion 弹框能等前端响应（不 5min 超时）。
    - 非 AskUserQuestion 工具 allow-through（不卡人审）。
    - sillyspec CLI 写临时路径不被 deny。
    - complete_lease 后 `changes.stages.last_dispatch.status` 推进（查 DB 或前端 stage 状态）。

## 验收标准
- `sillyhub-daemon/build/bundle/sillyhub-daemon.js` 存在且 `--version` 正常。
- backend 镜像 rebuild + health `commit_sha` 非 unknown。
- daemon 启动→self-update 退出→二次启动驻留，`start.log` 到 `daemon.started` 无 need_restart。
- 端到端 verify 不 5min 超时（design §1 根因 1 消除）。
- sillyspec CLI 能执行（写临时路径不 deny）。

## 验证
- pnpm bundle 生成 sillyhub-daemon.js
- docker compose build backend
- 重启 daemon → start.log 到 daemon.started 无 need_restart
- 端到端：重跑 verify stage 不 5min 超时

## 依赖
task-01~06 全部实现完成（bundle 包含所有 daemon + backend 改动）。task-07/08/09 测试通过后再部署更稳，但 bundle 本身可在测试通过前先打（部署放最后）。

## 风险
- R-04：daemon self-update 升降级都触发 need_restart 退出，无 supervisor 须手动二次启动（memory `daemon-self-update-downgrades-manual-bundle`）。若忘二次启动，daemon 退出后不驻留，backend 显示 offline。
- backend 镜像不 rebuild 只 cp bundle 无效：daemon 启动按 backend 分发 manifest 对齐本地 bundle，manifest 与 bundle 不一致就退出（同上 memory）。
- 多 daemon 实例（连本地 + 连远程）：停 daemon 按 `--server` 区分别误杀（memory `multi-daemon-instances`）。
- worktree migration 污染部署：若 execute 阶段用了 worktree 且 migration apply 到本地 PG，切回 main 部署会断链（memory `worktree-migration-pollutes-deploy`）。本变更无 migration，但若 execute 走 worktree 需确认 worktree 已删除/merge。
- Windows daemon-start.bat 需 CRLF（memory `daemon-restart-session-recovery-fix`）。
