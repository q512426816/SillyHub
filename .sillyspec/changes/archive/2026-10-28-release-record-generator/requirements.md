---
author: flow-machine-draft
created_at: 2026-10-28T02:46:17.808Z
---
# 需求规格（Requirements）— 2026-10-28-release-record-generator

## 功能需求

### FR-01: 脚本执行后产出 docs/releases/YYYY-MM-DD-<当天序号>-<HEAD短sha>.md，frontmatter 成对 --- 标记 + 8 字段齐备，seq 取自 deploy/scripts/next-release-seq.sh（全局序号），平台解析口径可判 valid

- 生成模式必须产出 `docs/releases/YYYY-MM-DD-<NNN>-<HEAD 12 位短 sha>.md`（NNN 为当天三位序号），frontmatter 必须含成对 `---` 标记与 8 字段（seq/deployed_at/status/commit_from/commit_to/summary/agent/commits）；seq 必须取自 `deploy/scripts/next-release-seq.sh` 输出，禁止脚本内自算全局序号；产出的 frontmatter 必须满足平台解析口径（可判 valid 非 invalid）。

#### 场景：主路径

- Given 仓库 docs/releases 已有 seq 1..49 的记录、HEAD=7840a3a9db
- When 以 `--dry-run` 执行生成模式
- Then 打印的 frontmatter 预览含成对 `---`、`seq: 50`、`commit_to: 7840a3a9db`、8 字段齐备，且不落盘

### FR-02: commit_from 锚点自动取本地最大 seq 记录的 commit_to（无记录写 null），调用方无需手工提供

- commit_from 必须由脚本从本地 `docs/releases/*.md` 中 seq 最大记录的 frontmatter `commit_to` 自动推导；docs/releases 无记录时必须写 `null`；禁止要求调用方手工传锚点（`--commit-from` 仅作显式覆盖）。

#### 场景：主路径

- Given docs/releases 最大 seq 记录为 seq49（commit_to=ce842447d）
- When 生成模式解析锚点
- Then commit_from=ce842447d（取自该记录 frontmatter，非调用方输入）

### FR-03: 生成后自检失败即非零退出不落半成品；--validate 模式扫描既有记录报告坏文件（支持 --dir 指定目录便于沙箱验证）

- 生成写入前必须对完整内容自检（`---` 恰成对出现 2 次、8 字段逐项在场），自检失败必须非零退出且不在目标目录留下任何文件；`--validate` 必须扫描目标目录全部 `*.md` 并逐文件报告 frontmatter 坏件（缺闭合标记/缺必填字段），存在坏件时退出码 1；目标目录必须可用 `--dir` 覆盖（默认 `docs/releases`）以便沙箱验证。

#### 场景：坏件检出

- Given 沙箱目录含一份只有开头 `---` 的记录文件（历史事故形态）
- When 执行 `--validate --dir <沙箱>`
- Then 输出点名该坏文件与原因，退出码 1

### FR-04: 输出末尾打印镜像目录同步 scp 命令与提交 pathspec 提醒（防漏同步步骤）

- 生成模式成功后，输出末尾必须打印：①生产镜像目录同步 scp 命令（目标 `/opt/sillyhub/repos/multi-agent-platform/docs/releases/`）；②本记录文件的显式 pathspec 提交命令；③backup tag 惯例提醒。指引缺失视为不合规产出。

#### 场景：主路径

- When 生成模式（含 --dry-run）执行完成
- Then 输出末尾三段指引齐备（scp 同步/pathspec 提交/backup tag）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：仓库无 bash 测试框架，验证=沙箱实跑脚本（dry-run 预览 + 沙箱真实生成 + 平台解析口径字段逐项核对，见 task-03）
FR-02: 不适用：同上无 bash 测试面，验证=沙箱实跑断言锚点推导值（见 task-03）
FR-03: 不适用：同上，验证=坏件 fixture 检出 + 生成自检断言（task-02/03）
FR-04: 不适用：同上，验证=输出包含三段指引的实跑断言（task-03）
