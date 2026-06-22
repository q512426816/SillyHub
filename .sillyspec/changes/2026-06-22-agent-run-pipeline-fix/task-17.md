---
id: task-17
title: "[联调] sillyspec npm link + 对 myaaa 重跑完整 scan 验证"
priority: P1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13, task-14, task-15, task-16]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-10, FR-11]
decision_ids: [D-004@v1, D-005@v1]
allowed_paths: []
author: qinyi
created_at: 2026-06-22T21:19:09
---

# task-17: [联调] sillyspec npm link + 对 myaaa 重跑完整 scan 验证

## 修改文件

**无代码修改**（验证任务）。allowed_paths 为空。本 task 是 W1 + W2 全部代码改动完成后的端到端联调验收，验证调度链路（SillyHub backend → daemon → sillyspec CLI → Claude Code agent）端到端工作。

涉及的不改代码操作目录：
- `C:\Users\qinyi\IdeaProjects\sillyspec`（sillyspec 源码，task-05~task-08 改的仓库，本 task 只 `npm link` / reinstall 全局生效）
- `C:\Users\qinyi\IdeaProjects\myaaa`（被扫描的目标项目，只读，不修复其 scan 问题）
- `C:\Users\qinyi\IdeaProjects\multi-agent-platform`（SillyHub，task-01~task-04 + task-09~task-16 改的本仓库，本 task 启动 backend + daemon + frontend 做端到端验证）

## 覆盖来源 (design.md §X / requirements.md FR-NN)

- design.md §7 跨仓库管理 D-004（design.md:163-167）：
  - sillyspec 改动在 sillyspec 源码改 + git 提交（B1/B2/B3/B4）
  - 全局安装生效：sillyspec v3.18.5 当前全局安装于 `C:/Users/qinyi/AppData/Local/nvm/v24.15.0/node_modules/sillyspec`，改完源码后 `npm link`（或 reinstall）让全局命令指向新源码
  - 本变更文档在 multi-agent-platform 仓库记录跨仓库影响；sillyspec 仓库自身提交信息回引本变更名
- design.md §8 最终联调验收（design.md:183）：用修复后的 sillyspec + SillyHub 对 myaaa 重跑一次完整 scan，确认全程无 EPERM、无 post-check 误报、日志可读、最终状态正确（不再 completed_with_warnings/failed_post_check 带病推进）
- design.md §10 风险与对策 → "sillyspec 改源码后全局未生效（daemon 调旧版）"（design.md:197）：execute 验证 `sillyspec --version` / `which sillyspec` 指向新源码；npm link 后确认
- design.md §3 总体方案 P0/P1 分层（design.md:33-36）—— 本 task 是 P0 + P1 全部落地后的最终验收门
- requirements.md FR-01..FR-11 全部（联调验收覆盖所有功能需求）

## 实现要求

### 1. sillyspec 全局生效（npm link 或 reinstall）

**背景**：sillyspec v3.18.5 当前全局安装于 `C:/Users/qinyi/AppData/Local/nvm/v24.15.0/node_modules/sillyspec`。task-05~task-08 在 sillyspec 源码（`C:\Users\qinyi\IdeaProjects\sillyspec`）改了 B1/B2/B3/B4 问题，改完后需让全局 sillyspec 命令指向新源码。

**操作步骤**（在 `C:\Users\qinyi\IdeaProjects\sillyspec` 目录下）：

```bash
# 方案 A：npm link（推荐，开发期快速生效）
cd /c/Users/qinyi/IdeaProjects/sillyspec
npm link

# 方案 B：reinstall 全局（如果 npm link 有问题）
npm install -g .

# 验证全局命令指向新源码
which sillyspec
# 期望输出：/c/Users/qinyi/AppData/Local/nvm/v24.15.0/sillyspec（软链到 IdeaProjects/sillyspec）

sillyspec --version
# 期望输出：v3.18.5（或新版本号，若 task-05~08 改了 version）

# 验证 B3 修复：doctor / scan 顶层命令可用（design.md §5.2）
sillyspec doctor --help
sillyspec scan --help
```

