---
author: qinyi
created_at: 2026-11-06 23:18:20
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
交互式会话中 agent 通过 Bash 工具直接裸跑 `git commit` / `git push`（含 `sillyspec push` CLI），平台对这两类改写仓库/远端的操作零拦截——用户希望在提交/推送落地前做最后一道人工把关：会话页弹出确认卡（预填 commit msg 与文件勾选），二次修改后由平台代执行并回喂 agent。

## 关键问题
1. **零拦截**：daemon 写守卫提取不到 git 命令的写路径，agent 可直接提交/推送，用户失去最后把关点；
2. **不可见**：agent 的 git 操作在会话流里只是一条 Bash 日志，用户看不到将提交/推送的具体内容（msg、文件范围、待推送提交明细）；
3. **规范路径漏拦**：本仓 agent 的规范推送是 `sillyspec push` CLI（技能禁止直接 git push），CLI 内部自行推送不经 agent Bash——简单拦 `git push` 字面量形同虚设。

## 变更范围
- daemon：git 命令识别（拆复合命令 + sillyspec push 形态）→ dialog_kind='git_approval' 挂起 → 用户确认后本机代执行（精确暂存区重整 commit / 原样代执行 push）→ 结果回喂 agent；
- backend：仅新增会话级单文件 diff 只读端点（审批链路 dict 透传零改动复用）；
- 前端：AskUserQuestion 同款确认对话卡（目录树勾选 + 增删统计 + msg 编辑 + diff 查看；push 态按条提交明细可展开文件清单）。

## 不在范围内（显式清单）
- 不拦 `git add`、`git merge` / `rebase` / `reset` 等历史改写操作（D-003）；
- 不覆盖批处理 run 与团队分身（D-005）；
- 不做 push main/master 硬拦截（警示徽标，D-006）；
- 不防御 base64 包裹等怪异命令伪装形态（已知限制）。

## 成功标准（可验证）
- agent 跑 `git commit` / `git push` / `sillyspec push`（推送形态）时会话挂起，确认卡出现在会话页（页内+弹窗双模式），刷新页面卡片不丢；
- 确认卡目录树展示改动文件（四色状态 + 增删行数 + 目录级勾选），msg 可编辑、文件可增减勾选，单文件可看 diff；
- push 态按条展示待推送提交（sha/首行/作者/日期），单条可展开文件明细；
- 用户确认后由 daemon 代执行（提交内容=用户改后的 msg+勾选集；sillyspec push 原样执行保留压扁），执行结果回喂 agent，会话继续；
- 用户拒绝后原因回喂 agent，agent 可调整重新发起；
- 未开 manual_approval 的会话同样拦截（全局生效）；`SILLYHUB_GIT_APPROVAL=off` 可全局关闭。
