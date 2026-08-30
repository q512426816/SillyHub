---
author: qinyi
created_at: 2026-08-30 22:20:00
scale: large
---

# 设计文档（Design）— daemon 开机自启动（autostart）

## 背景

daemon（`sillyhub-daemon`）目前只能由用户手动执行 `sillyhub-daemon start` 前台启动，**无任何开机自启/系统服务注册能力**（无 systemd/launchd/Windows 服务/计划任务；`src/preflight.ts` respawnDaemonAndExit 注释、`.sillyspec/docs/SillyHub/scan/CONCERNS.md` L51、quicklog ql-20260828-004 三处均明确此事实）。机器重启后 daemon 不再运行，任务无法执行，用户需要记住并重新手动启动——对非技术用户尤其不友好。

用户需求：安装 daemon 后，指导用户完成开机自启动配置，且最好是一条可复制执行的"一键"命令。

前置事实（代码依据）：
- 安装链路：前端 `/runtimes` 页 `InstallDaemonBlock`（`frontend/src/app/(dashboard)/runtimes/page.tsx:190`）复制安装命令 → backend `dist_router.py` 下发 `install.sh`/`install.ps1` → 单文件 bundle 装到 `~/.sillyhub/daemon/bin/`。
- CLI：commander 5 个平级子命令 start/stop/status/logs/clean（`sillyhub-daemon/src/cli.ts:340-396`）；per-server 配置 `~/.sillyhub/daemon/config-<hash8>.json`（`serverHash` = sha256 前 8 位，`src/config.ts:94`）。
- 自更新：`respawnDaemonAndExit`（detached 自拉起新进程 + 旧进程 exit(0)），是当前唯一的"重启"机制（`src/preflight.ts:469`）。

## 设计目标

1. 用户在终端执行**一条命令**即可完成自启注册：`sillyhub-daemon autostart enable --server <url> --api-key <key>`。
   - 语义精确化（Grill C-03）：三平台机制均为**开机（或登录）后自动启动**——Windows ONLOGON = 登录时、macOS RunAtLoad = LaunchAgent 加载（登录）时、Linux default.target（user）= 用户会话建立时；Linux `enable-linger` 成功时才接近真正"不登录也开机启动"。面向用户的文案统一用"开机（或登录）后自动启动"，不承诺纯开机语义。
2. 三平台原生机制支持：Windows（计划任务）/ macOS（launchd）/ Linux（systemd user service），零新增 npm 依赖，零 backend/协议改动。
3. 可管理、可逆：`autostart disable` 取消自启（不动运行中的进程）；`autostart status` 查看注册状态。
4. 前端 `/runtimes` 页与安装脚本尾部给出指引和可复制命令（"一键"体验闭环）。
5. 与现有自更新机制（respawnDaemonAndExit）零冲突（D-002：仅开机启动，不配置任何保活）。

## 非目标（Non-Goals）

- **不做崩溃保活**（KeepAlive/Restart=always/on-failure）：daemon 崩溃后不自动拉起（D-002 用户确认）。
- 不做安装脚本 `--autostart` 内置参数（D-001 用户确认选 CLI 子命令形态）。
- 不引入 pm2/NSSM/WinSW 等外部进程管理器/依赖（D-005）。
- 不改变 daemon↔backend 的任何通信协议、注册/心跳/租约行为。
- 不做多用户/系统级（root/系统服务）安装——全部用户级注册，免管理员权限。
- 不做凭据加密存储改造（per-server config 明文落盘是现状安全模型，本变更不改变）。

## 拆分判断

单一功能模块（自启注册）跨三平台实现 + 轻量触达层（前端折叠块/脚本提示/README），无 3+ 独立可交付模块、无多角色、无跨页面状态流转——不拆分、不批量，单变更交付。

## 总体方案

### §1 核心模块 `src/autostart.ts`（方案 A，D-005）

导出三个平台无关函数 + 平台策略内部分派（按 `process.platform`）：

```text
enableAutostart(opts)     → 注册本平台自启任务（幂等，重复执行覆盖）
disableAutostart(target)  → 注销自启任务（按 server 或 --all）
autostartStatus()         → 列出本地记录 + 系统注册实况对账
```

注册的启动命令模板（三平台一致）：

```text
<process.execPath> <脚本绝对路径> start --server <server_url>
```

