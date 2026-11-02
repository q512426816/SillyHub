---
author: flow-machine-draft
created_at: 2026-11-02T01:03:44.470Z
---
# 任务注册表（Tasks）— 2026-11-02-embed-batch-chunk

- [x] task-01: 先写测试——test_vector_search.py 新增 `test_index_rebuild_embeds_in_batches`（150 条语料断言批上限 ≤32/顺序聚合/查询独立成批/小语料单批），FakeEmbedder 增批形状记录；验证：新测试对旧实现红（批形状断言失败）。
- [x] task-02: 实现——vector_search.py 加 `_EMBED_BATCH_SIZE=32`（64→32 经生产 A/B 定档）+ `_embed_corpus`，`search_sync` 索引重建改分批；验证：新测试绿，既有 vector_search 测试零改动通过。
- [x] task-03: 测试面 + lint——knowledge 模块测试全绿、ruff/format 零告警；验证：pytest + ruff 命令输出。
- [x] task-04: 生产部署与实测验证——main 主线打包部署腾讯云（deploy-to-server skill 流程），部署后生产触发一次向量搜索强制索引重建，docker stats/dmesg 确认 worker RSS 受控无 OOM；验证：health commit_sha 一致 + 无新 OOM 记录。
