---
author: qinyi
created_at: 2026-11-06 23:18:20
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 工作区用户 | 在会话页确认/拒绝/修改 agent 的 git 提交与推送（本功能唯一交互角色） |
| agent | 会话中被拦截挂起、接收执行/拒绝结果回喂 |
| daemon | 命令识别、挂起、本机代执行、结果回喂 |
| backend | 审批转发/落库/SSE（复用）+ 会话级 diff 端点（新增） |

## 功能需求

### FR-01: git 提交/推送拦截（全局生效）
Given 任意交互式会话（含未开 manual_approval 与 ask_user_only 门户会话）中 agent 通过 Bash 跑 `git commit` / `git push` / `sillyspec push`（推送形态）
When 命令经复合命令拆段识别命中
Then agent 挂起（dialog 长驻等待不超时），`dialog_kind='git_approval'` 审批请求到达前端；`sillyspec push --dry-run/--no-push/--undo` 与 `git add`、未命中命令不拦（D-003/D-005/D-013/D-017）

### FR-02: 提交确认卡（目录树勾选 + msg 编辑）
Given FR-01 的 commit 拦截触发
When 确认卡渲染（AskUserQuestion 同款对话卡，双模式挂载，可最小化）
Then 显示分支/原始命令/预填 msg（可编辑）/文件目录树（已暂存/未暂存/未跟踪三分组、四色状态、增删行数、行级+目录级勾选、预填=agent 意图范围）；单文件可查看 diff；页面刷新后卡片恢复（D-009/D-012）

### FR-03: 推送确认卡（按条提交明细）
Given FR-01 的 push/sillyspec push 拦截触发
When 确认卡渲染
Then 显示目标 remote/分支（main/master 红色警示不硬拦）+ 待推送提交按条明细（sha/首行/作者/日期，≤20 条）且单条可展开该提交的文件明细（与提交确认卡同款展示、纯浏览）；sillyspec 发起时显示压扁语义提示（D-006/D-013/D-014/D-015）

### FR-04: 确认后代执行与回喂
Given 用户在确认卡上修改 msg/文件勾选（commit）或确认目标（push）后点击提交/推送
When daemon 收到批准响应
Then commit 流精确重整暂存区（仅动勾选相关文件，他人暂存不动）→ 按用户 msg 提交；push 流按 runner 代执行（git push / 原样 sillyspec push 保留压扁）；执行结果文本回喂 agent，会话继续（D-002/D-018）

### FR-05: 拒绝回喂
Given 用户点击拒绝（可填快捷原因或自由填写）
When 拒绝响应到达 daemon
Then 拒绝原因回喂 agent（Bash 工具结果），暂存区不动，agent 可调整后重新发起（D-007）

### FR-06: 边界行为
Given 后台锚点态会话（backgroundTask）触发 git 拦截
When 5 分钟无人确认
Then 自动 deny 回喂（fail-safe，后台任务不提交）；resolved 事件到达后前端待决卡即时清理无僵尸卡（D-019/R-11）；`SILLYHUB_GIT_APPROVAL=off` 环境变量全局关闭拦截（兼容策略）

## 非功能需求
- 兼容性：未命中命令走原路径零影响；现有 dialog_kind（ask_user_question/plan_approval）分流/落库/渲染零改动；老前端对未知 kind 降级路径不变
- 安全：复合命令拆段匹配防绕过；共享暂存区不被越权清理；spawn 数组形参不经 shell
- 跨平台：Windows/Linux/macOS（路径、porcelain 解析、中文路径单测覆盖）

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001 | FR-01 | 全局生效不依赖 manual_approval |
| D-002 | FR-04 | daemon 代执行不交回 agent |
| D-003 | FR-01 | 只拦 commit/push |
| D-004 | FR-01 | 长驻等待+刷新恢复 |
| D-005 | FR-01 | 仅交互式会话 |
| D-006 | FR-03 | 保护分支警示不硬拦 |
| D-007 | FR-05 | 拒绝原因回喂 |
| D-008 | FR-01/04 | 方案 A 审批管线复用 |
| D-009 | FR-02 | UI 锚定 AskUser 卡 |
| D-010/D-011 | — | 落选方案防复潮记录 |
| D-012 | FR-02 | 目录树+增删统计 |
| D-013 | FR-01/03/04 | sillyspec push 识别+原样代执行 |
| D-014 | FR-03 | 推送卡按条提交明细 |
| D-015 | FR-03 | 单条提交展开文件明细 |
| D-016 | FR-01 | 仅写校验分支补接线（可达性） |
| D-017 | FR-01 | git 拦截先于 askUserOnly |
| D-018 | FR-04 | 精确暂存区重整 |
| D-019 | FR-06 | 后台锚点态 5min 兜底 |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-06: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