- `process.execPath` = 当前运行 CLI 的 node 绝对路径，运行时直取无需探测（macOS launchd / Linux systemd 环境 PATH 受限，必须绝对路径）。
- 脚本绝对路径 = `path.resolve(process.argv[1])`（生产 = `~/.sillyhub/daemon/bin/sillyhub-daemon.js` bundle；开发 = `dist/cli.js`，npm link 场景同样可用）。
- 凭据不进任务命令：开机拉起后由 `start` 从 per-server config 读取（D-004）。
- per-server 注册：任务名带 `serverHash(server_url)` 8 位后缀，多 server 各自独立注册（贴合"本机多 daemon 实例"现状）。
- 本地注册记录 `~/.sillyhub/daemon/autostart-<hash8>.json`（AutostartRecord）：status 的数据源 + disable 的对账依据。

### §2 三平台注册细节

| | Windows (win32) | macOS (darwin) | Linux (linux) |
|---|---|---|---|
| 机制 | `schtasks` 计划任务 | launchd LaunchAgent | systemd user service |
| 标识 | `SillyHubDaemon-<hash8>` | `com.sillyhub.daemon.<hash8>` | `sillyhub-daemon-<hash8>.service` |
| 触发 | `/SC ONLOGON`（登录时） | `RunAtLoad=true` | `WantedBy=default.target` |
| 保活 | 无（天然） | 无 KeepAlive（D-002） | 无 Restart（默认 no，D-002） |
| 注册命令 | `schtasks /Create /TN <名> /SC ONLOGON /TR "wscript.exe \"<vbs>\"" /RL LIMITED /F` | 写 plist → `launchctl bootout gui/<uid>/<label>`（忽略失败）→ `launchctl bootstrap gui/<uid> <plist>` | 写 service → `systemctl --user daemon-reload` → `systemctl --user enable <名>` → `loginctl enable-linger`（best-effort） |
| 注销命令 | `schtasks /Delete /TN <名> /F` | `launchctl bootout` + 删 plist | `systemctl --user disable --now <名>` + 删 service + daemon-reload |
| 输出兜底 | daemon 自写 `daemon.log`（VBS 完全分离） | plist `StandardOutPath/StandardErrorPath` → `autostart-<hash8>.launchd.txt`（Grill C-16：避开 `clean` 命令 `*.log`/`*.out`/`*.err` glob，防兜底文件被误清） | systemd 自动收 journald（`journalctl --user -u <名>`） |
| 环境限制 | 无（用户级免管理员） | 需 GUI 会话（SSH-only 时报错提示） | PID1 非 systemd（WSL 默认/容器）→ 明确报错 + 替代建议；linger 失败仅 warn（降级为登录后自启） |

**Windows 隐藏窗口**：登录触发的计划任务跑 console 程序会弹黑框。生成 VBS 中转脚本 `~/.sillyhub/daemon/autostart-<hash8>.vbs`：

```vbs
' sillyhub-daemon autostart launcher (generated, do not edit)
CreateObject("WScript.Shell").Run "<node绝对路径> ""<bundle绝对路径>"" start --server <url>", 0, False
```

VBS 由 `wscript.exe` 执行（自身无窗口），`Run ..., 0` 隐藏子进程窗口；同时规避 `schtasks /TR` 261 字符限制与 cmd 引号转义地狱（`/TR` 只含 `wscript.exe "<vbs 路径>"`）。disable 时一并删除。**前瞻备注（Grill C-14）**：VBScript 处于 Microsoft 弃用轨道（Win11 起 FOD 化），当前 Win10/11 仍随系统可用；若未来 FOD 缺失导致 wscript 不可用，迁移到 `conhost --headless` 或 PowerShell `-WindowStyle Hidden` 中转（R-10）。

**node 路径漂移检测**（R-01）：enable 时若 `process.execPath` 位于 `.nvm/`、`volta/`、`asdf/` 等版本化目录，输出黄色警告"node 升级换路径后自启任务会失效，届时重新执行本命令即可"。

### §3 CLI 子命令（`src/cli.ts`）

commander 嵌套子命令（现有 5 命令为平级单层，autostart 为首个嵌套组，commander 原生支持）：

```text
sillyhub-daemon autostart enable  [--server <url>] [--api-key <key> | --token <t>]
sillyhub-daemon autostart disable [--server <url> | --all]
sillyhub-daemon autostart status
```

