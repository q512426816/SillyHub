---
author: qinyi
created_at: 2026-08-30 22:42:00
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| daemon 用户（开发机主人） | 在自己机器上安装并运行 sillyhub-daemon 的用户，希望开机（或登录）后 daemon 自动运行 |
| daemon | 本地任务执行守护进程（被自启拉起的目标进程） |

## 功能需求

### FR-01: Windows 注册开机（登录）自启
覆盖决策：D-001@v1, D-002@v1, D-003@v1
Given Windows 系统且 daemon 已安装（bundle 存在于 ~/.sillyhub/daemon/bin/）
When 用户执行 `sillyhub-daemon autostart enable --server <url> --api-key <key>` 且凭据有效
Then 生成隐藏窗口 VBS 中转脚本（`~/.sillyhub/daemon/autostart-<hash8>.vbs`，`Run ..., 0, False`）并以 `schtasks /Create /TN SillyHubDaemon-<hash8> /SC ONLOGON /TR "wscript.exe <vbs>" /RL LIMITED /F` 注册用户级计划任务（免管理员）
And 计划任务不含任何循环/保活语义（D-002）
And 本地写入注册记录 `autostart-<hash8>.json`
And 输出任务标识、启动命令、日志位置与"立即启动"提示，exit 0

Given 同一 server 已注册过
When 再次执行 enable
Then 幂等覆盖（/F），不报错，exit 0

### FR-02: macOS 注册开机（登录）自启
覆盖决策：D-001@v1, D-002@v1, D-003@v1
Given macOS 且 daemon 已安装
When 执行 enable 且凭据有效
Then 写 `~/Library/LaunchAgents/com.sillyhub.daemon.<hash8>.plist`（ProgramArguments=[node 绝对路径, 脚本绝对路径, start, --server, url]、RunAtLoad=true、**无 KeepAlive**、StandardOut/ErrorPath → `autostart-<hash8>.launchd.txt`）
And 先 `launchctl bootout gui/<uid>/<label>`（忽略失败）再 `launchctl bootstrap gui/<uid> <plist>`，exit 0

Given SSH-only 会话无 GUI domain
When bootstrap 失败
Then 输出含修复提示的错误（在本地图形会话执行），exit 1

### FR-03: Linux 注册开机（登录）自启
覆盖决策：D-001@v1, D-002@v1, D-003@v1
Given Linux 且 daemon 已安装
When 执行 enable 且凭据有效
Then 写 `~/.config/systemd/user/sillyhub-daemon-<hash8>.service`（ExecStart 同上模板、WantedBy=default.target、**无 Restart**）
And `systemctl --user daemon-reload` + `systemctl --user enable sillyhub-daemon-<hash8>`，exit 0
And `loginctl enable-linger` best-effort：失败仅 warn（降级为登录后自启），不影响 exit 0

Given PID1 非 systemd（WSL 默认/容器）
When 执行 enable
Then 明确报错说明不支持及替代建议（WSL 启用 systemd 或改 Windows 侧安装），不静默失败，exit 1

### FR-04: enable 凭据管线与校验
覆盖决策：D-004@v1
Given 用户带 --api-key（或 --token）执行 enable
When CLI 处理
Then 先 loadConfigFn(serverUrl) 合并 CLI 覆盖（token↔api_key 互斥互清），**无条件 saveConfigFn 落盘** per-server config（与 startAction 行为对齐），再注册

Given config 与命令行均无凭据
When 执行 enable
Then 打印错误 + 提示（先带凭据成功启动一次，或本命令直接追加 --api-key）并 exit 1，**不注册**任何任务

Given 凭据来源是 --token（短时效 JWT）
When 注册成功
Then 输出琥珀警告"登录 Token 会过期，开机后大概率无法连接，建议改用 --api-key"（Grill C-20）

Given node 路径位于 .nvm/、volta/、asdf/ 等版本化目录
When 注册成功
Then 输出警告：node 升级换路径后自启任务会失效，届时重新执行本命令即可（R-01）

