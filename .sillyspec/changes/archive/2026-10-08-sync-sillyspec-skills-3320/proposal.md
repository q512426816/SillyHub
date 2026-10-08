---
author: flow-machine-draft
created_at: 2026-10-08T01:59:18.923Z
---
# 提案书（Proposal）— 2026-10-08-sync-sillyspec-skills-3320

## 动机

任务原话转写：刷新仓库内嵌 SillySpec 技能到 CLI 3.32.0——平台预置技能缺新增的 sillyspec-flow，.zcode 的 sillyspec-quick 被本地手补分叉，AGENTS.md 注入段版本号停在 v3.29.3
成功标准：
- .claude/.codex/.opencode/.zcode 四镜像目录均有 21 个 sillyspec-* 技能（含 sillyspec-flow），内容与 npm sillyspec@3.32.0 包一致
- .zcode/skills/sillyspec-quick/SKILL.md 去掉本地手补的退役横幅段，还原为上游原版
- AGENTS.md 注入段版本号刷新为 v3.32.0
- docs/sillyspec/ 新增活跃坑：init 技能同步映射不含 zcode

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. .claude/.codex/.opencode/.zcode 四镜像目录均有 21 个 sillyspec-* 技能（含 sillyspec-flow），内容与 npm sillyspec@3.32.0 包一致
2. .zcode/skills/sillyspec-quick/SKILL.md 去掉本地手补的退役横幅段，还原为上游原版
3. AGENTS.md 注入段版本号刷新为 v3.32.0
4. docs/sillyspec/ 新增活跃坑：init 技能同步映射不含 zcode

## 成功标准（可验证）

1. .claude/.codex/.opencode/.zcode 四镜像目录均有 21 个 sillyspec-* 技能（含 sillyspec-flow），内容与 npm sillyspec@3.32.0 包一致
2. .zcode/skills/sillyspec-quick/SKILL.md 去掉本地手补的退役横幅段，还原为上游原版
3. AGENTS.md 注入段版本号刷新为 v3.32.0
4. docs/sillyspec/ 新增活跃坑：init 技能同步映射不含 zcode