**关键验证点**：`which sillyspec` 输出路径**必须**软链到 `C:\Users\qinyi\IdeaProjects\sillyspec`（新源码），而非 `C:/Users/qinyi/AppData/Local/nvm/v24.15.0/node_modules/sillyspec`（旧 npm 包）。否则 daemon 调用 sillyspec 时仍跑旧版（B1/B2/B3/B4 未生效）。

### 2. SillyHub 部署启动

**前提**：task-01~task-04（P0 backend + daemon 改动）+ task-09~task-13（P1 daemon 日志去重 + tool_use_id emit）+ task-14~task-16（前端展示）全部完成且单测/集成测试通过。

**启动步骤**：

```bash
# backend（Docker 容器）
cd /c/Users/qinyi/IdeaProjects/multi-agent-platform/deploy
docker compose up -d backend

# 确认 spec-data bind mount 已生效（task-01 改的 docker-compose.yml）
# 宿主机 C:/data/spec-workspaces 与容器 /data/spec-workspaces 应是同一物理目录
ls -la /c/data/spec-workspaces/  # 宿主机侧
docker compose exec backend ls -la /data/spec-workspaces/  # 容器侧
# 两边应看到相同的 ws_id 子目录

# daemon（Windows 主机）
# 确认 SPEC_ROOT_MAP 环境变量已注入（task-03 改的 config.ts 或 daemon-start.bat）
echo $SPEC_ROOT_MAP
# 期望输出：/data/spec-workspaces:C:/data/spec-workspaces（或类似翻译映射）

# 启动 daemon（按 multi-daemon-instances 记忆，连本地 daemon 用 daemon-start.bat）
./daemon-start.bat

# frontend
cd /c/Users/qinyi/IdeaProjects/multi-agent-platform/frontend
pnpm dev
```

**关键验证点**：
- backend 容器内 `/data/spec-workspaces/<ws_id>` 与宿主机 `C:/data/spec-workspaces/<ws_id>` 是同一物理目录（bind mount 生效，task-01 验收）
- daemon 启动后 `SPEC_ROOT_MAP` 环境变量非空（task-03 验收）
- frontend 启动无编译错误（task-14~task-16 改动 typecheck 通过）

### 3. 对 myaaa 重跑完整 scan

**操作**（在 SillyHub Web UI 中）：

1. 创建/选择一个 workspace，spec_root 指向 myaaa 源码目录或配置 spec-workspace（按平台模式）
2. 触发 agent run，task prompt 为 "对项目目录 C:\Users\qinyi\IdeaProjects\myaaa 执行 sillyspec scan"
3. 观察整个 run 生命周期：
   - agent 是否拿到正确的 spec-root（`C:/data/spec-workspaces/<ws_id>` 而非 `C:\Program Files\Git\data\...`）
   - scan 各步骤是否正常推进（init → scan → done）
   - post-check 是否检查正确路径（spec-root 下而非源码目录的 .sillyspec）
   - 日志面板是否展示正常（task-14~task-16 的 turn 分组、thinking 折叠、tool 卡片、token 徽标）
   - 最终 run 状态是否正确

**关键观察点**（对照 design.md §8 验收标准 + 各 task 的验收）：

| 观察 | 期望 | 对应 task / design 章节 |
|---|---|---|
| agent 拿到的 spec-root 路径 | `C:/data/spec-workspaces/...` 非 `C:\Program Files\Git\data\...` | task-01 / design §4.1 A1 |
| 全程 EPERM 错误 | 无 | task-01 / design §4.1 |
| "拒绝删除源码目录的 .sillyspec" 告警 | 无 | task-04 / design §4.4 C1 |
| post-check "目录不存在 .sillyspec/docs/frontend/scan/" 误报 | 无 | task-05 / design §4.2 B1 |
| scan-projects.json 含 "0"/"7" 等纯数字项目 | 无 | task-06 / design §5.1 B2 |
| `sillyspec doctor` / `sillyspec scan` 直接可用 | 是 | task-07 / design §5.2 B3 |
| post-check 失败时 `--done` 被拒、exit 非0、transition 门控 | 是（若 scan 真失败） | task-08 / design §4.3 B4 |
| 日志无 thinking 碎片化（每 token 一行） | 是，thinking 段合并 | task-09 / design §5.3 D1 |
| 日志无 thinking 重复（增量段+完整段） | 是，只显示一次 | task-10 / design §5.3 D2 |
| 同一 tool 调用只一张卡片（stdout [TOOL_USE] 与 tool_call JSON 合并） | 是，含距离 > ±3 窗口场景 | task-13 + task-14 / design §5.3 D3 |
| 日志面板 turn 分组展示 | 是，对照 prototype-agent-log-viewer.html 优化后面板 | task-15 / design §5.4 |
| thinking 默认折叠 + 点击展开 | 是 | task-15 / design §5.4 |
| tool 卡片状态徽标（✓/✗ + 耗时秒） | 是 | task-15 / design §5.4 |
| agent-run 面板 input/output token 徽标 | 是，流式期间增长 | task-16 / design §5.5 |
| 最终 scan 状态 | 非 completed_with_warnings / failed_post_check 带病推进 | design §8 |

