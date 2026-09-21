## FR-autostart-001 Windows 注册开机（登录）自启
变更：2026-08-30-daemon-autostart
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Windows 系统且 daemon 已安装（bundle 存在于 ~/.sillyhub/daemon/bin/） 同一 server 已注册过；When 用户执行 `sillyhub-daemon autostart enable --server <url> --api-key <key>` 且凭据有效 再次执；Then 生成隐藏窗口 VBS 中转脚本（`~/.sillyhub/daemon/autostart-<hash8>.vbs`，`Run ..., 0, False`）并
全文：.sillyspec/changes/archive/2026-08-30-daemon-autostart/requirements.md#FR-01
最近确认：171a2f348

## FR-autostart-002 macOS 注册开机（登录）自启
变更：2026-08-30-daemon-autostart
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given macOS 且 daemon 已安装 SSH-only 会话无 GUI domain；When 执行 enable 且凭据有效 bootstrap 失败；Then 写 `~/Library/LaunchAgents/com.sillyhub.daemon.<hash8>.plist`（ProgramArguments=[n
全文：.sillyspec/changes/archive/2026-08-30-daemon-autostart/requirements.md#FR-02
最近确认：171a2f348

## FR-autostart-003 Linux 注册开机（登录）自启
变更：2026-08-30-daemon-autostart
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Linux 且 daemon 已安装 PID1 非 systemd（WSL 默认/容器）；When 执行 enable 且凭据有效 执行 enable；Then 写 `~/.config/systemd/user/sillyhub-daemon-<hash8>.service`（ExecStart 同上模板、Wanted
全文：.sillyspec/changes/archive/2026-08-30-daemon-autostart/requirements.md#FR-03
最近确认：171a2f348

## FR-autostart-004 enable 凭据管线与校验
变更：2026-08-30-daemon-autostart
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户带 --api-key（或 --token）执行 enable config 与命令行均无凭据 凭据来源是 --token（短时效 JWT） node 路径；When CLI 处理 执行 enable 注册成功 注册成功
全文：.sillyspec/changes/archive/2026-08-30-daemon-autostart/requirements.md#FR-04
最近确认：171a2f348

## FR-autostart-005 disable 取消自启
变更：2026-08-30-daemon-autostart
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 存在注册（本地记录 + 系统注册）；When 执行 `autostart disable --server <url>`（单个注册时可省略 --server；多个时列出供选择；`--all` 全清）；Then 注销系统注册（schtasks /Delete /F / launchctl bootout + 删 plist / systemctl --user disa
全文：.sillyspec/changes/archive/2026-08-30-daemon-autostart/requirements.md#FR-05
最近确认：171a2f348

## FR-autostart-006 status 查询
变更：2026-08-30-daemon-autostart
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 存在或不存在注册；When 执行 `autostart status`
全文：.sillyspec/changes/archive/2026-08-30-daemon-autostart/requirements.md#FR-06
最近确认：171a2f348

## FR-autostart-007 前端 /runtimes 指引块
变更：2026-08-30-daemon-autostart
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户打开 /runtimes 页启动入口卡片；When 查看「开机自启动（可选）」折叠块（InstallDaemonBlock 下方，复用视觉骨架）；Then 展示说明（安装并至少成功启动过一次后执行）、命令 `sillyhub-daemon autostart enable --server ${serverUrl}
全文：.sillyspec/changes/archive/2026-08-30-daemon-autostart/requirements.md#FR-07
最近确认：171a2f348

## FR-autostart-008 安装脚本尾部提示与 README
变更：2026-08-30-daemon-autostart
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户完成 daemon 安装（install.sh 或 install.ps1） 用户查阅 sillyhub-daemon/README.md；When 查看安装输出尾部"下一步"提示 查找自启说明；Then 含一行自启命令提示（含 --server 实参）；install.ps1 的 DG-04 注释更新为"自启由 CLI autostart 子命令提供，安装器不做
全文：.sillyspec/changes/archive/2026-08-30-daemon-autostart/requirements.md#FR-08
最近确认：171a2f348

## FR-autostart-009 兼容与回退
变更：2026-08-30-daemon-autostart
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户从未执行 autostart 命令 bundle 自更新（原子替换同路径）；When 使用 daemon（start/stop/status/logs/clean 均不变） 开机任务触发；Then 行为与现状完全一致；自更新 respawn 拉起（原 argv 重启）不受影响 自动运行新版 bundle（任务指向路径不变）
全文：.sillyspec/changes/archive/2026-08-30-daemon-autostart/requirements.md#FR-09
最近确认：171a2f348
