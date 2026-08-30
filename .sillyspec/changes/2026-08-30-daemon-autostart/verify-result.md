---
author: qinyi
created_at: 2026-08-31 00:45:00
change: 2026-08-30-daemon-autostart
---

# 验证报告

## 结论

**PASS**

- 11/11 任务完成（tasks.md 全勾 + 逐 task review 双 pass + QA acceptance 审查双 pass）。
- 设计一致性：D-001~D-006 全部落地（关键词探针 10/10 命中源码；KeepAlive/Restart 仅存在于"不写该键"的注释，产物生成代码零保活配置）。
- 测试：daemon 99 passed 8 skipped（skip 均为既有平台原生跳过）+ frontend runtimes 65 passed + typecheck 0 错。
- 本变更含 daemon 关键词属 integration-critical，Runtime Evidence 见专节（Windows 实机完整往返真实证据）。
- 已知限制如实标注（非阻断）：登录触发真实拉起未实机验证（需注销重登，超出 verify 只读范围）；macOS/Linux 实机归 CI 矩阵（R-08）。

## 任务完成度

11/11 = 100%，全部 ✅（文件级核对 + execute 期逐 task review.json 双 pass）：

| task | 产物证据 | 状态 |
|---|---|---|
| task-01 | src/autostart/index.ts（458 行：顶层 API/类型/记录读写/taskNameFor/buildStartCommand/平台分派） | ✅ |
| task-02 | src/autostart/windows.ts（436 行：VBS+schtasks+PowerShell 降级链 D-006+GBK 解码+漂移警告） | ✅ |
| task-03 | src/autostart/macos.ts（287 行：plist 无 KeepAlive+bootout/bootstrap+label 查询） | ✅ |
| task-04 | src/autostart/linux.ts（339 行：service 无 Restart+linger best-effort+PID1 检测 L128） | ✅ |
| task-05 | src/cli.ts autostart 嵌套组（enable/disable/status action 导出+凭据管线对齐 startAction） | ✅ |
| task-06 | tests/autostart.test.ts（1117 行 71 用例） | ✅ |
| task-07 | tests/cli.test.ts TestAutostart（12 用例） | ✅ |
| task-08 | page.tsx AutostartDaemonBlock + install-daemon-os.test.tsx 扩展（6 用例） | ✅ |
| task-09 | install.sh/ps1 各 +1 行提示 + DG-04 注释更新（maybe_start 区 git diff 零触碰） | ✅ |
| task-10 | README「## 开机自启动」小节（31 行纯追加） | ✅ |
| task-11 | autostart.md 新卡 + cli.md/preflight.md/CONCERNS.md 更新 | ✅ |

## 设计一致性

- **探针 1（未实现标记）**：CLI 扫描零 TODO/FIXME 命中 ✅。
- **探针 2（关键词覆盖，语义复核）**：Register-ScheduledTask/RunAtLoad/WantedBy=default.target/enable-linger/bootout/schtasks/wscript/PID1(/proc/1/comm L128) 全部命中源码 ✅。负面断言成立：KeepAlive/Restart 仅在注释中声明"不写该键"（macos.ts L8/L86、linux.ts L8/L166/L202），产物生成代码零保活配置（D-002 落实）。
- **决策闭环（探针 4）**：D-001~D-005 在 requirements 决策矩阵→FR→plan→task→实现证据全链闭环；D-003@v1 三平台原生机制经探针 2 关键词逐项实证（schtasks/launchd/systemd 全命中源码）；D-006（execute 期追认）未进 requirements 矩阵属增量决策，已由 design.md R-13 + decisions.md D-006@v1 + windows.ts 实现 + task-02/06 review 证据覆盖，闭环成立 ✅。无 unresolved/blocking 决策。
- **凭据安全（D-004）**：buildStartCommand 签名无凭据参数（静态保证）；AutostartRecord 六字段无凭据；单测断言凭据不进 record/VBS/任何 argv ✅。
- **兼容策略**：现有 5 命令行为零改动（cli.test.ts 既有 16 用例零修改通过）；InstallDaemonBlock/CopyDaemonCommand 零改动（frontend 既有用例全绿）；backend/协议/config schema 零改动（探针 5：0 contract gap）✅。

## 探针结果

