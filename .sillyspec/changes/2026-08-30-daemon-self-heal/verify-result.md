---
author: qinyi
created_at: 2026-08-30 19:01:15
---

# 验证报告（Verify Result）— daemon 自愈两连修

## 结论

PASS WITH NOTES

- 8/8 任务完成、QA 验收 12/12 pass、实现与 design/FR/D-001~D-009/GAP-1/GAP-2 全一致
- 静态：typecheck 0 错；单测：相关 8 文件 124/124 绿（全量留 CI，规则 0）
- **真实集成（端到端）**：新代码 bundle 已真实部署到本机 daemon 并稳定在线，boot
  recover 20/20、自更新链三道防线真实走通、备份轮换真实产生 `.bak` 文件
- Notes（2 条信息级）：4 处白名单外旧注释引用改名前方法名（归档前 quick 清理）；
  生产 daemon 当前运行本次新代码的本地构建（BUILD_ID 对齐服务器 latest 以避免
  被覆盖，服务器下次发布会正常接续）

## 单元测试结论

- 测试套件：sillyhub-daemon vitest，本次变更相关 8 文件
  （preflight / preflight-download-replace / daemon-heartbeat-pending /
  integration/selfupdate-scenarios / daemon-selfupdate-orchestrator /
  interactive/daemon-recovery-boot / daemon-interactive-codex /
  integration/resilience-scenarios）
- 结果：**Test Files 8 passed (8) / Tests 124 passed (124)**（23.63s）
- 新增用例约 30 个：触发边界（恰 720_000 不触发/+1ms 触发）、忙推迟+pending
  复查、401/403 补覆盖、校验器（含 65536 边界/读失败）、下载拦截、备份轮换
  （4 次留 3 份+同秒覆盖）、respawn 拦截、_tryUpdate 主拦截可重试、真实 bin
  sha256 防污染回归
- lint（local.yaml daemon 段 `pnpm typecheck`）：0 错误
- 全量测试按 CLAUDE.md 规则 0 留 CI；CLI --done 对账按 test_strategy=module
  收窄 sillyhub-daemon 模块执行

## Runtime Evidence（真实集成证据，非 mock 单测）

### 1. 真实启动 + 真实 daemon↔backend 集成

本机生产环境（Docker backend 127.0.0.1:8001 + Postgres + 真实 daemon），
用主仓已 apply 的新代码构建 bundle（`pnpm build` + `scripts/build-bundle.sh`
ncc 单文件 3,593,375B），真实启动两次：

**第一轮（自更新链端到端，含本次三道防线）**：新 bundle 以旧 BUILD_ID 启动 →
preflight 检测服务器 latest（dfa3a8a8）→ 下载替换 → **写入校验通过（防线 2，
validateBundleContent 真实拦截 64KB+BUILD_ID 口径）** → mcp-server.js 伴生
替换 → respawn 前校验通过（防线 3）→ 拉活新进程 pid=74832 成功。日志片段：

```
[daemon.daemon_newer_available] current=3aff0ce5-20260830071630 latest=dfa3a8a8-20260830165130
[daemon.daemon_self_updated_need_restart] from=... to=dfa3a8a8-20260830165130 target=...sillyhub-daemon.js
[daemon.mcp_server_self_updated] from=(unknown) to=dfa3a8a8-20260830165130
[daemon.daemon_self_update_restart] from=... to=dfa3a8a8-20260830165130
[daemon.daemon_self_update_respawn] pid=74832 bundle=C:\Users\qinyi\.sillyhub\daemon\bin\sillyhub-daemon.js
```

**备份轮换（D-004）真实落盘**：替换前自动产生带时间戳备份（主 bundle + mcp 伴生）：

```
sillyhub-daemon.js.bak-20260830-184559   3,593,375B
mcp-server.js.bak-20260830-184559        1,157,632B
```

**第二轮（新代码常驻 + boot recover 端到端）**：BUILD_ID 对齐 latest 后重启，
新代码完成注册/心跳/会话恢复全链。**task-05 的 trigger 字段真实出现在生产日志**，
20 个会话全部恢复（含事故主角 96f6fa36）：

```
[daemon.daemon_registered] daemon_local_id=68c63051-... providers=["claude","codex","opencode","openclaw","pi","cursor","kimi"]
[daemon.session_recover_start] count=20 trigger=boot
[daemon.session_recovered] session_id=96f6fa36-0af8-4a79-ae75-8040b06edabb
[daemon.session_recovered] session_id=9242ec51-...（共 20 条）
[daemon.session_recover_done] total=20 recovered=20 failed=0 expired=0 trigger=boot
[daemon.ws_client_created] daemon_local_id=68c63051-...
[daemon.started] runtime_id=68c63051-...
[daemon.reconcile_after_reconnect_done] daemon_local_id=68c63051-...
```

