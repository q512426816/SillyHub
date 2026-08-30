---
schema_version: 1
doc_type: module-card
module_id: autostart
author: qinyi
created_at: 2026-08-31 00:20:00
---

# 开机自启动（autostart）

## 定位
daemon 开机（或登录）后自动启动的注册模块（`src/autostart/`，2026-08-30-daemon-autostart）。目录拆分为 index + 三平台共四文件：`index.ts`（三类型 + 三顶层 API + AutostartRecord 本地读写 + 任务名派生 + `process.platform` 分派），`windows.ts` / `macos.ts` / `linux.ts`（各自实现 `AutostartPlatformStrategy` 的 register/unregister/query）。仅被 cli.ts 的 autostart 子命令组（enable/disable/status）调用，不进 start 运行时路径——未注册自启的用户零感知。

## 契约摘要
- `enableAutostart(opts: AutostartEnableOptions)`：注册本平台自启任务（幂等，重复执行覆盖）→ `{ok:true, record} | {ok:false, error, hint?}`；未支持平台 / 任一步失败均走 ok=false，全链不抛异常。
- `disableAutostart(target: {serverUrl?, all?})`：只注销注册（系统任务 + 平台产物 + 本地记录），不动运行中进程（停进程用 stop）→ `{ok:true, removed} | {ok:false, error, hint?}`。
- `autostartStatus()`：读全部本地记录 + 逐条查系统注册实况对账 → `AutostartStatusEntry[]`（systemState：registered / missing / unknown）。
- 类型：`AutostartEnableOptions`（serverUrl 必填；apiKey/token 互斥，仅透传形状不消费——凭据归 CLI 层）、`AutostartRecord`（六字段，**无凭据字段**）、`AutostartStatusEntry`、`AutostartPlatformStrategy`（平台策略接口，register(record)/unregister(taskName)/query(taskName)）。
- 辅助导出：`buildStartCommand(serverUrl, nodePath?, scriptPath?)`（三平台一致模板 `<node> <script> start --server <url>`）、`taskNameFor(platform, serverUrl)`、`autostartRecordPath(serverUrl)`、`currentScriptPath()`；windows.ts 另导出 `vbsPathFor` / `buildVbsContent` / `nodePathDriftWarning`，macos.ts 导出 `buildLaunchdPlist` / `launchAgentPlistPath`（供 tests/autostart.test.ts 直接断言产物内容与路径）。
- 本地注册记录 `~/.sillyhub/daemon/autostart-<hash8>.json`（AutostartRecord；hash8 与目录复用 config.ts 的 serverHash / DEFAULT_CONFIG_DIR）：status 的数据源 + disable 的对账依据；producer/consumer 均在本模块，daemon 本机私有格式，不跨进程透传。

## 关键逻辑
三平台机制矩阵（自启语义统一为「开机（或登录）后自动启动」一次，无任何保活 D-002）：

