---
author: qinyi
created_at: 2026-08-06 09:07:53
---

# 提案（Proposal）— scan 文档 drift 检测门

## 背景

SillyHub 文档驱动，scan 文档（`.sillyspec/docs/SillyHub/scan/*.md`，8 篇）是架构/约定/集成的权威描述，被 brainstorm/execute 各阶段加载。scan 由 LLM（sillyspec-scan skill）生成，代码演进后 scan 不自动更新 → 全量过期（实测 `source_commit 6e78b29a` 落后 HEAD `a76f2a75` 共 176 commit）。过期 scan 误导后续变更的上下文加载（行号漂移、已删文件、过时约定）。

multica 对标（[[multica-reference]]）借鉴 #2「source 锚定 + CI drift 检测」。已有同类模式 `gen:types:check`（regenerate + `git diff --exit-code`），但 scan 非确定性，不能 CI 内 regenerate，改用 source-commit 时效 + 文件路径存在性校验。

## 目标

加一个 **warn-only** 的 scan drift 检测门，让 scan 文档漂移在 CI 可见（PR 评论 + GitHub `::warning` 注解），治「反复过期」顽疾；不阻塞 PR（修复需人工 LLM 重跑 scan，CI 内不能自动修）。

## 在范围内（In Scope）

1. `scripts/scan-drift-check.py` 检测脚本：source_commit 时效（落后 HEAD >N commit）+ 文件路径存在性（白名单四端前缀）双信号
2. `.github/workflows/scan-drift.yml`：warn-only CI（exit 0 + `::warning` 注解 + 去重 PR 评论）
3. 前置刷新 scan 文档（重跑 sillyspec scan，source_commit 推到 HEAD + 修失效路径）
4. `.sillyspec/local.yaml` 加 `scan:check` 命令别名
5. 检测脚本自带单元测试

## 不在范围内（Non-Goals）

- **不**在 CI 内自动 regenerate scan 文档（LLM 非确定性 + 需人工判断）
- **不**做强 file:line/符号锚点（方案 C，需改 scan skill + 重生成 8 文档，当前过度工程，留作 A 的后续演进）
- **不**阻塞 PR merge（warn-only；block 留待 warn 验证无效后再升，方案 B）
- **不**改 sillyspec-scan skill 本身（只消费现有 source_commit frontmatter + body 路径）
- **不**校验 scan prose 语义正确性（LLM 文本无法机械校验）
- **不**加 pre-commit hook 集成（CI-only 默认，P2 后续可选）