### 4. post-check 失败的预期行为（重要）

myaaa 项目本身可能存在 scan 问题（如某些文档缺失、模块结构不完整），导致 post-check 真正失败。这是**预期行为**——task-17 不修复 myaaa 本身的 scan 问题，仅验证调度链路。

**验收标准**（task-08 的门控修复生效）：
- post-check 真正失败时，`sillyspec --done` 被拒（exit 非 0）
- stage 状态变为 `failed_post_check`（非 `completed`）
- 下游阶段被 stage-contract transition 门控拦截（design.md §4.3）
- agent 收到非 0 exit code 后日志显示失败原因，SillyHub AgentRun.status = "failed"
- 用户可 `--reset` 或修复 myaaa 后重跑（task-08 风险对策）

**非验收标准**：myaaa scan 必须跑出 completed 状态。只要调度链路正确（无 EPERM / 无 post-check 误报 / 无带病推进），即使最终 scan 失败（因 myaaa 本身问题），task-17 也算通过。

## 接口定义

本 task 是验证任务，无代码接口定义。验证涉及的外部接口：

- `sillyspec` CLI（全局命令，`C:\Users\qinyi\IdeaProjects\sillyspec` 源码 npm link 后生效）
- SillyHub REST API（`/api/workspaces/{id}/agent/runs` 创建 run，`/api/workspaces/{id}/agent/runs/{runId}/logs` 查日志，`/api/workspaces/{id}/agent/runs/{runId}` 查 run 状态含 token）
- SillyHub SSE 流（`/api/workspaces/{id}/agent/runs/{runId}/stream` 实时日志 + done 事件）
- daemon ↔ backend interactive claim payload（新增 specRoot/runtimeRoot 字段，task-02）
- daemon → backend submit_messages（usage_update 透传，task-runner.ts:1192-1195）

## 边界处理（≥5 条）