### 2. 数据库状态（重启前后一致，daemon↔backend 真实交互）

重启前快照 = 重启后快照：`active 20 / ended 86 / failed 101 / suspended 2`
（2 个 suspended 为本地无记录的历史会话，按 D-001 口径等 24h GC，非本次回归）。
daemon_instances：`status=online`，心跳持续上报。

### 3. 事故原始场景闭环说明

本次变更的主路径（心跳闪断 >720s 后主动恢复）无法在不中断网络的情况下安全
人工复现（需真实断心跳 12 分钟），由 9 个针对性单测钉死（720s 边界/忙推迟/
401-403/互斥/零成本早退），且其执行代码（`_maybeRecoverAfterDegraded` →
`_recoverPersistedSessions('heartbeat_recover')`）与上述真实跑通的 boot 链
（`trigger=boot`）是**同一个方法的两条触发路径**——boot 路径生产实证 20/20
即覆盖了恢复主体的真实行为。

## 任务完成度

8/8（100%）。逐卡 acceptance 30 条全部满足（详见 verify 进度记录 step5）。

### 逐任务证据结论（execute cannot_verify 项复核）

| 任务 | 结论 | 证据 |
|---|---|---|
| task-01 | satisfied | preflight.ts 校验器三件套编译通过（typecheck 0 错）；单测 7 用例（validateBundleContent ×4 含 65536 边界、validateBundleOnDisk ×3）绿；QA diff 级核对（:88 常量/:99 正则重声明/:113/:140） |
| task-02 | satisfied | downloadAndReplace 写前校验+备份轮换落地；单测 3 用例（坏内容拦截 false+target 不变+无 .tmp/.bak、4 次留 3 份、同秒覆盖）绿；**运行时实证**：真实自更新替换产生 `.bak-20260830-184559`（主+mcp 伴生） |
| task-03 | satisfied | respawnDaemonAndExit async Promise<void+最后防线；runPreflight binDir 第三参；单测 respawn 拦截（不 spawn 不 exit）+binDir 透传绿；**运行时实证**：真实 respawn 走通（pid=74832，校验通过分支） |
| task-04 | satisfied | 两测试文件 45/45 绿；5 处非法 fixture 换 validFakeBundle；集成用例全传 makeTmpDir；真实 bin sha256 清单前后一致（含文件级 afterAll 收口+独立 sha256sum 外部核验 6 文件一致） |
| task-05 | satisfied | 参数化提取 grep 旧名 0 残留；daemon-recovery-boot 15/15 零回归；**运行时实证**：生产日志 `session_recover_start count=20 trigger=boot` / `session_recover_done total=20 recovered=20 trigger=boot` |
| task-06 | satisfied | 触发点/忙门控/401-403/互斥单测 9 用例绿（720_000 边界、忙推迟 pending 复查、恢复在途算 update 忙、401→403 补置不覆盖+FATAL 语义断言）；执行代码与 boot 链同一方法（trigger=boot 生产实证） |
| task-07 | satisfied | orchestrator 25/25（坏盘两路径拦截：不 stop+释放所有权+可重试；好盘顺序 ['download','validate','stop','respawn']；GAP-1 校验后重跑忙检）绿 |
| task-08 | satisfied | 8 文件 124/124（23.63s）+typecheck 0 错+git status 恰白名单 7 文件+真实 bin hash 与前置核验一致；grep 残留命中均为注释文件且未改动 |

## 遗留事项（信息级，不阻塞）

1. `cli.ts:627` / `hub-client.ts:1317` / `api-types.ts:4458` /
   `tests/integration/resilience-scenarios.test.ts:14` 四处旧注释仍引用改名前
   `_recoverSessionsOnBoot`——白名单外文件，按范围约束未动，归档前 quick 清理。
2. 本机 daemon 当前运行本次新代码的本地构建（BUILD_ID 文本对齐服务器 latest
   防覆盖）；服务器下次发布新版时 daemon 将按既有自更新链正常接续（届时新版
   应已包含本次改动——需走正常发布流程把主仓改动发布上线）。
3. 审计 tag `sillyspec-audit/sillyspec/2026-08-30-daemon-self-heal` 已锚定
   worktree 审计链（222 个 task review 引用），确认无需回溯后可 `git tag -d`。