- `enable` 凭据语义与 `start` 完全一致（Grill C-05 对齐源码）：先 `loadConfigFn(serverUrl)` 合并 CLI 覆盖（token↔api_key 互斥互清），**无条件 `saveConfigFn` 落盘**（与 startAction L529-542 行为逐字对齐：落盘先于凭据校验），再注册任务。
  - **凭据缺失判定**：合并后 config 与命令行均无 token/api_key → 打印错误 + 提示（先带凭据成功启动一次，或本命令直接追加 `--api-key`）并 return 1（不注册半残任务）。
  - **token 凭据警告（Grill C-20）**：检测到凭据来源是 `--token`（JWT 短时效）时，CLI 侧输出琥珀警告"登录 Token 会过期，开机后大概率无法连接，建议改用 --api-key"——不止前端提示，注册现场也拦一道。
  - 注册成功后打印：任务标识、启动命令、日志位置、"立即启动可执行 sillyhub-daemon start --server <url>"提示。
- `disable`：只注销注册（删任务/plist/service + VBS + 本地记录），**不杀运行中进程**（停进程仍用 `stop`，避免误杀多实例）。缺 `--server` 且非 `--all` 时若有多个注册 → 列出让用户选择；单个时直接注销。
- `status`：读本地 `autostart-*.json` 记录 + 查询系统注册实况（schtasks /Query /TN、launchctl list、systemctl --user is-enabled），输出表格：server / 任务标识 / 系统注册状态（registered/orphaned-missing 等）。无记录时提示未注册。

### §4 用户触达层（"一键"体验闭环）

1. **前端**（`frontend/src/app/(dashboard)/runtimes/page.tsx`）：新增 `AutostartDaemonBlock` 组件，置于 `InstallDaemonBlock` 下方同视觉层级（dashed border 折叠块，复用现有骨架样式，见原型 `prototype-autostart-block.html`）：
   - 说明文案：安装完成并**至少成功启动过一次**后执行；
   - 命令（三平台相同，**无 OS 切换按钮**——与 InstallDaemonBlock 的关键差异）：`sillyhub-daemon autostart enable --server ${serverUrl} --api-key <粘贴你的 API Key>`；
   - 复制按钮（复用 CopyDaemonCommand 的 clipboard 模式）；琥珀色提示：自启场景建议用 API Key（登录 Token 会过期）+ API Key 获取路径；管理命令一行提示（status / disable）。
2. **安装脚本尾部提示**（`sillyhub-daemon/scripts/install.sh` L487-493"下一步"打印块（Grill C-17 修正锚点，L463-475 是 maybe_start 自动启动区，勿改）、`install.ps1` L350-357 附近）：追加一行自启命令提示（含 `--server` 实参；`install.ps1` 的 `DG-04: no auto start` 注释更新为"自启由 CLI autostart 子命令提供，安装器不做注册"）。**分发依赖（Grill C-09）**：install.sh/ps1 经 backend 镜像 `/app/daemon-dist/` 下发，提示文案要到达新装用户需重建 backend 镜像（daemon additional_contexts 打包链），deploy 时记得 rebuild——README/风险登记已记（R-11）。
3. **README**（`sillyhub-daemon/README.md`）：新增「开机自启动」小节（三平台说明 + 命令 + 已知限制：nvm 型 node 路径漂移、WSL 无 systemd）。

### §5 测试

- **新增 `sillyhub-daemon/tests/autostart.test.ts`**：vitest，mock `node:child_process`（execFile/spawnSync）与 `node:fs`——
  - 三平台注册产物正确（schtasks 参数拼装 / plist XML 内容断言含 RunAtLoad 且无 KeepAlive / service INI 内容断言无 Restart）；
  - VBS 内容断言（隐藏窗口参数 `0, False`、路径绝对化）；
  - 凭据缺失 → 报错 return 1 不注册；凭据提供 → saveConfigFn 被调用；
  - 幂等覆盖（二次 enable 不报错）；disable 清理全部产物；
  - Linux PID1 非 systemd → 明确错误信息；linger 失败仅 warn；
  - node 路径含 .nvm/ → 输出警告。