### FR-05: disable 取消自启
覆盖决策：D-001@v1
Given 存在注册（本地记录 + 系统注册）
When 执行 `autostart disable --server <url>`（单个注册时可省略 --server；多个时列出供选择；`--all` 全清）
Then 注销系统注册（schtasks /Delete /F / launchctl bootout + 删 plist / systemctl --user disable --now + 删 service + daemon-reload）+ 删 VBS + 删本地记录
And **不杀正在运行的 daemon 进程**（提示用 stop 停进程），exit 0

### FR-06: status 查询
覆盖决策：D-001@v1
Given 存在或不存在注册
When 执行 `autostart status`
Then 读本地 `autostart-*.json` 记录 + 查询系统实况（schtasks /Query /TN、launchctl list、systemctl --user is-enabled），输出 server / 任务标识 / 系统注册状态（registered / missing / unknown）表格；无记录时提示未注册，恒 exit 0

### FR-07: 前端 /runtimes 指引块
覆盖决策：D-001@v1
Given 用户打开 /runtimes 页启动入口卡片
When 查看「开机自启动（可选）」折叠块（InstallDaemonBlock 下方，复用视觉骨架）
Then 展示说明（安装并至少成功启动过一次后执行）、命令 `sillyhub-daemon autostart enable --server ${serverUrl} --api-key <粘贴你的 API Key>` 与复制按钮（三平台同一命令，无 OS 切换）、琥珀提示（建议用 API Key + 获取路径）、管理命令提示（status/disable）

### FR-08: 安装脚本尾部提示与 README
覆盖决策：D-001@v1
Given 用户完成 daemon 安装（install.sh 或 install.ps1）
When 查看安装输出尾部"下一步"提示
Then 含一行自启命令提示（含 --server 实参）；install.ps1 的 DG-04 注释更新为"自启由 CLI autostart 子命令提供，安装器不做注册"

Given 用户查阅 sillyhub-daemon/README.md
When 查找自启说明
Then 存在「开机自启动」小节（三平台说明 + 命令 + 已知限制：nvm 型 node 路径漂移、WSL 无 systemd、VBScript 弃用前瞻、改安装脚本后需重建 backend 镜像才达新装用户）

### FR-09: 兼容与回退
覆盖决策：D-002@v1, D-005@v1
Given 用户从未执行 autostart 命令
When 使用 daemon（start/stop/status/logs/clean 均不变）
Then 行为与现状完全一致；自更新 respawn 拉起（原 argv 重启）不受影响
Given bundle 自更新（原子替换同路径）
When 开机任务触发
Then 自动运行新版 bundle（任务指向路径不变）

## 非功能需求

- 兼容性：Windows/Linux/macOS 三平台（CLAUDE.md 规则 13）；全部用户级注册，免管理员/root；零新增 npm 依赖；backend API/WS 协议/config schema 零改动。
- 可回退：`autostart disable` 完整清理；不注册时零感知。
- 可测试：三平台策略 mock child_process/fs 单测覆盖（产物内容断言：plist 无 KeepAlive、service 无 Restart、VBS 隐藏参数）；CLI 子命令分派与退出码断言；前端组件渲染/复制断言。
- 安全：不改变凭据明文落盘现状；任务命令不内联凭据（凭据在 per-server config，权限同现状）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01/02/03/05/06/07/08 | CLI 子命令形态，安装脚本仅提示 |
| D-002@v1 | FR-01/02/03/09 | 无 KeepAlive/Restart 断言进单测 |
| D-003@v1 | FR-01/02/03 | 三平台原生机制矩阵 |
| D-004@v1 | FR-04 | 凭据复用 start 管线（无条件落盘对齐） |
| D-005@v1 | FR-09 及全实现形态 | 方案 A 内置模块，backend 零改动 |

无未覆盖决策；剩余风险 R-01~R-12 见 design.md 风险登记（均 P1/P2，无 P0）。
