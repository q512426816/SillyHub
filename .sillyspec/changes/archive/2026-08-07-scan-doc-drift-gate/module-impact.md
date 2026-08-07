---
author: qinyi
created_at: 2026-08-07 16:14:22
---

# 模块影响分析（Module Impact）— scan 文档 drift 漂移检测门

## 变更概述

为治 scan 文档（`.sillyspec/docs/SillyHub/scan/*.md`，8 篇）反复过期，新增 warn-only CI 漂移检测门：独立 Python 脚本 `scripts/scan-drift-check.py` 双信号检测（source_commit 时效 + 文件路径存在性），CI workflow `scan-drift.yml` warn 注解 + 去重 PR 评论，本地 `local.yaml` 加 `scan:check` 别名。**零产品源码改动**（backend/frontend/sillyhub-daemon 源码不动）。

## 真实变更文件（真相源 = worktree git diff d31ec53d..HEAD，剔除 baseline overlay 幽灵文件）

| 状态 | 文件 |
|---|---|
| A | .github/workflows/scan-drift.yml |
| A | scripts/scan-drift-check.py |
| A | scripts/test_scan_drift_check.py |
| M | .sillyspec/docs/SillyHub/scan/ARCHITECTURE.md |
| M | .sillyspec/docs/SillyHub/scan/CONCERNS.md |
| M | .sillyspec/docs/SillyHub/scan/CONVENTIONS.md |
| M | .sillyspec/docs/SillyHub/scan/FRONTEND_PAGE_STYLE.md |
| M | .sillyspec/docs/SillyHub/scan/INTEGRATIONS.md |
| M | .sillyspec/docs/SillyHub/scan/PROJECT.md |
| M | .sillyspec/docs/SillyHub/scan/STRUCTURE.md |
| M | .sillyspec/docs/SillyHub/scan/TESTING.md |

> **剔除的 baseline overlay 幽灵文件**（非本变更产出）：`.claude/skills/verify-per-user/SKILL.md`、`.sillyspec/changes/2026-08-06-public-mcp-server/*`（22 个）、`meta.json`——这些是 worktree 创建时主仓库未提交文件被 overlay 进 baseline（actualBaseHash=d31ec53d），归各自 change/提交，不计本变更。用 5a00fc7e..HEAD（baseHash..HEAD）会误含这些，必须用 actualBaseHash 作真实 base。
>
> `.sillyspec/local.yaml`（M，task-04 的 scan:check 别名）为 **gitignored 本地配置**（`git check-ignore` 命中 `.gitignore:16` 确认），不在 git diff 内，功能仅本机生效，单独说明（不作为可交付模块影响）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| ci | 新增 | .github/workflows/scan-drift.yml | 新增 scan-drift CI workflow：PR/push 触发，fetch-depth:0 全历史，setup-python 3.12，跑 drift 脚本（warn-only exit 0），github-script 去重 PR 评论。不新增 required check，零阻塞现有 CI | false |
| sillyspec | 配置变更 | .sillyspec/docs/SillyHub/scan/*.md（8 篇） | 刷新 8 篇 scan 文档 frontmatter source_commit 6e78b29a→5a00fc7e（当前 HEAD）+ 修失效文件路径引用（TESTING/ARCHITECTURE 等）+ CONCERNS 归档已解决项。不改 scan 语义结构 | false |

说明：
- **ci 模块**：纯新增独立 workflow，warn-only exit 0 不改任何现有 CI 行为，不影响 backend/frontend-ci 等既有 workflow（互不调用）。needs_review=false。
- **sillyspec 模块**：scan 文档是 sillyspec 规范资产，本次只刷新其 source_commit 锚点 + 修失效路径（可机械验证），不改 scan 内容语义。`_module-map.yaml` 自身的 sillyspec/根模块 source_commit（ba87eec）也属同类 stale 性质，是否同步刷新留 Step 3 doc-syncer 决策。

## 未匹配文件

根 `scripts/` 目录下文件**未命中 `_module-map.yaml` 任何模块**（backend/frontend/sillyhub-daemon/deploy/build/ci/docs/prototype/sillyspec/spikes 的 paths glob 均不覆盖根 `scripts/`）。

| 文件 | 状态 | 说明 | needs_review |
|---|---|---|---|
| scripts/scan-drift-check.py | A | drift 检测脚本（双信号 + warn 注解 + CLI）。纯工具脚本，无运行时集成，32 单测覆盖 | true |
| scripts/test_scan_drift_check.py | A | 上述脚本的 pytest 单测（32 测试） | true |

说明（Step 3 决策点）：
- `scripts/` 是 monorepo 根的独立工具脚本目录，**既有未匹配**（非本变更引入），现 `_module-map.yaml` 未覆盖。本变更新增的 2 个脚本是其中首批文件。
- **是否在 Step 3 doc-syncer 给 `_module-map.yaml` 新增 `scripts` 模块（paths `scripts/**`）留用户确认**。倾向：本次不擅自加（避免范围蔓延，且给模块映射加模块会触发下游 scan 一致性），标注为后续 scan 重生成时补录的结构化事实。needs_review=true 因模块归属待定。

## 三重交叉验证

- **声明范围**（design §5 文件变更清单）：scan-drift-check.py + scan-drift.yml + 8 scan docs + local.yaml → 与真实 diff 一致。
- **任务范围**（plan.md task-01~04）：task-01→8 scan docs、task-02→脚本+单测、task-03→workflow、task-04→local.yaml → 一致。
- **真实变更**（worktree diff d31ec53d..HEAD）：11 个文件（剔除 baseline overlay 幽灵）→ 三者一致，以真实 git diff 为准。零产品源码改动属实。

## 影响类型汇总

新增（ci workflow）+ 配置变更（scan 文档刷新）+ 未匹配新增（scripts 工具）。**无逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更**——零产品源码改动，纯 meta/tooling。

## 模块文档同步结果（Step 3 用户确认 = 方案A 最小同步）

| 目标 | 更新内容 | 状态 |
|------|----------|------|
| `_module-map.yaml: ci` | entrypoints 补 `- .github/workflows/scan-drift.yml`（新 CI 入口，结构化事实；scan 下次重生成自然含此行） | ✅ 已写入 |
| `_module-map.yaml: sillyspec` | 不改（8 scan docs 是内部资产刷新，模块边界/依赖/entrypoints 无变化） | ⏭️ 无需 |
| `modules/ci.md`（ci 卡片） | 不改（scan-drift.yml 是纯新增 warn-only 门，不新增对外能力契约/语义） | ⏭️ 无需 |
| `modules/scripts.md`（新模块卡片） | 不建（scripts/ 既有未匹配非本变更引入，避免范围蔓延 + 与 scan 自动生成 churn；留 scan skill 完整生成） | ⏭️ 无需 |
| `_module-map.yaml` generated_at / source_commit | 不手刷（scan skill 自动生成快照属性，手动改会与自动生成不一致 churn；本变更已刷新 8 篇 scan 文档的 source_commit，模块映射的 source_commit 刷新属 scan 重生成范畴） | ⏭️ 无需 |

用户确认状态：方案A（最小同步）经 AskUserQuestion 选中，`--continue --answer` 提交。仅 1 处结构化事实写入（ci.entrypoints），最小 churn、符合 doc-syncer「导出符号变化→更新 entrypoints」规则。

