---
author: qinyi
created_at: 2026-11-07 00:25:00
change: 2026-11-06-session-git-approval
plan_level: full
scale: large
---

# 实现计划（Plan）— 2026-11-06-session-git-approval

> 任务名唯一真相在 tasks.md；本文只含 Wave 编排、任务总表与全局约束，不含实现细节（细节在 tasks/task-NN.md，execute 阶段展开）。

## Wave 分组

## Wave 1（并行，无依赖）
- task-01
- task-02
- task-09

## Wave 2（依赖前序 Wave）
- task-03
- task-04
- task-05
- task-07
- task-10
- task-11

## Wave 3（依赖前序 Wave）
- task-06
- task-08
- task-12

## Wave 4（依赖前序 Wave）
- task-13

## Wave 5（依赖前序 Wave）
- task-14

## Wave 6（依赖前序 Wave）
- task-15

## Wave 依赖说明

- **Wave 1**：无前置。产出 guard 纯函数 + 采集器 + 双挂载点（permission.ts 分支 / driver-factory 接线）+ guard 单测。契约冻结范围 = GitApprovalPayload + GitApprovalResult 双结构（均按 design 接口定义节，W2 的 executor 与 W4 的卡片各自局部 interface 同步实现）。
- **Wave 2**：依赖 W1 的 intent/payload 契约；task-05/06 消费 GitCommandIntent/GitApprovalResult 结构。
- **Wave 3**：task-08 验证精确重整语义（依赖 W2 的 task-05 落地 executor）；task-09/10 backend 端点与生成物（与 W1/W2 并行，task-10 依赖 task-09 的 openapi schema）。task-08 与 task-05 不同 Wave（git-executor.ts 文件面分离，postcheck 同 Wave 并行覆盖拦截）。
- **Wave 4**：依赖 W1 payload 冻结 + W3 端点就绪（task-11 依赖 task-01/09）；与 W2 可并行。
- **Wave 5**：依赖 W1~W4 全部；端到端三场景联调（无 manual_approval / 门户 / 后台锚点态）+ 回归与原型对账。

## 任务总表

| 任务 | 优先级 | Wave | 依赖 | 要点（一句话，细节见 TaskCard） |
|---|---|---|---|---|
| task-01 | P0 | 1 | — | git-command-guard 纯函数：拆段/识别/解析/预填（含 sillyspec push 形态与三不拦） |
| task-02 | P0 | 1 | task-01 | 工作区采集器：porcelain v2 + numstat 双口径 + ahead 提交明细（renamed 解析）+ **payload 容量截断（R-03：files>500 仅统计、每提交 files>50 截断，容量实测绑本任务验收）**；独立模块 git-approval-collector.ts（填卡勘误补登 design 清单） |
| task-03 | P0 | 1 | task-01, task-02 | permission.ts git 拦截分支（askUserOnly 先序 D-017）→ dialog_kind='git_approval' 挂起 |
| task-04 | P0 | 1 | task-01, task-02 | driver-factory.ts 仅写校验分支补 resolver 接线（D-016）+ 逃生阀 SILLYHUB_GIT_APPROVAL |
| task-05 | P0 | 2 | task-01, task-02 | git-executor：精确暂存区重整 commit（D-018）/ runner 分流 push（原样代执行 sillyspec） |
| task-06 | P0 | 2 | task-05 | 响应分发与结果回喂：批准→执行文本（sha/stderr），拒绝→原因（D-007） |
| task-07 | P0 | 1 | task-01 | guard 单测：复合命令绕过/多段 -m/pathspec/-a/-C/sillyspec 参数矩阵/--undo 不拦 |
| task-08 | P0 | 3 | task-05 | executor 单测：精确重整（他人暂存不动）/commit/push 成败/拒绝零暂存变更 |
| task-09 | P1 | 3 | — | backend 会话级 git-diff 只读端点（service + router + openapi） |
| task-10 | P1 | 3 | task-09 | gen:types 双跑：frontend + sillyhub-daemon api-types.ts + backend/openapi.json 三件生成物一并提交（规则 21 义务产物，已登记 design 文件清单） |
| task-11 | P0 | 4 | task-01, task-09 | GitApprovalCard：commit 态（目录树勾选/msg 编辑/diff）/push 态（按条明细可展开/警示）/拒绝态 |
| task-12 | P0 | 4 | task-11 | PendingDialogDock kind 分流（:137-152 map）+ page/dialog 双模式接线 |
| task-13 | P1 | 4 | task-11, task-12 | 卡片组件测试：三分流渲染/勾选交互/提交拒绝流/超时 deny 清卡（R-11） |
| task-14 | P0 | 5 | task-01..task-13 | 端到端联调三场景（R-02 turn 保活 / R-12 接线时序验证点） |
| task-15 | P1 | 5 | task-14 | dialog/审批存量测试回归 + 原型对账收尾：提交原型两件（git-approval-view.tsx + prototype-build.mjs，含重编译产物对账 git diff 为空，Q3） |

**关键路径**：daemon 主干 task-01/02 → task-03/04 → task-05/06 → task-14；前端支线 task-01 → task-11/12 → task-14（依赖 W1 契约冻结 + W3 端点，与 W2 无依赖边、可并行）；两条链在 task-14 汇合，W3 为旁路并行。

