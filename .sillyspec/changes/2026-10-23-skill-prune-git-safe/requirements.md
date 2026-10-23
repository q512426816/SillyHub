---
author: flow-machine-draft
created_at: 2026-10-23T06:01:11.085Z
---
# 需求规格（Requirements）— 2026-10-23-skill-prune-git-safe

## 功能需求

### FR-01: git 跟踪的技能目录一律不删除

- pruneSkillsToSubset **禁止**删除「`git ls-files`（以 workDir 为 cwd）命中的 `.claude/skills/<名>` 目录」——即使该目录不在本会话 skillRefs 清单中。

#### 场景：git 仓正式技能被保护

- Given workDir 为 git 仓且 `.claude/skills/brand` 被 git 跟踪、本会话 skillRefs 仅含 `sillyspec-flow`，When 执行 pruneSkillsToSubset，Then `brand` 目录及其文件原样保留。

### FR-02: daemon 管理的未跟踪副本仍被裁剪

- 对「不在 skillRefs、目录名属于 skillsDir() 一级目录清单、且未被 git 跟踪」的技能目录，pruneSkillsToSubset **必须**递归删除（与旧行为一致，裁剪功能对非 git 场景不失效）。

#### 场景：非 git 工作目录裁剪 daemon 副本

- Given workDir 非 git 仓、`.claude/skills/beta` 为 daemon link 副本（skillsDir() 下存在同名技能）、skillRefs 不含 `beta`，When 执行 pruneSkillsToSubset，Then `beta` 目录被删除。

### FR-03: 非 git 仓工作目录仅删 daemon 库目录

- workDir 非 git 仓（或 git 跟踪信息不可得）时，pruneSkillsToSubset **必须**只删除「目录名属于 daemon 技能库清单」的目录；用户自建目录（daemon 库中不存在同名技能）**禁止**删除。

#### 场景：用户自建目录被保护

- Given workDir 非 git 仓、`.claude/skills/gamma` 为用户手工创建（skillsDir() 下无同名技能）、skillRefs 不含 `gamma`，When 执行 pruneSkillsToSubset，Then `gamma` 目录保留。

### FR-04: 删除条件收敛为三重与

- 目录删除 **必须** 同时满足三个条件：不在 skillRefs ∧ 目录名在 daemon 技能库清单 ∧ 非 git 跟踪；任一条件不满足 **必须** 保留该目录，并对被保护跳过的目录打 `prune_skill_kept` info 日志（含保留原因 tracked/unmanaged）。

#### 场景：三重与边界

- Given `.claude/skills/` 下同时存在 keep 命中目录、非 daemon 库目录、git 跟踪目录（均不在 skillRefs 的按各条件打破），When 执行 pruneSkillsToSubset，Then 三者全部保留且日志可见保留原因；仅「不在 keep ∧ 在 daemon 库 ∧ 非跟踪」目录被删除。

#### 场景：git 跟踪信息不可得时降级安全

- Given `git ls-files` 执行失败/超时/非 git 仓（跟踪信息为 null），When 执行 pruneSkillsToSubset，Then 删除面仍受 daemon 库清单约束（不放大到旧逻辑之上），git 仓保护退化为不可用但 managed 保护恒在场。

### FR-05: 触及面测试与类型零错

- 本变更触及的 vitest 用例 **必须** 全部通过；`pnpm -C sillyhub-daemon exec tsc --noEmit` **必须** 零类型错误。

#### 场景：验收门

- When 运行触及面 vitest 与 tsc --noEmit，Then 全部通过、零错误。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/skill-manager.test.ts「pruneSkillsToSubset: git 跟踪目录即使不在 skillRefs 也保留」
FR-02: sillyhub-daemon/tests/skill-manager.test.ts「pruneSkillsToSubset: daemon 库未跟踪副本不在 skillRefs 时被裁剪」
FR-03: sillyhub-daemon/tests/skill-manager.test.ts「pruneSkillsToSubset: 非 git 目录仅删 daemon 库技能,用户自建目录保留」
FR-04: sillyhub-daemon/tests/skill-manager.test.ts「pruneSkillsToSubset: 三重与边界与保留原因日志」+ sillyhub-daemon/tests/skill-manager.test.ts「pruneSkillsToSubset: git ls-files 失败按无跟踪信息降级」
FR-05: sillyhub-daemon/tests/skill-manager.test.ts（触及面 describe 全绿）+ pnpm -C sillyhub-daemon exec tsc --noEmit 零类型错误
