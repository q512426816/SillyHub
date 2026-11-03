---
proposed_at: 2026-11-03T02:05:18.157Z
category: known-issues
source: session-distill:2026-11-03-knowledge-search-hardening
status: pending_review
---

# 时间戳列只配 default 不配 onupdate——同步成功时间恒显示建行时间误导排障

## 问题
KnowledgeSearchState.updated_at 原来只有 default_factory：差量同步成功也不刷新，DB 恒显示建行时间。2026-11-03 知识搜索排障时被该假象误导（以为索引从未同步成功过，浪费排障轮次）。

## 解法
给列补 onupdate（SQLAlchemy 客户端侧刷新器）：不改列 DDL、无需 alembic 迁移，行为仅为「该行 UPDATE 时刷新该列」；与 state 指纹写入同一事务同一 commit，无半态可见；快路径零 UPDATE，不会出现未同步却刷新的假信号。通用规则：一切「最后成功时间」语义的时间戳列必须 default 与 onupdate 成对配置，并配「刷新发生 + 快路径冻结」双向测试断言。

## 证据
- backend/app/modules/knowledge/search.py（onupdate 写法对齐 mcp_registry/model.py 先例）
- backend/app/modules/knowledge/tests/test_knowledge_search.py 新增刷新与快路径冻结用例
- 提交 97e84e47c；验证 12.1s 全绿（.sillyspec/changes/archive/2026-11-03-knowledge-search-hardening/verify-result.md）

## 适用条件
SQLAlchemy 声明式 ORM 的一切 updated_at 类列；凡以 UPDATE 表示状态推进的表都适用。

---
> This is a proposed knowledge entry. Review and merge into manual/ or generated/.