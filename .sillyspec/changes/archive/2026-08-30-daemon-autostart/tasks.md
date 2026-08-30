---
author: qinyi
created_at: 2026-08-30 22:42:00
---

# 任务清单（Tasks）

- [x] task-01: autostart 目录骨架——src/autostart/index.ts 顶层 API（enableAutostart/disableAutostart/autostartStatus）+ 类型定义 + 本地记录读写 + serverHash 任务名派生 + 三平台 stub 文件占位（含 process.execPath/argv[1] 命令模板函数）
- [x] task-02: Windows 策略 src/autostart/windows.ts——VBS 中转脚本生成（Run ..., 0, False 隐藏窗口）+ schtasks 注册（/SC ONLOGON /RL LIMITED /F 幂等）/注销（/Delete /F）/查询（/Query /TN）(depends_on: task-01)
- [x] task-03: macOS 策略 src/autostart/macos.ts——plist 生成（RunAtLoad 无 KeepAlive、ProgramArguments 绝对路径、.launchd.txt 兜底输出）+ launchctl bootout（忽略失败）/bootstrap（gui/uid）/查询；SSH-only 无 GUI domain 报错提示 (depends_on: task-01)
- [x] task-04: Linux 策略 src/autostart/linux.ts——service 文件生成（WantedBy=default.target 无 Restart）+ systemctl --user daemon-reload/enable/disable --now + loginctl enable-linger best-effort + PID1 非 systemd 明确报错 (depends_on: task-01)
- [x] task-05: CLI autostart 子命令组 src/cli.ts——嵌套子命令 enable/disable/status 接线 + enable 凭据管线（loadConfigFn 合并 + 无条件 saveConfigFn + token↔api_key 互斥互清 + 凭据缺失 exit 1 + --token 过期警告 + nvm/volta/asdf 路径警告）(depends_on: task-01, task-02, task-03, task-04)
- [x] task-06: autostart 单测 tests/autostart.test.ts——三平台产物内容断言（plist 无 KeepAlive/service 无 Restart/VBS 隐藏参数/文件名避 clean glob）+ 错误路径（无 systemd/PID1 检测；CLI 层凭据缺失路径归 task-07）+ 幂等覆盖 + disable 清理（mock child_process/fs）(depends_on: task-01, task-02, task-03, task-04)
- [x] task-07: cli.test.ts 补 autostart 子命令分派/退出码/凭据管线断言（沿用 spyOn 注入点模式）(depends_on: task-05)
- [x] task-08: 前端 AutostartDaemonBlock 折叠块组件（frontend/src/app/(dashboard)/runtimes/page.tsx）+ 组件测试（渲染/复制/命令拼接，沿用 install-daemon-os.test.tsx 模式）
- [x] task-09: install.sh（L487-493 下一步块）/install.ps1（L350-357 + DG-04 注释更新）尾部追加自启命令提示
- [x] task-10: sillyhub-daemon/README.md 新增「开机自启动」小节（三平台说明 + 命令 + 已知限制四条）
- [x] task-11: 模块文档同步——新增 .sillyspec/docs/sillyhub-daemon/modules/autostart.md 模块卡 + 更新 cli.md（命令清单）/preflight.md（supervisor 表述）/CONCERNS.md（L51 隐患条目）(depends_on: task-01, task-05)
