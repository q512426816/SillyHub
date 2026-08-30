---
plan_level: full
author: qinyi
created_at: 2026-08-30 22:55:00
---

# 实现计划（Plan）— daemon 开机自启动（autostart）

## Wave 1（并行，无依赖，纯独立文件）
- task-01
- task-08
- task-09
- task-10

## Wave 2（依赖 Wave 1 的 task-01 类型与 stub）
- task-02
- task-03
- task-04

## Wave 3（依赖 Wave 2 平台实现）
- task-05
- task-06

## Wave 4（依赖 Wave 3 的 CLI 行为定型）
- task-07
- task-11

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | autostart 目录骨架（index.ts 顶层 API+类型+记录读写+stub） | W1 | P0 | — | FR-01~06, D-005@v1 | 顶层 API 签名按 design 接口定义逐字实现；stub 文件保证 W2 前可编译 |
| task-02 | Windows 策略（VBS+schtasks） | W2 | P0 | task-01 | FR-01, D-003@v1 | /TR 只含 wscript+vbs 路径；/F 幂等 |
| task-03 | macOS 策略（plist+launchctl） | W2 | P0 | task-01 | FR-02, D-003@v1 | 无 KeepAlive 断言进 task-06；.launchd.txt 避 clean glob（R-09） |
| task-04 | Linux 策略（service+systemctl+linger） | W2 | P0 | task-01 | FR-03, D-003@v1 | 无 Restart；PID1 非 systemd 报错（R-04） |
| task-05 | CLI autostart 子命令组接线 | W3 | P0 | task-01~04 | FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, D-001@v1, D-004@v1 | enable 凭据管线与 startAction 对齐（无条件落盘）；token 警告（R-12） |
| task-06 | autostart.test.ts 三平台单测 | W3 | P0 | task-01~04 | FR-01, FR-02, FR-03, FR-04 可测试性, D-002@v1（无 KeepAlive/Restart 产物断言） | mock child_process/fs；产物内容逐字断言 |
| task-07 | cli.test.ts 补子命令断言 | W4 | P1 | task-05 | FR-04, FR-05, FR-06 | 分派/退出码/凭据缺失路径 |
| task-08 | 前端 AutostartDaemonBlock 组件+测试 | W1 | P0 | — | FR-07, D-001@v1 | 复用 InstallDaemonBlock 骨架；无 OS 切换（命令三平台同） |
| task-09 | install.sh/ps1 尾部提示 | W1 | P1 | — | FR-08 | install.sh 改 L487-493 下一步块（勿动 L463-475 maybe_start）；ps1 DG-04 注释更新 |
| task-10 | README 开机自启动小节 | W1 | P1 | — | FR-08 | 已知限制四条（nvm 漂移/WSL/VBScript 弃用/镜像重建分发） |
| task-11 | 模块文档同步 | W4 | P1 | task-01, task-05 | FR-09 文档面 | autostart.md 新卡 + cli.md/preflight.md/CONCERNS.md 更新 |

## 关键路径
task-01 → task-02/03/04 → task-05 → task-07（平台实现 → CLI 接线 → 行为断言，决定最短交付周期）

## 并行安全性说明
- W1 四任务文件互不相交（src/autostart/index.ts + 3 个新文件 vs frontend/page.tsx vs scripts/*.sh/ps1 vs README.md）。
- W2 三任务各占 src/autostart/{windows,macos,linux}.ts 独立文件（design 文件清单已按目录拆分同步，避免同文件强制串行）。
- W3 两任务不相交（src/cli.ts vs tests/autostart.test.ts）。
- W4 两任务不相交（tests/cli.test.ts vs .sillyspec/docs/**）。

## 全局验收标准
1. daemon 相关单测通过：`cd sillyhub-daemon && pnpm exec vitest run tests/autostart.test.ts tests/cli.test.ts`（及受影响既有用例；全量套件按 local.yaml 排除策略留给 CI）。
2. 前端组件测试通过：`cd frontend && pnpm test -- runtimes`（受影响文件）。
3. daemon `pnpm typecheck` 通过（ESM import 带 .js 扩展名约定）。
4. Windows 实机冒烟：本机执行 `node dist/cli.js autostart enable/disable/status`（真实 schtasks 注册/注销往返 + status 输出核对）。
5. brownfield 兼容：未执行 autostart 时现有 5 命令行为不变（cli.test.ts 既有断言零修改通过）。
6. macOS/Linux 分支以 mock 单测覆盖（产物内容断言），覆盖度在 verify-result.md 如实标注（R-08）。