| 探针 | 结果 | 语义复核 |
|---|---|---|
| 1 未实现标记 | ✅ 零命中 | — |
| 2 关键词覆盖 | ✅ 10/10 | 全部命中；/proc/1/comm 在 linux.ts L128（grep 目录递归字面误报已澄清） |
| 3 测试覆盖 | ⚠️→✅ | task-01~04 "模块目录无测试"是 co-located 口径误报：测试集中在 tests/autostart.test.ts（仓库惯例），71 用例覆盖三平台产物/错误路径/幂等/清理 ✅；task-09 脚本无测试文件——纯 echo 追加 + bash -n + grep 验证过（execute 期），可接受 ⚠️（轻） |
| 4 决策追踪 | ✅ | D-001~D-006 闭环（D-006 为 execute 增量，见设计一致性节） |
| 5 API 契约对账 | ✅ | 0 frontend calls vs 2441 endpoints，scope=change-diff 可信；736 unused 为全仓存量噪音非本变更 |
| 6 删除对账 | ✅ | git diff 零整文件删除；唯一删除行是 cli.ts 过时文件头注释修正（注释对齐实现，CLAUDE.md 规则 18） |

**断言有效性抽查（探针 3.5）**：抽 autostart.test.ts（VBS 逐字断言含 ", 0, False"+CRLF；schtasks argv 精确断言 /TR 只含 wscript+vbs；PowerShell 降级链 EncodedCommand base64 解码断言）与 cli.test.ts（凭据缺失 → enableAutostart 未被调用 + return 1；落盘先于注册 invocationCallOrder）——断言验证真实输出/副作用、覆盖负路径异常分支、走公开 API 测行为，达标 ✅。

**集成盲区标注（探针 3.4）**：
1. ⚠️ **登录触发真实拉起未实机验证**：实机冒烟验证了注册/查询/注销全往返与产物内容（任务 XML 里 Command/Arguments 正确），但"计划任务在真实登录时拉起 daemon"需要注销重登/重启，超出 verify 只读范围。缓解证据：注册产物经 schtasks /XML 实机核验 + VBS 模板实机逐字节比对 + 命令行人工可核（node+bundle 双绝对路径）。建议用户部署后做一次重启确认。
2. ⚠️ **macOS/Linux 实机未验证**（R-08，开发机为 Windows）：macos.ts/linux.ts 以 mock 单测覆盖（产物逐字断言+命令序列断言），实机归 CI 矩阵/后续真机验证。

## 测试结果

- `cd sillyhub-daemon && pnpm typecheck`：exit 0（零报错）。
- `pnpm exec vitest run tests/autostart.test.ts tests/cli.test.ts`：**99 passed | 8 skipped**（2 files；skip 均为既有 itNonWindows 平台原生跳过，非本次引入）。
- `cd frontend && pnpm test -- runtimes`：**5 文件 65 用例全绿**（含既有用例零修改通过）。
- 测试对账：本变更全部源码文件（src/autostart/*、cli.ts、page.tsx）均有对应测试文件覆盖；无 known_failures 豁免新增。

## 变更风险等级

**integration-critical**（design 含 daemon/启动注册关键词）。等级依据：改变 daemon 进程启动方式（新增系统级注册产物：计划任务/plist/service），错误注册会影响用户机器登录行为。缓解：仅注册显式 enable 的 server（用户级、可 disable 完整清理、幂等覆盖）；不碰 backend/协议；实机往返已验证零残留。

## Runtime Evidence（integration-critical 必填）

Windows 实机（Win10 22H2 中文系统，本机）真实执行链，build 后 `node dist/cli.js` 直跑：

1. `autostart status`（空态）→ 输出"未注册任何开机（或登录）自启。"，exit 0 ✅
2. `autostart enable --server http://127.0.0.1:9999`（无凭据负路径）→ 中文错误提示（先带 --api-key 成功启动一次…），**exit 1 且未注册** ✅
3. `autostart enable --server http://127.0.0.1:9999 --api-key shk_live_smoke_test_dummy`（真实注册）→ 输出任务标识 `SillyHubDaemon-64620687`、启动命令（`C:\nvm4w\nodejs\node.exe` + worktree dist/cli.js 绝对路径 + `start --server`）、日志位置、立即启动提示，exit 0；真实落盘 `~/.sillyhub/daemon/autostart-64620687.json` + VBS + 计划任务 ✅
4. `autostart status` → Server/任务标识/系统状态=**已注册**（经 schtasks /Query 真实查询确认注册在任务计划程序中）✅
5. `autostart disable --server http://127.0.0.1:9999` → "已注销自启 + 正在运行的 daemon 不受影响"，exit 0 ✅
6. 清理确认：`cmd /c schtasks /Query /TN SillyHubDaemon-64620687` → "系统找不到指定的文件"（任务已删）；`~/.sillyhub/daemon/` 无 autostart 残留文件（VBS/json 全清）✅

（注：execute 期 task-02 子代理另做过一轮独立实机 e2e——register→/XML 引号零丢失验证→query 三态→unregister 幂等→drift 6 案例，残留全清；本节为 task-05 CLI 接线后的端到端复验。）
