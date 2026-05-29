---
author: qinyi
created_at: 2026-05-29 17:34:40
---

# Design

## 架构决策

### ADR-01: Metadata DB 是知识本体

知识的状态、范围、来源、审核和权限保存在数据库。Markdown 内容可以作为正文载体，但不是唯一索引。

### ADR-02: AI 只能生成 candidate

AgentRun 产物、审查意见、测试失败总结可以生成 candidate，但 confirmed 以上状态必须人工或规则化 reviewer 确认。

### ADR-03: 向量索引后置

向量索引只保存可重建 embedding 和 item id，不能决定知识是否有效。

## 数据模型

- `knowledge_items`：正式知识条目。
- `knowledge_candidates`：候选知识。
- `knowledge_reviews`：审核记录。
- `knowledge_sources`：来源 task/run/workspace/change。
- `knowledge_embeddings`：可重建检索索引。

## API 设计

- `POST /api/knowledge/candidates`
- `GET /api/workspaces/{id}/knowledge/candidates`
- `POST /api/knowledge/candidates/{id}/confirm`
- `POST /api/knowledge/items/{id}/verify`
- `POST /api/knowledge/items/{id}/promote`
- `POST /api/knowledge/items/{id}/deprecate`
- `GET /api/workspaces/{id}/knowledge`

## 文件变更清单

- `backend/app/modules/knowledge/model.py`
- `backend/app/modules/knowledge/schema.py`
- `backend/app/modules/knowledge/service.py`
- `backend/app/modules/knowledge/router.py`
- `backend/app/modules/knowledge/tests/`
- `frontend/src/lib/knowledge.ts`
- `frontend/src/app/(dashboard)/workspaces/[id]/knowledge/`

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| candidate 太多 | Reviewer 负担重 | 合并相似候选、按来源筛选 |
| 错误知识被推广 | 污染团队资产 | promoted 前必须有验证记录 |
| 向量索引过早复杂化 | 实现拖慢 | 先 DB 筛选，embedding 后置 |