- **修改 `sillyhub-daemon/tests/cli.test.ts`**：补 autostart 三个子命令的动作分派与退出码（沿用现有 spyOn 封装注入点模式）。
- **前端**：`__tests__` 补 `AutostartDaemonBlock` 展开渲染/复制/命令拼接断言（沿用 `install-daemon-os.test.tsx` 模式）。
- **平台实机验证限制**：本机为 Windows，schtasks 路径可实机冒烟；macOS/Linux 分支以 mock 单测 + CI 矩阵保障，verify 阶段如实标注覆盖度。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | sillyhub-daemon/src/autostart/index.ts | 核心模块：enable/disable/status 顶层 API + 平台分派 + AutostartRecord 本地读写 + 任务名派生（plan 阶段细化为目录拆分：index + 三平台各一文件，避免多 task 共享单文件无法并行，也延续 daemon 反 god 文件实践）；无对外字段（纯 CLI 内部） |
| 新增 | sillyhub-daemon/src/autostart/windows.ts | Windows 策略：VBS 中转脚本生成 + schtasks 注册/注销/查询 |
| 新增 | sillyhub-daemon/src/autostart/macos.ts | macOS 策略：plist 生成 + launchctl 注册/注销/查询 |
| 新增 | sillyhub-daemon/src/autostart/linux.ts | Linux 策略：service 生成 + systemctl --user + linger + 无 systemd 检测 |
| 修改 | sillyhub-daemon/src/cli.ts | 新增 `autostart` 嵌套子命令组（enable/disable/status），enable 复用 loadConfigFn/saveConfigFn 凭据语义 |
| 新增 | sillyhub-daemon/tests/autostart.test.ts | 三平台策略 + 错误路径单测（mock child_process/fs） |
| 修改 | sillyhub-daemon/tests/cli.test.ts | 补 autostart 子命令分派/退出码断言 |
| 修改 | sillyhub-daemon/scripts/install.sh | 尾部"下一步"提示追加 autostart enable 命令文案 |
| 修改 | sillyhub-daemon/scripts/install.ps1 | 同上 + DG-04 注释更新（安装器不做注册，指向 CLI 子命令） |
| 修改 | sillyhub-daemon/README.md | 新增「开机自启动」小节 |
| 修改 | frontend/src/app/(dashboard)/runtimes/page.tsx | 新增 AutostartDaemonBlock 折叠块组件（复用 InstallDaemonBlock 视觉骨架） |
| 修改 | frontend/src/app/(dashboard)/runtimes/__tests__/install-daemon-os.test.tsx | 补 AutostartDaemonBlock 渲染/复制断言（或同目录新增测试文件，execute 时按现有文件粒度定） |
| 新增 | .sillyspec/docs/sillyhub-daemon/modules/autostart.md | 新模块卡（execute/verify 阶段同步） |
| 修改 | .sillyspec/docs/sillyhub-daemon/modules/cli.md | 命令清单 5→autostart 组 |
| 修改 | .sillyspec/docs/sillyhub-daemon/modules/preflight.md | "无外部 supervisor"表述更新（有可选自启注册，仍无保活 supervisor） |
| 修改 | .sillyspec/docs/SillyHub/scan/CONCERNS.md | L51 隐患条目更新（自启已补，保活仍未做） |

字段数据流标注：本变更**无对外字段/接口/DTO/响应体/事件 payload/配置键变动**（backend API、WS 协议、daemon config schema 均零改动）；新增的 `AutostartRecord` 是 daemon 本机文件格式，producer=autostart.ts 写、consumer=autostart.ts status/disable 读，不跨进程透传。

## 接口定义

```ts
// sillyhub-daemon/src/autostart.ts

export interface AutostartEnableOptions {
  serverUrl: string;            // 必填（CLI 层已解析默认值：不带 --server 时 cli.ts 用 DEFAULT_CONFIG.server_url 填充后传入，Grill C-19 对齐）
  apiKey?: string;              // 与 token 互斥（同 start 语义，先校验）
  token?: string;
}

export interface AutostartRecord {
  server_url: string;           // 注册目标 server（记录源，非网络请求）
  platform: 'win32' | 'darwin' | 'linux';
  node_path: string;            // process.execPath 固化
  script_path: string;          // path.resolve(process.argv[1]) 固化
  task_name: string;            // SillyHubDaemon-<hash8> / com.sillyhub.daemon.<hash8> / sillyhub-daemon-<hash8>.service
  enabled_at: string;           // ISO 8601
}

export interface AutostartStatusEntry extends AutostartRecord {
  systemState: 'registered'     // 系统注册存在
    | 'missing'                 // 本地记录在但系统注册丢失（如被用户手动删）
    | 'unknown';                // 查询系统状态失败
}

export async function enableAutostart(opts: AutostartEnableOptions): Promise<
  { ok: true; record: AutostartRecord } | { ok: false; error: string; hint?: string }
>;
export async function disableAutostart(target: { serverUrl?: string; all?: boolean }): Promise<
  { ok: true; removed: string[] } | { ok: false; error: string; hint?: string }
>;
export async function autostartStatus(): Promise<AutostartStatusEntry[]>;
```

