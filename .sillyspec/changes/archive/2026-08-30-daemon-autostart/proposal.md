---
author: qinyi
created_at: 2026-08-30 22:42:00
---

# 提案书（Proposal）

## 动机

daemon 目前只能手动前台启动（`sillyhub-daemon start`），机器重启后不再运行，任务无法执行。用户（尤其非技术用户）需要记住并重新手动启动。需要在安装 daemon 后指导用户完成开机（或登录）后自启动配置，且以一条可复制执行的"一键"命令完成。

## 关键问题

1. **无任何自启机制**：全仓库无 systemd/launchd/Windows 服务/计划任务注册代码（preflight.ts 注释、CONCERNS.md L51、quicklog ql-20260828-004 三处明确记录）；重启后 daemon 静默离线，任务积压。
2. **现有指引断层**：/runtimes 页只指引安装与首次启动，装完之后"每次开机都要手动跑一次"没有任何产品化路径；install.ps1 注释 DG-04 明确"no auto start，装完只打印下一步命令"。
3. **自更新机制不覆盖重启场景**：respawnDaemonAndExit 仅处理"版本更新时的进程交接"，机器重启/崩溃后无任何拉起方。

## 变更范围

- daemon 新增 `src/autostart.ts` 模块 + CLI `autostart enable/disable/status` 子命令组（方案 A，D-005）。
- 三平台原生注册：Windows schtasks ONLOGON + VBS 隐藏窗口；macOS LaunchAgents plist（RunAtLoad，无 KeepAlive）；Linux systemd user service（无 Restart）+ enable-linger best-effort（D-002/D-003）。
- enable 复用 start 凭据管线（per-server config 落盘，D-004）。
- 前端 /runtimes 页新增「开机自启动（可选）」指引折叠块（含复制按钮，三平台同一命令）。
- install.sh/install.ps1 尾部"下一步"提示追加自启命令；README 新增小节。
- 模块文档同步（新增 autostart.md，更新 cli.md/preflight.md/CONCERNS.md）。

## 不在范围内（Non-Goals）

- 不做崩溃保活（KeepAlive/Restart 型）——D-002 用户确认。
- 不做安装脚本 `--autostart` 内置注册参数——D-001 用户确认（脚本仅提示命令）。
- 不引入 pm2/NSSM/WinSW 等外部进程管理器/依赖——D-005。
- 不改变 daemon↔backend 通信协议、注册/心跳/租约行为（生命周期契约：无）。
- 不做系统级/root 安装（全部用户级，免管理员）。
- 不做凭据加密存储改造（per-server config 明文落盘为现状安全模型）。

## 成功标准（可验证）

- 未执行 autostart 命令的用户行为与现状完全一致（不注册零感知）。
- `sillyhub-daemon autostart enable --server <url> --api-key <key>` 在三平台各自注册成功（Windows 实机冒烟 + macOS/Linux mock 单测/CI 矩阵），开机（或登录）后 daemon 自动启动并正常连接 server。
- `autostart disable` 完整清理注册（系统任务 + VBS + 本地记录），不影响运行中进程。
- `autostart status` 正确展示注册列表与系统实况。
- 凭据缺失时 enable 报错退出（exit 1）且不注册半残任务；--token 注册时输出过期警告。
- 重复 enable 幂等覆盖；不同 server 各自独立注册互不干扰。
- backend 代码/协议/API 零改动；现有 5 个 CLI 命令行为不变。
