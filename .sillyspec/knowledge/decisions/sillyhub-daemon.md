# 决策知识 — sillyhub-daemon

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : plan 模式采用强确认交互
状态：implemented
锚点：`frontend/src/components/daemon/plan-approval-card.tsx`
最近确认：04bb45fe
理由：强确认，类似 askuser 弹窗。

## D-004@v1 : CLI 边界 = 平台侧先行，sillyspec 工具同步配套（daemon 零改动兼容）
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`sillyhub-daemon/tests/test_bundle_metadata_compat.test.ts`
最近确认：0ec935c9
理由：平台先提供端点（spec-bundle 拉取/墓碑写路径），CLI 侧删除/归档墓碑上报（X1）与 pull --spec（X2）作跨仓任务在 sillyspec 仓落地（分支 sillyspec/2026-08-29-change-delete-closure-and-spec-pull：b86a593/16c21b0/fb35dc0）。daemon 本体零改动：bundle tar 新增顶层 PLATFORM-BUNDLE.json 经 test_bundle_metadata_compat 实证 pullSpecBundle/spec_version 判定兼容（.runtime 排除规则不变）；pull/push 时机口径维持现状（lease claim 按 latest_spec_version 判定，人拉/CLI 拉均为主动快照语义）。

## D-002@v1 : 数据链路走方案 A——git_log 模块扩展独立轻量 status 端点
状态：implemented
变更：2026-08-26-workspace-git-status
锚点：backend/app/modules/git_log/router.py
最近确认：86d6c405
理由：复用 git_log 模块与 host-fs 平名通道，daemon 加单方法 git_status、backend 加 GET /git-log/status、前端共享组件。

## D-001@v1 自启注册形态：daemon CLI 新增 autostart 子命令
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/cli.ts:340（现有命令注册区，autostart 组追加于此）
最近确认：b243c765
理由：CLI 子命令（`sillyhub-daemon autostart enable/disable/status`），前端复制一条命令执行即"一键"；安装脚本仅在尾部提示该命令，不内置注册逻辑。

## D-002@v1 保活策略：仅开机启动，不崩溃保活
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/autostart.ts（平台策略产物生成，设计 §2）
最近确认：b243c765
理由：仅开机/登录后启动一次，不配置 KeepAlive/Restart 型保活。

## D-003@v1 三平台原生机制，不引入外部依赖
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/autostart.ts（设计 §2 平台矩阵）
最近确认：b243c765
理由：Windows=schtasks ONLOGON 用户级计划任务+VBS 隐藏窗口；macOS=LaunchAgents plist（RunAtLoad，无 KeepAlive）+node 绝对路径；Linux=systemd user service+WantedBy=default.target+enable-linger（best-effort）；WSL 无 systemd 时明确报错不静默失败。

## D-004@v1 凭据策略：autostart enable 复用 start 的凭据落盘语义
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/cli.ts:startAction（凭据管线复用点）
最近确认：b243c765
理由：enable 接受与 start 相同的 --server/--api-key/--token 语义（loadConfigFn 合并 CLI 覆盖 + saveConfigFn 落盘 per-server config）；开机任务命令只带 --server，凭据从落盘 config 读；均无凭据时报错 exit 1 不注册。自启场景推荐 API Key（长效），JWT 会过期。

## D-005@v1 实现架构：方案 A——daemon 内置 TS autostart 模块
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/autostart.ts（新文件）
最近确认：b243c765
理由：A——`src/autostart.ts` 内置模块，运行时 process.execPath 取 node 绝对路径，直接调 schtasks/launchctl/systemctl 注册。

## D-006@v1 Windows 注册命令降级链：schtasks 优先 → PowerShell Register-ScheduledTask 兜底（主代理追认实机发现）
状态：implemented
变更：2026-08-30-daemon-autostart
锚点：sillyhub-daemon/src/autostart/windows.ts:registerViaPowerShell
最近确认：b243c765
理由：降级链——schtasks 优先（蓝图参数逐字保留，task-06 argv 断言不受影响）；access denied 时走 PowerShell Register-ScheduledTask（-EncodedCommand base64 防转义；语义对应 /SC ONLOGON→AtLogOn 本用户 Interactive、/RL LIMITED→RunLevel Limited、/F→-Force）。
