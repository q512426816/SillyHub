---
author: qinyi
created_at: 2026-08-30 22:10:00
---

# 决策记录（Decisions）

## D-001@v1 自启注册形态：daemon CLI 新增 autostart 子命令

- type: architecture
- status: confirmed
- source: user
- question: 自启注册形态选 CLI 子命令 / 安装脚本内置 --autostart / 两者都做？
- answer: CLI 子命令（`sillyhub-daemon autostart enable/disable/status`），前端复制一条命令执行即"一键"；安装脚本仅在尾部提示该命令，不内置注册逻辑。
- normalized_requirement: 用户以单条可复制命令完成开机自启注册，可逆可管理，已装老用户无需重跑安装脚本。
- impacts: sillyhub-daemon/src/cli.ts（新子命令组）、frontend runtimes 页（指引）、install.sh/ps1（仅提示文案）
- evidence: 需求澄清 step3 第 1 轮 AskUserQuestion 用户亲选"CLI 子命令（推荐）"
- priority: P0
- 锚点: sillyhub-daemon/src/cli.ts:340（现有命令注册区，autostart 组追加于此）
- 模块域: sillyhub-daemon
- 否决理由: （被否选项）安装脚本内置需老用户重跑安装脚本，且脚本复杂度本已不低；两者都做违背 YAGNI。

## D-002@v1 保活策略：仅开机启动，不崩溃保活

- type: architecture
- status: confirmed
- source: user
- question: daemon 崩溃后要不要自动拉起（保活）？
- answer: 仅开机/登录后启动一次，不配置 KeepAlive/Restart 型保活。
- normalized_requirement: 开机（或登录）后 daemon 自动启动一次；崩溃后不自动拉起，与现有自更新机制（respawnDaemonAndExit：旧进程 exit(0) 前自拉起新进程）零冲突。
- impacts: launchd plist 不配 KeepAlive；systemd service 不配 Restart；Windows 计划任务天然无循环语义
- evidence: 需求澄清 step3 第 1 轮 AskUserQuestion 用户亲选"仅开机启动（推荐）"
- priority: P0
- 锚点: sillyhub-daemon/src/autostart.ts（平台策略产物生成，设计 §2）
- 模块域: sillyhub-daemon
- 复潮条件: 若未来出现高可用诉求（崩溃率不可接受），需重开评估 Restart=on-failure 并将 respawnDaemonAndExit 改为纯退出交 supervisor 拉起的整链改造（防双拉起抢 RuntimeLock）。

## D-003@v1 三平台原生机制，不引入外部依赖

- type: architecture
- status: confirmed
- source: ai-inline（内联处理，用户未单独作答）
- question: 三平台各用什么自启机制？
- answer: Windows=schtasks ONLOGON 用户级计划任务+VBS 隐藏窗口；macOS=LaunchAgents plist（RunAtLoad，无 KeepAlive）+node 绝对路径；Linux=systemd user service+WantedBy=default.target+enable-linger（best-effort）；WSL 无 systemd 时明确报错不静默失败。
- normalized_requirement: 零新增 npm/二进制依赖，全部用户级免管理员权限，兼容 Windows/Linux/macOS（CLAUDE.md 规则 13）。
- impacts: sillyhub-daemon/src/autostart.ts 全部平台策略
- evidence: 需求澄清 step3 内联处理（技术选型，依据仓库规则与平台标准做法）
- priority: P1
- 锚点: sillyhub-daemon/src/autostart.ts（设计 §2 平台矩阵）
- 模块域: sillyhub-daemon
- 否决理由: （被否选项）NSSM/WinSW 需外部二进制；HKCU Run 注册表无隐藏窗口控制且不可统一 status 查询。

## D-004@v1 凭据策略：autostart enable 复用 start 的凭据落盘语义

- type: architecture
- status: confirmed
- source: ai-inline（内联处理，用户未单独作答）
- question: 开机自启无人值守时凭据从哪来？
- answer: enable 接受与 start 相同的 --server/--api-key/--token 语义（loadConfigFn 合并 CLI 覆盖 + saveConfigFn 落盘 per-server config）；开机任务命令只带 --server，凭据从落盘 config 读；均无凭据时报错 exit 1 不注册。自启场景推荐 API Key（长效），JWT 会过期。
- normalized_requirement: 开机拉起的 daemon 能以已保存凭据连接 server；不改变明文落盘现状安全模型。
- impacts: sillyhub-daemon/src/cli.ts（enable 动作复用凭据管线）、autostart.ts（注册命令模板）
- evidence: cli.md 模块卡 start 凭据契约（token↔api_key 互斥互清、per-server 落盘）
- priority: P1
- 锚点: sillyhub-daemon/src/cli.ts:startAction（凭据管线复用点）
- 模块域: sillyhub-daemon

## D-005@v1 实现架构：方案 A——daemon 内置 TS autostart 模块

- type: architecture
- status: confirmed
- source: ai-autonomous（AskUserQuestion 用户未实时作答，AI 按最佳判断选定并如实标注；verify/archive 前用户可否决重开）
- question: 实现方案 A（内置 TS 模块）/ B（平台脚本外置分发 CLI 转调）/ C（pm2 类进程管理库托管）？
- answer: A——`src/autostart.ts` 内置模块，运行时 process.execPath 取 node 绝对路径，直接调 schtasks/launchctl/systemctl 注册。
- normalized_requirement: 与 D-001/D-002 完全契合；零新增依赖；bundle 自更新后自启能力同步演进（新装与自更新用户自动获得）；三平台逻辑集中便于 vitest mock 单测。
- impacts: sillyhub-daemon/src/autostart.ts（新增）、cli.ts（子命令）；backend 零改动（能力随单文件 bundle 分发）
- evidence: step4 方案选择轮次；B 否决=分发链复杂（动 dist_router+打包）且自更新后本地脚本版本漂移；C 否决=pm2 天然保活与 D-002 直接冲突+bundle 膨胀
- priority: P0
- 锚点: sillyhub-daemon/src/autostart.ts（新文件）
- 模块域: sillyhub-daemon

## D-006@v1 Windows 注册命令降级链：schtasks 优先 → PowerShell Register-ScheduledTask 兜底（主代理追认实机发现）

- type: architecture
- status: confirmed
- source: execute（task-02 子代理实机发现 + 主代理追认）
- question: schtasks /Create /SC ONLOGON 在非提权终端一律"拒绝访问"，design §2 单路径无法达成"用户级免管理员"（FR-01），怎么办？
- answer: 降级链——schtasks 优先（蓝图参数逐字保留，task-06 argv 断言不受影响）；access denied 时走 PowerShell Register-ScheduledTask（-EncodedCommand base64 防转义；语义对应 /SC ONLOGON→AtLogOn 本用户 Interactive、/RL LIMITED→RunLevel Limited、/F→-Force）。
- normalized_requirement: Windows 非提权用户 enable 必须成功；/Delete / /Query 对两种注册来源一致（同一任务计划程序存储）。
- impacts: sillyhub-daemon/src/autostart/windows.ts（registerViaPowerShell）；design.md 风险登记 R-13
- evidence: 实机 Win10 22H2 中文系统对照：同机 /SC ONCE 成功（排除环境）、Register-ScheduledTask AtLogOn 非提权成功（证明是 schtasks CLI 提权要求而非任务计划程序限制）；证据注释已写入 windows.ts（2026-08-30）
- priority: P0
- 锚点: sillyhub-daemon/src/autostart/windows.ts:registerViaPowerShell
- 模块域: sillyhub-daemon
