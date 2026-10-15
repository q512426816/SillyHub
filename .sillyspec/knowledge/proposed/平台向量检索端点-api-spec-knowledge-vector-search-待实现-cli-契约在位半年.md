---
proposed_at: 2026-10-15T02:46:41.083Z
category: uncategorized
status: pending_review
---

# 平台向量检索端点 /api/spec/knowledge/vector-search 待实现——CLI 契约在位半年

契约来源：sillyspec 仓 src/knowledge-vector.js 文件头（端点规格+测试夹具即实现规格）：POST {platform.url}/api/spec/knowledge/vector-search，Bearer 鉴权，Body {query, limit}，200 返回 {ok, results:[{spec_path:'knowledge/decisions/x.md', anchor:'D-xxx@vN', change?:变更名, score}]}。现状：CLI 侧 2026-09-29 发布向量召回层（缺省 auto），平台端从未实现（404 实证半个月，2026-10-14 评审探针坐实）；2026-10-15 CLI 契约收紧为显式开启（local.yaml knowledge.vector_search: on 或 env），404 按 URL 进程级死信短路。实现要件（需设计决策）：①embedding 来源（哪个模型/服务算 query 与条目向量）②索引存储（pgvector or 外部）③索引构建管线（knowledge/ 蒸馏件入库时机——daemon spec-sync 汇聚点有现成钩子）④CLI 侧打开开关即恢复、零改动。建议：先出设计变更定 embedding 源，再实现端点+索引管线，最后本仓 local.yaml 开 vector_search: on 双核验（npm test 内 mock 先例在 sillyspec 仓 test/knowledge-vector-recall.test.mjs）。来源：sillyspec 效果评估清偿批 B1（2026-10-15）。

---
> This is a proposed knowledge entry. Review and merge into manual/ or generated/.