# 决策知识 — agent-skills

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-agent-skills-001@v1 2026-10-08-sync-sillyspec-skills-3320——仓库内嵌 sillyspec 技能快照落后最新 CLI（3.32.0）：缺新增的 `sillyspec-flow`（21st 技能），`.zcode/silly
状态：implemented
变更：2026-10-08-sync-sillyspec-skills-3320
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-08-sync-sillyspec-skills-3320/design.md
文件：.claude/commands/sillyspec/flow.md, .claude/commands/sillyspec/run-archive.md, .claude/commands/sillyspec/run-brainstorm.md, .claude/commands/sillyspec/run-execute.md, .claude/commands/sillyspec/run-plan.md, .claude/commands/sillyspec/run-quick.md, .claude/commands/sillyspec/run-verify.md, .claude/commands/sillyspec/status.md, .claude/skills/sillyspec-flow/SKILL.md, .codex/skills/sillyspec-flow/SKILL.md, .opencode/skills/sillyspec-flow/SKILL.md, .zcode/commands/sillyspec/flow.md, .zcode/commands/sillyspec/run-archive.md, .zcode/commands/sillyspec/run-brainstorm.md, .zcode/commands/sillyspec/run-execute.md, .zcode/commands/sillyspec/run-plan.md, .zcode/commands/sillyspec/run-quick.md, .zcode/commands/sillyspec/run-verify.md, .zcode/commands/sillyspec/status.md, .zcode/skills/sillyspec-flow/SKILL.md
最近确认：未记录
理由：仓库内嵌 sillyspec 技能快照落后最新 CLI（3.32.0）：缺新增的 `sillyspec-flow`（21st 技能），`.zcode/sillyspec-quick` 被本地手补分叉，AGENTS.md 注入段停在 v3.29.3。平台预置技能链（`.claude/skills` → docker build `additional_contexts` → `/app/sillyspec-skills` → 后端 `SKILLS_GLOB` 打 bundle → daemon 软链进 worktree）以仓库文件为唯一源，故修复=刷新仓库快照。 方案：主仓库根目录跑 `sillyspec init`（历史惯例，见 commit 904ef623e v3.28.3 刷新）同步 `.claude/.codex/.opencode` 三目录 + 刷新 AGENTS.md 注入段；`.zcode/skills` 因 CLI 已知缺口（detectTools 无 zcode 分支 + skillToolDirs 无映射）手动补拷 `sillyspec-flow` 并用上游原版覆盖手补过的 `sillyspec-quick`；`sillyspec init --tool zcode` 补齐 `.zcode/commands/sillyspec/` 流程命令卡；缺口本身记入 `docs/sillyspec/` 活跃坑。同步源取 npm `sillyspec@3.32.0` tgz 解包件（已验证与本地全局 CLI 开发仓逐字节一致，21 技能）。

## D-agent-skills-002@v1 2026-10-16-deploy-convergence-guard——双管齐下：① build-and-save.sh 加 [0/5] 部署并流校验段——分支非 main 或应用目录脏（backend/frontend/silly
状态：implemented
变更：2026-10-16-deploy-convergence-guard
原编号：D-000@v1
锚点：.sillyspec/changes/archive/2026-10-16-deploy-convergence-guard/design.md
文件：.zcode/skills/deploy-to-server/SKILL.md, deploy/scripts/build-and-save.sh
最近确认：未记录
理由：双管齐下：① build-and-save.sh 加 [0/5] 部署并流校验段——分支非 main 或应用目录脏（backend/frontend/sillyhub-daemon/deploy 未提交改动）时告警退出（ALLOW_NON_MAIN_DEPLOY/ALLOW_DIRTY_DEPLOY 显式放行逃生口），并始终打印「打包源: 分支 X @ sha」留痕；② deploy-to-server skill 新增 §0 部署并流校验节（事故背景+双闸门+部署后 commit_sha 核对+被覆盖识别恢复三步），修正过期的 PROD_API_URL 示例（192.168.0.143 → https://crrcdt.ppdmq.top，服务器迁移后旧值失效）。选闸门放在打包脚本（而非仅文档约定）：skill 是"给人读的约定"，脚本是"绕不过的机械闸"——2026-10-16 事故证明纯约定挡不住并行会话。
