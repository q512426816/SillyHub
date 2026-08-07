---
author: qinyi
created_at: 2026-08-06 09:07:53
---

# 需求（Requirements）— scan 文档 drift 检测门

## 功能需求

### FR-01 · source_commit 时效检测（覆盖 D-001）
`scan-drift-check.py` 读每篇 scan 文档 frontmatter `source_commit`，用 `git rev-list --count <source_commit>..HEAD` 算落后 commit 数；**>N（默认 50，env `SCAN_DRIFT_COMMIT_THRESHOLD` 可配）报漂移**。source_commit 缺失 / 非 HEAD 祖先（被 rebase 掉）按漂移处理（不崩）。
- 验收：落后 >N commit 时报漂移；N 可经 env 调；source_commit 无效时不崩、按漂移报。

### FR-02 · 文件路径存在性校验（覆盖 D-001）
正则提取 scan 文档 body 的 `(backend|frontend|sillyhub-daemon|deploy)/...` 路径（白名单四端前缀 + 完整扩展名 .py/.ts/.tsx/.mjs/.js/.json/.yaml/.yml/.md；带行号 `file.py:123` 剥行号校验文件，目录路径 `isdir` 也认），逐个 `os.path.exists` 校验，缺失报漂移（列文档 + 路径）。
- 验收：引用已删/改名文件时报漂移；白名单外/示例路径不报。

### FR-03 · warn-only CI 上报（覆盖 D-002）
`.github/workflows/scan-drift.yml` 在 PR（改 .sillyspec/docs 或三端源码时）/push(main) 触发跑脚本；漂移时 **exit 0**（不 fail job、不阻塞 merge）+ 输出 GitHub `::warning file=<doc>::<msg>` 注解 + `actions/github-script` 发**去重** PR 评论汇总（「scan 文档漂移：X 篇落后 / Y 条失效路径，重跑 sillyspec scan」）。
- 验收：漂移时 PR 有 warning 注解 + 去重评论；CI job 不 fail。

### FR-04 · 本地可跑
`python scripts/scan-drift-check.py`（仓库根）输出人类可读报告，不依赖 CI 环境（仅需 git + Python 3.12）。
- 验收：本地跑输出漂移项列表；无 CI 特定依赖。

### FR-05 · 前置刷新 scan 文档（覆盖 D-003）
加门前重跑 `sillyspec scan` 把 8 篇 scan 文档 source_commit 推到当前 HEAD，顺带修失效文件路径引用；刷新后脚本在该文档集自测 0 漂移。
- 验收：刷新后 scan 文档 source_commit = 当前 HEAD；脚本在该文档集 0 漂移。

### FR-06 · local.yaml scan:check 别名
`.sillyspec/local.yaml` commands 加 `scan:check: python scripts/scan-drift-check.py`。
- 验收：local.yaml 含 scan:check 命令。

### FR-07 · 跨平台兼容（CLAUDE.md 规则 13）
脚本 + workflow 在 Windows/Linux/macOS 通用；CI 跑 ubuntu-latest；无平台特定路径/命令。
- 验收：本地 Windows 可跑；workflow 无硬编码平台路径。

## 非功能需求

### NFR-01 · 低噪声
warn-only + 去重 PR 评论；初版阈值 N=50 可调大降噪声（应对 R-01 warn 被忽视 / R-02 正则误报）。

## 决策覆盖

- **D-001@v1**（双信号：时效 + 文件路径）→ FR-01, FR-02
- **D-002@v1**（warn-only 不阻塞 PR，方案 A）→ FR-03
- **D-003@v1**（加门前先刷新 scan 文档）→ FR-05

全部当前版本决策（D-001/D-002/D-003）已覆盖，无剩余未覆盖决策。
