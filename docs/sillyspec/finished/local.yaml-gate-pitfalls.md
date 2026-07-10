---
author: qinyi
created_at: 2026-07-10T22:08:00+08:00
status: open
---

# local.yaml / gate verify-test 三个坑（P3 driver gate pilot 发现）

P3 driver gate pilot（2026-07-10-p3-driver-gate-pilot）实现 verify 阶段客观核验时，发现 sillyspec gate verify-test 读 local.yaml `commands.test` 有 3 个坑。坑 1 已解（本项目 local.yaml），坑 2/3 是 sillyspec 工具待改进点。

## 背景：gate verify-test 怎么跑

`sillyspec/src/verify-postcheck.js:59 runVerifyTestCheck`：

1. 读 `specBase/local.yaml` 的 `commands.test`（`extractTestCommand` :26，正则匹配 `test: "..."`）
2. `execSync(command, {cwd, timeout: 10*60*1000})`（:83）
3. `exitCode==0 → passed`，非 0 → failed；没配 commands.test → skipped（放行）

## 坑 1：commands.test 依赖 make（Windows 无 make）—— ✅ 已解

**现象**：本项目 Makefile 有 `test: backend-test frontend-test`，local.yaml `commands.test` 写 `"make test"`。但 Windows 本机 `make: command not found`（生产 docker Linux 有 make，本地开发 Windows 没）。

**解法**：commands 用跨平台命令链（`&&` + `cd`，不依赖 make）：
```yaml
commands:
  test: "cd backend && uv run pytest -q --no-cov && cd ../frontend && pnpm test && cd ../sillyhub-daemon && pnpm test"
```
`execSync` 走 shell，Windows git bash / cmd / Linux 都支持。

**sillyspec 改进建议**：scan 生成 local.yaml 时探测宿主有无 make——无 make 时生成跨平台命令链而非 make 命令；或在 CONVENTIONS 提示 monorepo 用跨平台链。

## 坑 2：测试超 gate timeout（硬伤，未解）

**现象**：本项目 backend pytest 全量 ~12min（757s，aiosqlite 慢 + 多模块），gate `TEST_TIMEOUT_MS = 10*60*1000`（`verify-postcheck.js:18`）= 10min。commands.test 跑 backend 全量 → gate verify-test **timeout failed**。

**根因**：sillyspec 假设项目测试 < 10min。大型项目 backend 测试超。

**影响**：gate verify-test 在本项目会 timeout failed（即使测试全过）。P3 gate 的核心防线（跑真测试）失效——这直接削弱 P3 的价值（gate 本该核验 backend 变更）。

**sillyspec 改进建议**（按优先级）：
1. **TEST_TIMEOUT_MS 环境变量可配**：`verify-postcheck.js:18` 改 `process.env.SILLYSPEC_TEST_TIMEOUT_MS ?? (10*60*1000)`，让大项目调大（如 30min）。最小改动，立竿见影。
2. **test_strategy:module 生效于 gate**：local.yaml 的 `test_strategy:module` 当前 gate 不读（runVerifyTestCheck 直接跑全 commands.test）。应让 gate 读 test_strategy + 变更范围，跑变更模块子集（快）。这需要 gate 知道本次变更涉及哪些模块（从 module-impact.md 或 git diff 推导）。
3. **gate 报告区分 timeout vs failed**：当前 timeout 归 failed（exitCode 非 0，:92）。应单独标 `status: 'timeout'`（让用户知道是超时不是测试失败，:356 errors 措辞误导）。

## 坑 3：daemon-client gate cwd 路径（未解，待 e2e 验证）

**现象**：gate verify-test 的 `execSync(command, {cwd: spec_root})`（:84）。daemon-client 平台模式下 daemon 跑 gate，`spec_root` 由 backend `_resolve_gate_spec_root`（run_sync/service.py）解析——可能 = specDir（`~/.sillyhub/daemon/specs/{ws}/`，只有 spec 文档，**无 backend/frontend 代码**）。

**影响**：若 spec_root = specDir，commands.test 的 `cd backend` 找不到目录（backend 不在 specDir）→ execSync spawn 失败。

**待验证**：sillyspec gate 发版后真实 daemon-client e2e 联调，确认 daemon 跑 gate 的 cwd 是项目代码根（daemon 工作目录）而非 specDir。若 cwd 错，`_resolve_gate_spec_root` 要解析到项目代码根。

**sillyspec 改进建议**：gate verify-test 的 `cwd`（`verify-postcheck.js:48 opts.cwd`）应明确 = 项目代码根（agent 跑代码的目录），`specBase` 只用于读 local.yaml / spec 产物。调用方（`machine-interface.js` gate verify）传项目代码根，而非 specBase。

## 现状总结

- 坑 1 已解（本项目 local.yaml 用跨平台链）
- 坑 2/3 待 sillyspec 工具改进——**不解决，gate verify-test 在本项目真跑会失败**（坑 2 timeout / 坑 3 cwd）
- P3 gate 发版前置（design §10 R4）满足前 gate 不会真跑，这两个坑的修复窗口在 sillyspec gate npm publish 之前

## 更新（2026-07-10 sillyspec commit 4bd12fb，已 push origin/main）

sillyspec 工具侧已修两部分（machine-interface 96 断言 + npm test 32 文件零失败验证）：

- ✅ **坑 2 建议①（TEST_TIMEOUT_MS 可配）已解**：`SILLYSPEC_TEST_TIMEOUT_MS` 环境变量，默认仍 10min。大项目（本项目 backend 12min）可调大，**不用改 sillyspec 代码**。本项目部署时设 `SILLYSPEC_TEST_TIMEOUT_MS=900000`（15min）即可让 gate 跑完 backend 全量。
- ✅ **skipped 警告强化已解**：local.yaml 未配 commands.test 时 gate verify-test skipped，显眼提示"gate 未核验测试，driver 不应据 exit 0 判定测试通过，integration-critical 降级 FAIL"——不再默默放行（之前 verify-postcheck.js:64-76 静默 skipped 的坑堵上了）。

**剩余 follow-up**（P3 设计文档 commit de1bbd6b 记录，标 draft v6→implemented + 3 follow-up 清单，下次明确触发再立项）：

- 坑 2 建议②（test_strategy:module 生效于 gate）—— monorepo 刚需（不跑全量 12min），P4 execute 波次编排需要 module 策略时立项
- 坑 3（daemon-client gate cwd 解析）—— **SillyHub 侧**（`_resolve_gate_spec_root`），非 sillyspec 工具
- local.yaml 轻量生成（与 scan 解耦）—— 几秒文件嗅探生成，create/gate 能用，scan 不被滥用（当前 scan 半小时太重）

## 关联

- 变更：`archive/2026-07-10-2026-07-10-p3-driver-gate-pilot/`（design §10 R4 / §5.6 Z1）
- 源码：`sillyspec/src/verify-postcheck.js:18 TEST_TIMEOUT_MS` / `:26 extractTestCommand` / `:59 runVerifyTestCheck` / `:83 execSync`
- 本项目 local.yaml：`.sillyspec/local.yaml` + `~/.sillyhub/daemon/specs/{ws}/local.yaml`（commands 跨平台链 + 坑 2/3 注释标注）