1. **sillyspec 全局未生效（旧 node_modules）**：`which sillyspec` 输出仍指向 `C:/Users/qinyi/AppData/Local/nvm/v24.15.0/node_modules/sillyspec`（旧 npm 包，非软链）→ daemon 调用时跑旧版 B1/B2/B3/B4 未修复。**对策**：先 `npm unlink sillyspec`（解除旧 link）再 `cd IdeaProjects/sillyspec && npm link`；或 `npm install -g .` 强制重装。验证 `ls -la $(which sillyspec)` 是软链（l 开头）指向 IdeaProjects/sillyspec。
2. **daemon-service-split 重叠导致 daemon 改动位置变化**：design.md §10 风险 1（design.md:196）提到 daemon-service-split 变更正在拆分 daemon.ts（W1 建 facade），task-03/task-09~task-13 改的 daemon.ts:1694-1705 / daemon.ts:1070-1080 / task-runner.ts:1284-1304 可能已迁移到拆分后的新文件。**对策**：联调前确认 daemon-service-split 当前进度（按 MEMORY.md multi-agent-orchestration-status 记忆），若 daemon.ts 已拆出日志/路径模块，定位新位置验证；若未拆完，在原文件验证并留 TODO 给 daemon-service-split execute。
3. **myaaa 源码只读**：本 task 不修复 myaaa 项目本身的 scan 问题（design.md §8 明确"不修复 myaaa 本身"）。若 scan 因 myaaa 文档缺失 / 模块结构问题失败，记录失败原因但**不**改 myaaa 源码。仅验证 SillyHub + sillyspec 调度链路是否正确处理失败（task-08 门控生效）。
4. **bind mount 路径权限**：`C:/data/spec-workspaces` 在 C 盘根目录，Windows 用户目录通常可写，但 C 盘根可能需管理员权限。**对策**（design.md §10 风险 3，design.md:198）：如遇权限错误，改 `deploy/.env` 的 `SPEC_DATA_HOST_DIR` 到用户目录（如 `C:/Users/qinyi/data/spec-workspaces`），重建容器。
5. **post-check 门控导致 scan 卡 failed_post_check**：task-08 修复后，若 myaaa post-check 真正失败，scan 会卡在 `failed_post_check` 状态，无法 `--done` 推进。**对策**（design.md §10 风险 5，design.md:200）：transition 门控允许 `--reset` 或修复 myaaa 后重跑；不影响新变更。本 task 验证此行为是预期（门控生效），不算 task-17 失败。
6. **daemon 多实例误杀**：按 MEMORY.md multi-daemon-instances 记忆，本机可能有两类 daemon（连本地 daemon-start.bat 与连远程手动 cmd）。停 daemon 按 --server 区分别误杀。联调前确认当前连的是本地 daemon（daemon-start.bat 启动，SPEC_ROOT_MAP 已注入）。
7. **agent-run 日志量大（8588 行+）**：myaaa scan 完整日志可能上万行，前端 normalize + turn 分组需保证性能不卡顿。**对策**：task-14 的 normalize 优化 + task-15 的 turn 分组应已处理（单 turn ErrorBoundary 隔离避免整页崩）；若仍卡顿，考虑虚拟滚动（YAGNI，本 task 不做，记录待未来优化）。
8. **CI ci-check hook**：按 MEMORY.md pre-commit-ci-check-hook 记忆，commit/push 前全量跑 backend mypy + frontend lint/typecheck/test。本 task 验证过程若涉及任何代码 commit（如 sillyspec 仓库的 task-05~08 已提交），需先验证工作区全过再 commit。纯验证步骤（无代码改）不触发 hook。

## 非目标

- **不**修复 myaaa 项目本身的 scan 问题（design.md §8 明确——仅验证调度链路；myaaa scan 若因文档缺失失败，记录但不改 myaaa 源码）。
- **不**改 sillyspec 源码（task-05~task-08 已改完，本 task 只 npm link 让全局生效）。
- **不**改 SillyHub 代码（task-01~task-04 + task-09~task-16 已改完，本 task 只启动 + 验证）。
- **不**做性能压测（日志量、并发 run 数等性能测试不在本 task 范围）。
- **不**做 macOS / Linux 宿主兼容验证（design.md §12 明确 YAGNI，仅 Windows 主机）。
- **不**做 sillyspec 两套 post-check 合并为一套（design.md §12 明确 YAGNI，workflow.js 走 specBase 后行为一致即可）。
- **不**验证 mission 多 agent 编排（2026-06-19-multi-agent-orchestration 变更范围，本变更只验证单 agent scan 调度）。

## TDD 步骤（验证流程）

> 本 task 是端到端验证任务，无单测/集成测试。TDD 退化为"验证流程"——按步骤执行，每步产出可观测的验证证据（命令输出 / 截图 / 日志片段）。

### Step 1：sillyspec 全局生效验证

```bash
cd /c/Users/qinyi/IdeaProjects/sillyspec
npm link

# 验证 1.1：which 指向新源码
which sillyspec
# 期望：软链到 IdeaProjects/sillyspec

# 验证 1.2：version 正确
sillyspec --version

# 验证 1.3：B3 修复——顶层命令可用（design §5.2）
sillyspec doctor --help
sillyspec scan --help
# 期望：不再报"未知命令"
```

**证据**：保存 `which sillyspec` + `sillyspec --version` + `sillyspec doctor --help` 命令输出。

### Step 2：SillyHub 部署启动验证

```bash
# 启动 backend + daemon + frontend（见"实现要求 §2"）

# 验证 2.1：bind mount 生效
ls -la /c/data/spec-workspaces/
docker compose exec backend ls -la /data/spec-workspaces/

# 验证 2.2：SPEC_ROOT_MAP 注入
echo $SPEC_ROOT_MAP

# 验证 2.3：frontend 编译无错
cd frontend && pnpm dev
```