| | Windows (win32) | macOS (darwin) | Linux (linux) |
|---|---|---|---|
| 机制 | schtasks 计划任务 | launchd LaunchAgent | systemd user service |
| 标识 | `SillyHubDaemon-<hash8>` | `com.sillyhub.daemon.<hash8>` | `sillyhub-daemon-<hash8>.service` |
| 触发 | `/SC ONLOGON`（登录时） | `RunAtLoad=true`（LaunchAgent 加载即登录时） | `WantedBy=default.target`（用户会话建立时） |
| 保活 | 无（计划任务天然无循环） | 无 KeepAlive（D-002） | 无 Restart（D-002） |
| 特有产物 | `autostart-<hash8>.vbs` 隐藏窗口中转（wscript 执行） | `~/Library/LaunchAgents/<label>.plist`；兜底输出 `autostart-<hash8>.launchd.txt`（.txt 避开 clean 的 *.log/*.out/*.err glob，R-09） | `~/.config/systemd/user/<unit>`（journald 自动收日志） |

```text
enableAutostart: 平台分派 → 组装 record（node_path=process.execPath、script_path=
  resolve(argv[1]) 双绝对路径固化 + 派生任务名）→ 平台 register → 成功后写本地记录
  （记录写失败明确 ok=false，但重跑 enable 幂等覆盖可自愈，不留半残状态）
Windows register: 写 VBS → schtasks /Create /TN <名> /SC ONLOGON /TR "wscript.exe
  \"<vbs>\"" /RL LIMITED /F → 报「拒绝访问」（schtasks CLI 对非提权 ONLOGON 的限制，
  非任务计划程序限制）→ 降级 PowerShell Register-ScheduledTask（-EncodedCommand
  base64 防转义，AtLogOn + 本用户 Interactive principal，D-006）；成功后 node 路径
  漂移检测（R-01）输出黄色警告
macOS register: 写 plist（ProgramArguments 五元素绝对路径数组 [node, script, start,
  --server, url]；RunAtLoad；全文无 KeepAlive 键）→ launchctl bootout gui/<uid>/<label>
  （幂等清场，忽略失败）→ launchctl bootstrap gui/<uid> <plist>
Linux register: PID1 前置检测（读 /proc/1/comm 回退 ps -p 1；非 systemd = WSL 默认/
  容器 → ok=false，不执行任何注册命令不写文件，R-04）→ 写 service（[Unit]/[Service]/
  [Install]，无 Restart 键）→ systemctl --user daemon-reload → enable（幂等覆盖）→
  loginctl enable-linger（best-effort，失败仅 warn 降级为登录后自启）
disableAutostart: all=全部本地记录 / serverUrl=该条（本地记录缺失也按当前平台重新派生
  任务名注销孤儿注册）→ 逐条 best-effort 全试完再汇总，单条成功即删本地记录
Windows query/unregister: 存在性判定用全量 CSV 列表复核（locale 无关，不匹配报错文案）；
  /Delete 与 PowerShell 注册来源互通（同一任务计划程序存储）；注销一并删 VBS
```

## 注意事项
- **凭据绝不进任务命令**（D-004）：`buildStartCommand` 签名与 AutostartRecord 字段均不含凭据（静态可保证）；凭据合并/落盘语义归 cli.ts 的 autostart enable（与 startAction 同构），开机拉起后由 start 从 per-server config 读取。
- **仅开机（或登录）后启动一次，不保活**（D-002 用户确认）：daemon 崩溃不自动拉起，与 respawnDaemonAndExit 自更新零竞态（exit(0) 不触发任何系统拉起）；未来若要 Restart=on-failure 需重开决策（防双拉起抢 RuntimeLock）。
- R-01 node 路径漂移：node 位于 .nvm / volta / asdf 版本化目录时 enable 输出黄色警告——node 升级换路径后自启任务指向失效，重跑 enable 覆盖即修复。
- R-04 WSL/容器：PID1 非 systemd 时 Linux register 明确报错 + 替代建议（WSL 启用 systemd 或改 Windows 侧安装），不静默失败；linger 失败仅 warn 不阻断注册。
- R-10 VBScript 弃用前瞻：Windows 隐藏窗口依赖 wscript VBS 中转（Win10/11 仍随系统可用，但 VBScript 处于 Microsoft 弃用轨道、Win11 起 FOD 化）；未来 wscript 缺失时迁移 conhost --headless / PowerShell -WindowStyle Hidden。
- 环境限制（R-05）：macOS SSH-only 会话无 launchd GUI domain、Linux SSH 无 systemd 用户总线 → 报错附修复提示；跨平台迁移来的本地记录在当前平台查不到 → systemState=missing，如实反映「本机无此系统注册」。
- schtasks/PowerShell 输出走 OEM 码页（中文系统 GBK）：execFile `encoding:'buffer'` + utf-8 严格 → GBK 回退解码；子进程一律 execFile 非 shell 独立 argv 传参（防注入）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
