---
author: qinyi
created_at: 2026-08-15T23:20:00
change: 2026-08-15-init-trigger-sillyspec-init
stage: verify
---

# 验证报告

## 结论

PASS

## 任务完成度

10/10（100%）。plan.md checkbox 全勾；task review.json 10/10 pass（跨仓 task-01~03 双锡点锚 sillyspec 仓 f13e96da..01c44da 三 commit；主仓 task-04~10 锚 worktree 分支 00cd0ae1..597165df）；stage acceptance review 16 项 checklist 全 pass（独立 QA 子代理产出并独立复跑测试）。

代码落盘与 design 文件清单对账：
- 跨仓 sillyspec：src/index.js、src/init.js、test/init-{no-skills,tool-multi,platform-keep-local-yaml}.test.mjs——精确命中（区间内 run/prompt.js 等系并行 change 文件，三 commit 均 pathspec 限定无裹挟）。
- 主仓：sillyhub-daemon/src/{spec-sync,task-runner,cli}.ts、tests/{run-sillyspec-init,test_init_lease,spec-sync-incremental,spec-sync}.test.ts、backend spec_workspace/service.py + test_apply_ops_same_hash_noop.py——9 文件 1315+/38- 与清单一一对应。

## 设计一致性

逐决策代码锚点核验（worktree 实测）：
- D-001@v1：runSillyspecInit 纯 spawn 字符串命令，无 sillyspec 内部 import。
- D-002@v2：handleInitLease 步骤 2 pull → 步骤 3 init（注释明标 rev2 时序）→ 步骤 4 post → 步骤 5 localYaml。
- D-003@v1：init 失败 return 同构 + _finish(false) lease failed + stats.init_error 前缀。
- D-004@v1：--no-skills flag 常传；skill-manager 链路零改动。
- D-005@v1：SILLYSPEC_VALID_TOOLS 6 值与 sillyspec init.js:76 逐字一致（agent-detector 12 provider 同名交集实测 6 个）。
- D-006@v1：60s 超时常量 + Windows taskkill /PID /T /F / POSIX kill 树。
- D-007@v1：cli.ts:768 构造前 AgentDetector 独立探测注入；探测失败不阻塞启动。
- D-008@v2：backend service.py:1111-1113 同 hash no-op（R-07 注释）+ daemon :443 UPLOAD_EXCLUDE_TOP_BASE 含 projects（N-01 收口）。
- D-009@v1：MIN_SILLYSPEC_VERSION_FOR_INIT='3.26.8' 定版；3s 门控 fail-safe；中文升级指引。
- 生命周期契约：git diff 00cd0ae1..597165df 无 schema.py/hub-client.ts/frontend 改动——lease metadata/claim payload/FileOp schema 零变更。
- 非目标遵守：不动 gate verify 白名单、不建通用命令执行。

## 探针结果

无 delete 误删探针触发；spec-sync.test.ts 的 packSpecDir 排除断言因 fixture 无 projects/ 目录不受影响（task-07 已补正向用例）。

## 测试结果

| 套件 | 结果 |
|---|---|
| daemon typecheck（tsc --noEmit） | exit 0 |
| daemon 触及测试 4 文件冒烟 | 61/61 passed |
| backend spec_workspace pytest | 88 passed, 1 skipped（预存 Windows symlink 平台跳过） |
| backend ruff check + format --check | 全过（18 files formatted） |
| 跨仓 sillyspec 全量（node test/run-tests.mjs） | 204 测试文件 37+204 组 0 失败（含本变更 3 新测试文件 30 断言） |

## 变更风险等级

integration-critical（design 含 daemon/lease/lifecycle 关键词）——已按门控要求提供下述真实运行时证据。

## Runtime Evidence（integration/deployment-critical 必填——真实集成端到端运行时证据）

以下为 execute 阶段 task-10 真实集成（端到端 e2e test：真实 daemon↔backend 跨进程链路，非 mock 单测）实测记录：docker backend 8001（真实启动的服务）+ worktree 构建版 daemon（真实启动一次 `node dist/cli.js start --server http://127.0.0.1:8001`，本变更实际改动的 daemon 启动链路）+ npm link 本地 CLI 3.26.8（真实启动一次 `sillyspec init` 子进程）。测试工作区/目录事后已清理。

**场景 1（首成员初始化）**：新建工作区（rootPath=initverify-project，daemon 绑定 68c63051）触发 init lease → lease 完成后实测：
- 项目目录出现 `.sillyspec-platform.json`（specRoot 指向 `~/.sillyhub/daemon/specs/<wsId>`、workspaceId、status: active）
- CLAUDE.md（SillySpec v3.26.8 受管头）+ AGENTS.md + INSTRUCTIONS.md（agent-detector 多工具映射注入生效）
- `.claude/skills/` 无 sillyspec-* 目录（--no-skills 生效）
- specCacheRoot 出现完整骨架（docs/knowledge/workflows/shared/workspace/.runtime + sillyspec.db）
- 服务器 spec_file_manifest 收到 6 行新建（v1）；projects/ 目录零上传
- daemon log（运行时证据，`~/.sillyhub/daemon/start-initverify2.out` 日志片段）：`[daemon.task_available] lease_id=8ac0455f...` → `spec_sync: init_lease_sillyspec_init 18617b7e... ok` → `task_runner: init_lease_done ... ok: true` → `[daemon.task_completed] success=true`

**场景 2（重复初始化）**：预置 local.yaml 手调段（custom_note: keep-me）→ 再次触发 init → 手调段逐字保留（平台模式跳过项目内清理生效，R-05 闭合）；骨架文件重传全部 no-op（manifest 版本停留 v1，无 conflict）。

**场景 3（第二成员加入已扫描工作区）**：同一 spec 内容、新 rootPath 工作区触发 init → pull 拉到权威 6 文件 → init 补骨架 → postSpecSync 骨架 add 全部命中同 hash no-op：manifest 零新行、零 conflict（daemon log 运行时证据：`init_lease_post_ok 06e8dc49... { ok: true, reparsed: 0, filesTotal: 6 }`，全日志无 conflict 字样，grep 计 0）。

**门控负路径**：注入 spawnFn 使 `sillyspec --version` 返回 3.20.0 → runSillyspecInit 返回 ok:false，error 前缀 `sillyspec_init_cli_too_old`，中文信息含"重启 daemon（preflight 自动升级）或手动执行 npm install -g sillyspec@latest"。

## 遗留事项（不阻断 PASS）

1. npm 正式发版待用户操作：当前 3.26.8 为本机 npm link 验证版（用户决策"不发版本机打包测试"）。MIN 常量语义为下界，正式发版版本 ≥3.26.8 时无需改动。
2. 主仓 dist 尚未含新代码——worktree apply 后自然生效；apply 前用旧 daemon 的 init lease 会走旧 5 步编排（无 init 步骤），属预期。
3. 环境变更记录：daemon config server_url 由 3001（心跳失败）改 8001 直连——顺带修复了记忆中的已知连接问题，非本变更范围但已验证稳定。
