---
author: flow-machine-draft
created_at: 2026-10-28T02:46:17.808Z
---
# 设计记录（Design Record）— 2026-10-28-release-record-generator

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：新增 `deploy/scripts/gen-release-record.sh`（与 next-release-seq.sh 同目录同风格，LF、兼容 Git Bash/Linux/macOS），把发布记录生成收口为一个脚本。生成模式流水线：HEAD 短 sha（git rev-parse --short=12）→ seq 复用 `deploy/scripts/next-release-seq.sh`（单一取号源，不重实现）→ 当天序号 NNN（同日期前缀文件最大值+1，三位补零）→ 锚点（扫 docs/releases/*.md frontmatter 取 seq 最大者的 commit_to，无记录 null）→ commits 列表（git log <锚>..HEAD，null 锚时 -20，message 引号转义）→ 组装 frontmatter（成对 `---`）+ 正文骨架（🆕/🔧/⚡/📝 四段占位）→ 写临时文件自检（`---` 计数=2、8 字段逐项在场）→ mv 到位。`--dry-run` 只打印预览不落盘；`--validate [--dir X]` 扫描既有文件报坏件；生成成功输出末尾打印三段防漏指引（scp 同步/提交 pathspec/backup tag）。

选 bash 脚本而非 python/node 的理由：deploy/scripts 现有惯例全是 bash（build-and-save/load-and-up/next-release-seq），部署域调用零新依赖；选「写临时文件自检后 mv」而非「直接写后校验删除」：临时文件由 mktemp 建在目标目录内（隐藏文件 `.gen-release.*`），自检失败即 rm、中断最坏残留隐藏临时件——无 .md 后缀，平台扫描与 --validate 均不受影响，目标目录不出现可见半成品。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：新增命令 `bash deploy/scripts/gen-release-record.sh [--summary "<一句概括>"] [--status success|failed] [--commit-from <sha|null>] [--agent <id>] [--dir <目标目录>] [--dry-run] [--validate]`；无 HTTP 端点/数据格式变化。生成产物的 frontmatter 格式契约不变（与既有 62 条同构：成对 `---` + 8 字段）；`--validate` 以退出码（0 全绿 / 1 有坏件）作脚本间调用契约。deploy-to-server skill 发布记录节补一句「推荐用生成器」（手工口径保留为备选）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

答：成立。seq/NNN/锚点全部在生成瞬间从当前文件面计算，无跨调用状态；两会话同时生成会算出相同 seq/NNN——与现状（手工取号）同风险面，由「同一时间只有一个部署收尾」的既有惯例兜底，脚本不引入新竞争面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

答：目标文件名含当天序号+HEAD sha，碰撞即后写覆盖同内容；临时文件自检+mv 原子落位，目标目录不会出现半成品。--validate 只读不写，无并发写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

答：安全。临时文件写失败/自检失败路径都 rm 后退出，目标目录无残留；--dry-run 全程不碰文件系统（读 git 与 docs/releases 只读）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

答：不会。脚本锚定仓库根的 docs/releases（seq 全局语义随仓），--dir 仅改变校验/生成的目标目录用于沙箱；不触平台 DB、不触服务器。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险是脚本生成的 frontmatter 与平台解析器实际口径仍有隐性偏差（YAML 方言、字段类型）——对策：生成后自检 + 沙箱产物对照平台口径逐字段核对（task-03），并以 seq48（claude-code 手写、平台判 valid）作对照样本。

放弃方案：
- A（脚本内自算 seq）：next-release-seq.sh 是 2026-10-18 固化的单一取号源，双实现必漂移——放弃，改为调用。
- B（走 API 取锚点）：生产 token 不可用（bootstrap 密码失配 401），且 skill 明文「不可达则看本地记录」——放弃 API 路径，本地文件推导为准。
- C（生成器直接 scp 同步服务器）：同步属部署收尾动作、依赖 ssh key 与时机，塞进生成器会让「写记录」与「部署收尾」耦合（本地流程也会被迫碰 ssh）——放弃，生成器只打印指引，同步仍由 deploy-to-server 流程执行。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | deploy/scripts/gen-release-record.sh | 发布记录生成器（生成/dry-run/validate 三模式+防漏指引输出） |
| 修改 | .zcode/skills/deploy-to-server/SKILL.md | 发布记录节推荐用生成器（手工口径保留为备选） |
| 修改 | .zcode/skills/sillyhub-docker-deploy/SKILL.md | 发布记录节提及生成器可消除格式/取号手工错 |
