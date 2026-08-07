---
author: qinyi
created_at: 2026-08-06 14:02:45
plan_level: light
---

# 轻量计划（Light Plan）：scan 文档 drift 检测门

## 来源

直接引用 brainstorm 四件套结论，不重新扩写：design.md §4（方案 A · warn-only · 双信号检测）、§5 文件变更清单、decisions.md D-001/002/003@v1、requirements.md FR-01~07 + NFR-01。

## 范围

- 新增 `scripts/scan-drift-check.py`（双信号检测脚本：source_commit 时效 + 文件路径存在性；warn 注解 + 人类可读输出）
- 新增 `scripts/` 下单元测试（覆盖 parse_source_commit / commits_behind / extract_file_refs / check_drift 核心函数；具体路径 task-02 卡片定）
- 新增 `.github/workflows/scan-drift.yml`（warn-only CI：exit 0 + `::warning` 注解 + 去重 PR 评论）
- 修改 `.sillyspec/local.yaml`（commands 加 `scan:check` 别名）
- 修改 `.sillyspec/docs/SillyHub/scan/*.md`（8 篇：刷新 source_commit 到当前 HEAD + 修失效文件路径引用）
- 模块：ci + sillyspec + 根 scripts/

## Tasks

- [x] task-01: 刷新 scan 文档（重跑 sillyspec scan，source_commit 推到**执行时当前 HEAD**（非 brainstorm 时旧值 a76f2a75），顺带修失效文件路径引用）（覆盖：FR-05, D-003@v1）
- [x] task-02: `scripts/scan-drift-check.py` 检测脚本（source_commit 时效 + 文件路径存在性双信号；`::warning` 注解 + 人类可读输出）+ 单元测试（覆盖：FR-01, FR-02, FR-04, FR-07, D-001@v1）—— 依赖 task-01 存在（自测基准）
- [x] task-03: `.github/workflows/scan-drift.yml` CI workflow（warn-only exit 0 + `::warning` 注解 + 去重 PR 评论汇总）（覆盖：FR-03, D-002@v1）—— 依赖 task-01 存在
- [x] task-04: `.sillyspec/local.yaml` 加 `scan:check` 命令别名 + 收尾自测（刷新后脚本在 scan 文档集 0 漂移）（覆盖：FR-06）—— 依赖 task-01/02 存在

## 验收

- AC-01：落后 >N commit（默认 50，env `SCAN_DRIFT_COMMIT_THRESHOLD` 可配）报漂移；source_commit 缺失 / 非 HEAD 祖先（被 rebase 掉）不崩、按漂移报（FR-01）
- AC-02：文件路径正则（白名单四端前缀 backend/frontend/sillyhub-daemon/deploy + 完整扩展名 + 剥行号 + 目录路径 isdir 也认）引用已删/改名文件时报漂移；白名单外 / 示例 / 截断路径（如 `package.js`）不报（FR-02，R-02 误报率 execute 实测调参）
- AC-03：scan-drift.yml 漂移时 **exit 0**（不 fail job、不阻塞 merge）+ GitHub `::warning file=<doc>::<msg>` 注解 + `actions/github-script` 去重 PR 评论汇总（FR-03）
- AC-04：`python scripts/scan-drift-check.py` 仓库根本地可跑，输出人类可读，不依赖 CI 环境（仅需 git + Python 3.12）（FR-04）
- AC-05：task-01 刷新后 8 篇 scan 文档 `source_commit` = 执行时当前 HEAD；脚本在该文档集自测 **0 漂移**（FR-05）
- AC-06：`.sillyspec/local.yaml` commands 含 `scan:check: python scripts/scan-drift-check.py`（FR-06）
- AC-07：脚本 + workflow 跨平台（Windows/Linux/macOS）通用；CI 跑 ubuntu-latest；无平台特定路径 / 命令（FR-07，CLAUDE.md 规则 13）
- AC-08：task-02 单元测试覆盖四个核心函数（parse_source_commit / commits_behind / extract_file_refs / check_drift）的关键分支

## 覆盖矩阵

| ID | 决策摘要 | 覆盖任务 | 验收证据 |
|---|---|---|---|
| D-001@v1 | drift 信号 = 时效 + 文件路径（双信号） | task-02 | AC-01, AC-02, AC-08 |
| D-002@v1 | warn-only 不阻塞 PR（方案 A） | task-03 | AC-03 |
| D-003@v1 | 加门前先刷新 scan 文档 | task-01 | AC-05 |