**Spike 判定**：不需要——全部挂载点/通道/组件均有生产先例（AskUserQuestion dialog / git-log 组件 / daemon RPC git_worktree_diff），技术方案确定；R-02/R-12 为实现期核实点（绑进 task-14 联调验收）、R-03 容量实测与截断实现归 task-02（见任务表要点），不构成架构不确定性。

## 全局硬约束（从 design.md 抄录，绑定所有 task）

- 拦截默认全局生效，不依赖 manual_approval 旗标（D-001）；逃生阀仅 `SILLYHUB_GIT_APPROVAL=off` 环境变量（默认 on）
- v1 只拦 `git commit` / `git push` / `sillyspec push`（推送形态）；`git add`、`sillyspec push --dry-run/--no-push/--undo`、merge/rebase/reset 等不拦（D-003/D-013）
- git 拦截分支置于 askUserOnly 自动放行判断之前（D-017）
- 代执行精确暂存区重整：reset 仅「已暂存但未勾选」、add 仅「勾选但未暂存」，禁止裸 reset（D-018）
- sillyspec push 确认后原样代执行 agent 原始命令，不附加任何参数（D-013）
- 拒绝路径不动暂存区；push main/master 警示不硬拦（D-006/D-007）
- 代码兼容 Windows/Linux/macOS；spawn 数组形参不经 shell；porcelain v2 path 按空格分隔实证坑解析；rename 条目取 new 路径
- 现有 dialog_kind（ask_user_question/plan_approval）分流/落库/渲染零改动；backend 审批链路与回传 API 零改动（dict 透传）
- 禁止跑全量测试，仅跑本变更相关测试（规则 0）
- daemon ESM import 必须带 .js 扩展名（知识库约定）；前端颜色零硬编码 hex（token 铁律）

## 全局验收标准

1. 所有新增单元测试通过（guard 8 类用例矩阵 / executor 重整语义 / 卡片三分流），相关存量测试零回归（dialog/审批/dock 套件）
2. 集成敏感点冒烟：无 manual_approval 会话端到端（拦截→确认卡→代执行→回喂）；门户会话（ask_user_only）git 写操作弹卡；后台锚点态 5min 自动 deny
3. （brownfield）`SILLYHUB_GIT_APPROVAL=off` 时行为与现状完全一致；guard 未命中命令走原路径零影响
4. `pnpm gen:types` + `pnpm -C sillyhub-daemon gen:types` 双跑且 api-types.ts/openapi.json 一并提交
5. 原型产物对账：prototype 重编译后 git diff 为空

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-03, task-04 | task-14 场景①（无 manual_approval 会话拦截成功） |
| D-002@v1 | task-05, task-06 | task-08 单测 + task-14 回喂文本 |
| D-003@v1 | task-01, task-07 | guard 单测不拦清单用例 |
| D-004@v1 | task-03 | task-14 刷新恢复场景 |
| D-005@v1 | task-01 | guard 范围限定（无数批处理挂载） |
| D-006@v1 | task-11, task-13 | 卡片警示徽标渲染测试 |
| D-007@v1 | task-06, task-11 | 拒绝回喂单测 + 卡片拒绝流测试 |
| D-008@v1 | task-03, task-04 | 复用链路零协议改动（git diff 无 protocol.ts 变更） |
| D-009@v1 | task-11, task-12 | 卡片挂载形态对照原型 |
| D-010@v1/D-011@v1 | — | rejected 防复潮记录（无任务，非目标节锚定） |
| D-012@v1 | task-02, task-11, task-13 | 目录树勾选+增删统计组件测试 |
| D-013@v1 | task-01, task-05, task-07 | sillyspec push 识别/原样代执行单测 |
| D-014@v1/D-015@v1 | task-02, task-11, task-13 | aheadCommits 明细+展开态测试 |
| D-016@v1 | task-04 | 「会话启动即拦截可达」单测 + task-14 场景① |
| D-017@v1 | task-03, task-14 | task-03 分支位置单测（扩展 session-manager-permission.test.ts）+ task-14 场景②（填卡勘误：分支位置测不到 guard 纯函数层，从 task-07 改落 task-03） |
| D-018@v1 | task-05, task-08 | 精确重整单测（他人暂存不动） |
| D-019@v1 | task-11, task-13, task-14 | 超时 deny 清卡路径测试（R-11） |
| FR-01（拦截全局生效） | task-01, task-03, task-04, task-07 | guard 单测 + task-14 场景①② |
| FR-02（提交确认卡） | task-02, task-11, task-12, task-13 | 卡片组件测试 |
| FR-03（推送确认卡按条明细） | task-02, task-11, task-13 | aheadCommits 渲染/展开测试 |
| FR-04（代执行与回喂） | task-05, task-06, task-08 | executor 单测 + task-14 回喂验证 |
| FR-05（拒绝回喂） | task-06, task-11, task-13 | 拒绝流测试 |
| FR-06（边界行为） | task-04, task-13, task-14 | 逃生阀 + 超时 deny 清卡测试 |
