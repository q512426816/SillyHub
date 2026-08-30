---
author: qinyi
created_at: 2026-08-30 23:20:00
change: 2026-08-30-daemon-autostart
---

# 模块影响分析（Module Impact）— daemon 开机自启动（autostart）

## 受影响模块

| 模块 | 影响面 | 变化类型 | 波及测试 | 文档 |
|---|---|---|---|---|
| sillyhub-daemon/autostart（新） | src/autostart/{index,windows,macos,linux}.ts 四文件：顶层 API + 三平台策略 | 新增模块 | tests/autostart.test.ts（新） | autostart.md（新模块卡） |
| sillyhub-daemon/cli | cli.ts 新增 autostart 嵌套子命令组（enable/disable/status）；现有 5 命令零改动 | 扩展 | tests/cli.test.ts（补断言） | cli.md 命令清单更新 |
| sillyhub-daemon/scripts | install.sh/install.ps1 尾部"下一步"提示各追加一行；install.ps1 DG-04 注释更新 | 文案追加（安装器仍不注册） | 无（backend dist 测试用自造 fixture 不受影响） | README + autostart.md |
| sillyhub-daemon/docs | README 新增「开机自启动」小节 | 文档新增 | — | — |
| frontend/runtimes | page.tsx 新增 AutostartDaemonBlock 折叠块（InstallDaemonBlock 下方） | UI 追加（既有组件零改动） | __tests__/install-daemon-os.test.tsx（补断言） | — |
| .sillyspec/docs/sillyhub-daemon | preflight.md supervisor 表述更新（有可选自启注册，仍无保活） | 文档修正 | — | preflight.md |
| .sillyspec/docs/SillyHub/scan | CONCERNS.md L51 隐患条目更新（自启已补，保活按 D-002 刻意不做） | 文档修正 | — | — |

## 跨模块契约点

- cli.ts → src/autostart/index.ts：enable/disable/status 顶层 API（task-01 provides ↔ task-05 expects_from，已精确对齐）。
- index.ts → 三平台策略：register/unregister/query + buildStartCommand/taskNameFor + AutostartRecord（task-01 provides ↔ task-02/03/04/06 expects_from，已精确对齐）。
- daemon 自更新 ↔ 自启任务：开机任务指向 bundle 路径不变，bundle 原子替换后开机自动跑新版（D-002 无保活 → respawnDaemonAndExit exit(0) 不触发系统拉起，零竞态）。
- 分发链：CLI 能力随单文件 bundle 分发（新装/自更新自动获得）；install.sh/ps1 提示文案经 backend 镜像 /app/daemon-dist/ 下发——改脚本需重建 backend 镜像（R-11）。

## 不受影响

- backend 全部代码/API/WS 协议（零改动）；daemon↔backend 生命周期事件（register/heartbeat/lease/session，本变更不触碰）；per-server config schema；现有 5 个 CLI 命令行为；clean 命令 glob 语义（兜底文件改名规避）；前端既有组件与主题系统。
