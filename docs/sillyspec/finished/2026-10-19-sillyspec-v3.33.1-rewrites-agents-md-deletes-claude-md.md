# sillyspec v3.33.1 自升级重写 AGENTS.md 并删除 .claude/CLAUDE.md（活跃坑）

- **日期**：2026-10-19 10:42 前后（2026-10-19-hide-shared-profile-in-session 收口 spec-sync 时段）
- **现象**：未执行任何 `sillyspec init` 的情况下，工作区出现
  `AGENTS.md` 被整文件重写（v3.32.0 指针版 → v3.33.1「SillySpec init 生成」完整指引版，
  文件头标记 `SillySpec v3.33.1 — 由 sillyspec init 生成`），同时 `.claude/CLAUDE.md`
  被从磁盘删除（未暂存的工作区删除）。`.claude/skills/sillyspec-flow/SKILL.md`、
  `.codex/skills/sillyspec-*` 等多处 skill 文档同批出现改动。
- **推断**：sillyspec CLI 自动升级到 v3.33.1 后（或在后台 spec-sync 流程中）重跑了
  init/迁移逻辑——新版把「AGENTS.md 指针 → .claude/CLAUDE.md 正文」的双文件形态
  迁移为「AGENTS.md 单文件完整指引」，迁移动作包含**删除 .claude/CLAUDE.md**。
- **危害**：
  1. `.claude/CLAUDE.md` 是本仓库声明的最高优先级指令源（AGENTS.md 原文要求先读它），
     被静默删除后所有 agent 会话丢失核心规则（完成汇报格式、测试纪律、危险 git 备份等）；
  2. 删除发生在 agent 工作区内且无任何提示，若当时顺手 `git add -A` 提交，
     删除会进 main 历史。
- **已做处置（2026-10-19 本会话）**：
  - `git restore .claude/CLAUDE.md` 从 HEAD 恢复（内容完整，7353 字节）；
  - `AGENTS.md` 新版**未提交**，保留在工作区待用户裁决（接受 v3.33.1 单文件形态，
    或 `git restore AGENTS.md` 回指针版——注意旧指针版与已恢复的 CLAUDE.md 自洽）。
- **待工具修复**：
  1. init/迁移不应在未显式调用时自动执行；
  2. 迁移删除高优先级指令文件前必须显式确认或备份留痕；
  3. 至少应在 CLI 输出中明确报告「已重写 AGENTS.md / 已删除 .claude/CLAUDE.md」。
- **给后续会话的提醒**：进仓库先核对 `.claude/CLAUDE.md` 存在且与
  `git show HEAD:.claude/CLAUDE.md` 一致；暂存一律用精确 pathspec，禁 `git add -A`
  （本次 `add -A` 曾把 CLAUDE.md 的删除一并暂存，已及时撤掉）。

## 处置收口（2026-10-20 关闭核查）

- **用户裁决已落地**（2026-10-19，b35291abb）：AGENTS.md 新版（v3.33.1 自包含指引）经
  用户指示全部提交，`.claude/CLAUDE.md` 已恢复并入库——本坑记录的工作区事件
  （静默重写 + 未暂存删除）闭环，仓库两文件现为一致的已提交态。
- **工具侧现状核查**（sillyspec 仓 main，2026-10-20）：
  1. init 注入唯一入口是显式 `sillyspec init`（src/index.js:454；injectAgentsInstructions
     无其它调用方）；CLI 入口自动迁移只有 migrateRuntimeLayout（仅 .runtime 布局，不碰
     AGENTS.md/CLAUDE.md）；全 src 无删除 CLAUDE.md 的代码路径（cleanupRuntimeResidue 只清
     legacy `.sillyspec/codebase` 与 `.runtime`）；
  2. 完整态 AGENTS.md 与旧版完整 CLAUDE.md 升级时均「不覆盖，仅 stderr 告警 + 备份后手动
     迁移」指引（src/init.js:195 / :244）——「删除前确认/留痕」与「输出报告」两项在 CLI 面
     已满足；
  3. 工具治理模板（.claude/.codex/.gemini/.opencode/.zcode/.cursor + CLAUDE.md）已整体剔出
     冻结/提交/独占脏面/孤儿面与跨仓对账面（sillyspec 2026-10-19-freeze-filter-tool-scaffold
     71b3ff3e + 2026-10-19-cross-repo-face-tool-filter 6049c3e0），模板变更不再随交付面流入
     消费仓。
- **遗留注记（不影响关闭）**：daemon 平台模式仍按编排自动 spawn `sillyspec init` 与自动
  升级（sillyhub-daemon preflight.ts / spec-sync.ts，平台模式设计语义）；本次事件的确切
  触发路径未复现定位——若再现，将落在「模板不入交付面 + init 不删文件 + 有输出报告」的
  新口径下，危害面已收窄。
- 处置结论：工作区事件已裁决闭环 + 待工具修复三项在现行 CLI 面满足，本文件移入 finished/。