**证据**：保存 bind mount 两边目录列表 + SPEC_ROOT_MAP 输出 + frontend 启动日志（无编译错误）。

### Step 3：对 myaaa 重跑 scan

在 SillyHub Web UI 中触发 agent run（见"实现要求 §3"），完整跑完一次 scan 生命周期。

**证据**：
- agent run log 文件（如 `agent-run-<id>.log`，对照原 `agent-run-7142b6cb.log` 的 8588 行问题日志）
- frontend 日志面板截图（展示 turn 分组、thinking 折叠、tool 卡片、token 徽标）
- AgentRun DB 记录（含 input_tokens/output_tokens/最终 status）

### Step 4：对照验收标准逐项确认

按"实现要求 §3 关键观察点"表格逐项验证，每项记录"通过/失败/部分通过 + 证据链接"。

### Step 5：失败处理

- 若某 task 的验收点失败：定位是代码 bug 还是验证步骤问题；代码 bug 回到对应 task 修复后重跑本 task；验证步骤问题修正步骤后重跑。
- 若 myaaa scan 因本身问题失败（非调度链路问题）：记录失败原因，验证 task-08 门控行为（`--done` 被拒 / transition 拦截）正确，task-17 仍算通过。

### 回归

- 确保本次联调不破坏既有功能（历史 agent run 日志面板仍能查看、mission 多 agent 编排仍能触发等）。
- 跑 `pnpm --filter frontend lint && pnpm --filter frontend typecheck && pnpm --filter frontend test`（纯防御，task-14~task-16 改动应已通过 pre-commit ci-check hook）。
- backend 跑 `pytest`（若有集成测试覆盖 agent run 流程）。

## 验收标准

| # | 验收点 | 验证方法 |
|---|---|---|
| 1 | sillyspec 全局命令指向新源码（npm link 生效） | `which sillyspec` 软链到 IdeaProjects/sillyspec + `sillyspec doctor --help` 不报"未知命令" |
| 2 | 全程无 EPERM 错误（agent spec-root = `C:/data/...`） | agent run log 全文 grep "EPERM" 无命中 + grep "C:\Program Files\Git\data" 无命中 |
| 3 | 无 post-check 误报"目录不存在 .sillyspec/docs/frontend/scan/" | agent run log grep "目录不存在" 无命中（或仅在 myaaa 真实缺文档时有合理报错） |
| 4 | 无 init 残留告警"拒绝删除源码目录的 .sillyspec：检测到真实资产" | agent run log grep "拒绝删除源码目录" 无命中 |
| 5 | 日志无碎片（thinking 每 token 一行）+ 无重复（增量段+完整段双份） | 日志面板对照原型：thinking 段合并、单条卡片，agent run log 中 [THINKING] 行数大幅减少（对照原 8588 行基线） |
| 6 | 同一 tool 调用只一张卡片（含 stdout [TOOL_USE] 与 tool_call JSON 距离 > ±3 窗口场景） | 日志面板 tool 卡片无重复 + agent run log grep "同一调用第二份" 无命中 |
| 7 | token 展示正常（input/output 徽标，流式期间增长） | frontend 面板截图：徽标数字随 assistant message 增长 + 终态与 AgentRun DB 一致 |
| 8 | timeline turn 分组 + thinking 折叠 + tool 卡片状态徽标 | frontend 面板截图对照 prototype-agent-log-viewer.html 优化后面板（142-200 行视觉结构） |
| 9 | scan-projects.json 无纯数字项目名（"0"/"7"） | scan 跑完后检查 sillyspec 输出的 scan-projects.json 内容 |
| 10 | 最终 scan 状态正确（非 completed_with_warnings / failed_post_check 带病推进） | AgentRun.status 要么 completed（scan 真成功）要么 failed（scan 真失败 + task-08 门控生效），不出现"带病推进" |
| 11 | post-check 真正失败时门控生效（--done 被拒 / exit 非0 / transition 拦截） | 若 scan 因 myaaa 问题失败，验证 sillyspec exit 非 0 + stage 状态 failed_post_check + 下游被拦截 |
| 12 | 联调全程无 daemon 崩溃 / backend 500 / frontend 客户端异常 | 观察 daemon 日志 + backend docker logs + frontend 浏览器 console，无 critical error |
