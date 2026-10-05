---
author: flow-machine-draft
created_at: 2026-10-05T13:54:06.851Z
---
# 提案书（Proposal）— 2026-10-05-remove-promo-film

## 动机

任务原话转写：删除本会话生成的 SillyHub 宣传片交付物：用户明确表示不需要生成的宣传影片。删除 docs/promo 整目录（v2/index.html、v2/assets/ 28 张截图、v1 sillyhub-promo.html、README.md），并同步移除 docs 模块文档中的宣传物料条目；SillySpec 归档件保留为过程审计记录。
成功标准：
- docs/promo 目录整体从仓库删除（git rm 显式 pathspec，历史可恢复）
- .sillyspec/docs/multi-agent-platform/modules/docs.md 中 promo 条目移除
- 删除后仓库无悬空引用（README/模块文档不再指向 docs/promo）

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. docs/promo 目录整体从仓库删除（git rm 显式 pathspec，历史可恢复）
2. .sillyspec/docs/multi-agent-platform/modules/docs.md 中 promo 条目移除
3. 删除后仓库无悬空引用（README/模块文档不再指向 docs/promo）

## 成功标准（可验证）

1. docs/promo 目录整体从仓库删除（git rm 显式 pathspec，历史可恢复）
2. .sillyspec/docs/multi-agent-platform/modules/docs.md 中 promo 条目移除
3. 删除后仓库无悬空引用（README/模块文档不再指向 docs/promo）