CLI 层错误统一走现有 stderr + 退出码模式（enable 凭据缺失 / 平台不支持 = exit 1；成功 = exit 0 + 结构化打印）。

## 数据模型

无数据库/表结构变更。本机文件新增两类（均为 daemon 私有目录 `~/.sillyhub/daemon/`）：
- `autostart-<hash8>.json`：AutostartRecord（status 数据源）。
- `autostart-<hash8>.vbs`（仅 Windows）：隐藏窗口启动中转脚本。
- 平台注册产物：`~/Library/LaunchAgents/com.sillyhub.daemon.<hash8>.plist`（macOS）、`~/.config/systemd/user/sillyhub-daemon-<hash8>.service`（Linux）、计划任务 `SillyHubDaemon-<hash8>`（Windows，无文件）。

## 兼容策略

- **未注册自启时行为与现状完全一致**：不执行 autostart 命令的用户零感知（新模块仅被新子命令引用，不打进 start 路径的运行时行为）。
- **旧 bundle 兼容**：自更新拉起（respawnDaemonAndExit）以原 argv 重启，argv 不含 autostart → 不受影响；开机任务指向的 bundle 路径不变，bundle 自更新（原子替换同路径）后开机任务自动跑新版。
- **不改变的接口**：backend API / WS 协议 / per-server config schema / 现有 5 个 CLI 命令行为全部不变。
- **回退路径**：`autostart disable` 完整清理（系统注册 + VBS + 本地记录）；手动删除 bundle 不自动清理自启（disable 需在卸载前执行——README 与脚本提示中写明）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | nvm/volta/asdf 型 node 路径随版本漂移 → 自启任务指向失效 | P1 | enable 时检测版本化目录输出警告 + README 已知限制；失效后重跑 enable 覆盖即修复 |
| R-02 | Windows schtasks /TR 引号与 261 字符限制 | P1 | VBS 中转规避（/TR 仅含 wscript + vbs 路径）；单测断言拼装结果 |
| R-03 | 与 respawnDaemonAndExit 自更新竞态（若未来误加保活配置） | P2 | D-002 明确无 KeepAlive/Restart，exit(0) 不触发任何系统拉起；decisions.md 记录复潮条件 |
| R-04 | WSL/容器 PID1 非 systemd → systemctl 不可用 | P1 | 启动前检测（读 /proc/1/comm），明确报错 + 提示（WSL 启用 systemd 或改 Windows 侧安装），不静默失败 |
| R-05 | SSH 会话无 systemd user bus / 无 launchd GUI domain | P1 | 命令失败信息含修复提示（设置 DBUS_SESSION_BUS_ADDRESS / 在本地图形会话执行）；错误路径单测覆盖 |
| R-06 | macOS plist 环境变量极简（PATH 受限）导致 daemon 内 spawn 子进程失败 | P2 | ProgramArguments 全绝对路径；daemon 自身 spawn 已用解析路径（现状），README 记录观察项 |
| R-07 | 同 server 重复 enable / 不同 server 并存注册 | P2 | 幂等覆盖（/F、bootout 先行、disable --now 先行）；多 server 独立后缀互不干扰；单测覆盖 |
| R-08 | macOS/Linux 实机无法在本项目开发机验证 | P1 | mock 单测覆盖产物内容与命令拼装；CI 矩阵（ubuntu runner 可实跑 systemd user service 冒烟）；verify 如实标注覆盖度 |
| R-09 | `clean` 命令 `*.log`/`*.out`/`*.err` glob 误删 launchd 兜底输出文件（Grill C-16） | P2 | 兜底文件命名 `autostart-<hash8>.launchd.txt` 避开 glob；单测断言文件名不命中 clean 模式 |
| R-10 | VBScript 处于弃用轨道，未来 Windows FOD 缺失导致 wscript 不可用（Grill C-14） | P2 | 当前 Win10/11 仍随系统可用；README 已知限制记录迁移路径（conhost --headless / PowerShell -WindowStyle Hidden） |
| R-11 | install.sh/ps1 提示文案经 backend 镜像分发，不 rebuild 镜像则新装用户看不到（Grill C-09） | P2 | deploy 文档/README 注明"改安装脚本后需重建 backend 镜像"；CLI 能力本身随 bundle 自更新分发不受此影响 |
| R-12 | 用户用 `--token`（短时效 JWT）注册自启，开机后凭据已过期（Grill C-20） | P2 | enable 检测 token 凭据时 CLI 输出琥珀警告建议改用 --api-key；前端指引文案同步引导 |
| R-13 | `schtasks /Create /SC ONLOGON` 非提权终端一律"拒绝访问"（task-02 实机发现，D-006 追认） | P0 | 降级链：schtasks 优先（蓝图参数保留）→ access denied 走 PowerShell Register-ScheduledTask（AtLogOn+Interactive principal，同为用户级官方 API，-EncodedCommand 防转义）；/Delete //Query 两来源一致 |

