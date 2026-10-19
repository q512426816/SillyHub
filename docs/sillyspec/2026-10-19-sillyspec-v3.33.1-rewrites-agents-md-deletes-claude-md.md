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
