---
author: flow-machine-draft
created_at: 2026-10-08T01:59:18.923Z
---
# 需求规格（Requirements）— 2026-10-08-sync-sillyspec-skills-3320

## 功能需求

### FR-01: .claude/.codex/.opencode/.zcode 四镜像目录均有 21 个 sillyspec-* 技能（含 sillyspec-flow），内容与 npm sillyspec@3.32.0 包一致

- 必须：四个工具镜像目录下的 `sillyspec-*` 技能目录集合与内容与 npm `sillyspec@3.32.0` 包内 `.claude/skills/` 的 sillyspec 技能逐字节一致（21 个，含新增 `sillyspec-flow`）；非 sillyspec 技能（banner-design 等）保持不动。

#### 场景：主路径

- Given 仓库四目录当前只有 20 个 sillyspec 技能（v3.29.3 时代快照）
- When 按 CLI 3.32.0 分发源刷新（init 同步 + .zcode 手动补拷）
- Then 四目录 `ls | grep -c sillyspec` 均为 21，且与 `/tmp/ss3320/package/.claude/skills` 逐文件 diff 为空

### FR-02: .zcode/skills/sillyspec-quick/SKILL.md 去掉本地手补的退役横幅段，还原为上游原版

- 必须：`.zcode/skills/sillyspec-quick/SKILL.md` 与上游 3.32.0 包内同名文件逐字节一致；本地手补的「已退役 + thin 用法」横幅段删除（该内容已由正式技能 `sillyspec-flow` 覆盖）。

#### 场景：主路径

- Given .zcode 版本头部多出 31 行本地补丁段
- When 用上游原版覆盖
- Then `diff .zcode/skills/sillyspec-quick/SKILL.md <npm包同名文件>` 为空

### FR-03: AGENTS.md 注入段版本号刷新为 v3.32.0

- 必须：`AGENTS.md` 中 `<!-- SillySpec v...START -->` 注入段由 CLI 3.32.0 重新注入，版本标记为 v3.32.0，段内容与该版 CLI 输出一致；段外正文不被改动。

#### 场景：主路径

- Given 注入段版本停在 v3.29.3
- When 跑 `sillyspec init`（版本感知幂等重入）
- Then 注入段标记为 v3.32.0，`git diff AGENTS.md` 仅注入段内部变化

### FR-04: docs/sillyspec/ 新增活跃坑：init 技能同步映射不含 zcode

- 必须：`docs/sillyspec/` 下新增一篇活跃坑记录（frontmatter 含 title/date/status），说明 `src/init.js` 的 skillToolDirs 只含 claude/codex/openclaw/opencode、不含 zcode 的事实、影响（.zcode/skills 静默失配）与守则（手动补拷）。

#### 场景：主路径

- Given zcode 是 VALID_TOOLS 之一但技能复制映射漏掉它
- When 写入坑文档
- Then 文件存在、status: 活跃，后续上游修复后按惯例移入 finished/

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯文件同步无代码路径，验收以 design「验收命令」节的实跑 diff/计数为准（四目录 vs npm 3.32.0 包逐字节 diff）
FR-02: 不适用：同上，验收 diff 为空即过
FR-03: 不适用：文档版本标记刷新，验收以 git diff 仅含注入段为准
FR-04: 不适用：新增坑文档，验收以文件存在且 status: 活跃为准