## 决策追踪

| 决策 | 状态 | 覆盖点 |
|---|---|---|
| D-001@v1 注册形态=CLI autostart 子命令 | confirmed（用户确认） | §3 CLI 子命令、§4 前端/脚本提示、非目标第 2 条 |
| D-002@v1 仅开机启动不保活 | confirmed（用户确认） | §2 三平台"保活"行、R-03、非目标第 1 条 |
| D-003@v1 三平台原生机制 | confirmed（内联处理） | §2 整节、非目标第 3 条 |
| D-004@v1 凭据复用 per-server config | confirmed（内联处理） | §1 命令模板、§3 enable 凭据语义、兼容策略 |
| D-005@v1 实现架构=方案 A 内置模块 | confirmed（AI 自主判断，用户未实时作答已标注） | §1 核心模块、文件变更清单首行 |

未解决决策/剩余风险：无 P0 级；R-08 实机覆盖度在 verify 阶段如实报告。

## 生命周期契约

不涉及生命周期契约——本变更为 daemon 本机的开机自启注册（用户↔CLI 本地交互），不新增/修改任何 daemon↔backend 的生命周期事件（register/heartbeat/lease/session/agent_run 协议与状态机零改动）。

## 自审（Self-Review）

1. **关键词检查**：design 含 daemon/lifecycle 关键词 → 已写紧邻豁免短语「不涉及生命周期契约」并说明原因（本变更不触碰跨系统生命周期事件），符合 brainstorm.design.lifecycle-table 契约。
2. **章节完整性**：背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/数据模型/兼容策略/风险登记/决策追踪/自审 —— 12 节齐全。
3. **数据流核对**：文件清单无对外字段变动（backend/WS/config schema 零改动），AutostartRecord 为本机私有格式 producer/consumer 同模块——已按规则标注"无需跨进程透传"。
4. **决策一致性**：5 条决策全部映射到设计章节；D-002 的反面试验（自更新 exit(0) + 假设 KeepAlive=always 会双拉起抢 RuntimeLock）已推演并写入 R-03 复潮条件。
5. **YAGNI 核对**：砍掉了安装脚本内置注册（D-001 否决）、保活（D-002 否决）、外部进程管理器（D-005 否决）、凭据加密改造（非目标）——无镀金需求残留。
6. **平台契约核对**：schtasks ONLOGON 用户级免管理员 / launchd bootstrap gui/<uid> / systemctl --user + enable-linger —— 均为各平台用户级标准做法；Windows VBS 隐藏窗口是规避弹黑框的最小机制（不引外部依赖）。
7. **遗留**：R-08 实机覆盖度依赖 CI 矩阵，verify 阶段如实报告，不虚标。
8. **Design Grill 修正已回填**（独立审查子代理 23 项交叉检查，7 pass / 3 gap / 6 条 P2 建议全采纳）：C-03 自启语义精确化（开机/登录后）、C-05 enable 无条件落盘对齐 startAction、C-16 兜底文件改名避 clean glob、C-17 install.sh 锚点修正、C-19 接口注释对齐、C-20 token 注册现场警告；C-09/C-14 补入 R-11/R-10。无 P0/P1 未决项。
