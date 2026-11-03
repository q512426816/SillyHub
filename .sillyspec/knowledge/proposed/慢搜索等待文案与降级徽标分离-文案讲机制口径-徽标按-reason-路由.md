---
proposed_at: 2026-11-03T02:05:18.436Z
category: patterns
source: session-distill:2026-11-03-knowledge-search-hardening
status: pending_review
---

# 慢搜索等待文案与降级徽标分离——文案讲机制口径、徽标按 reason 路由

## 问题
知识搜索页在每次慢搜索都显示「首次搜索需建立索引」等待文案——实际慢搜索多数是增量同步而非首次建索引，文案制造错误归因；降级徽标对 index_not_built 场景的提示也不准确（该 reason 来自 2026-10-19-knowledge-search-build-switch 的禁建库开关，语义是索引未预建而非模型不可用）。

## 解法
等待文案改「增量同步」机制口径：描述正在发生什么，不对首次/非首次下断言。降级徽标用后端结构化 reason 路由文案：model_ready=false 且 reason=index_not_built 提示索引未预建，其余 reason 提示模型不可用。可复用模式：慢路径文案描述机制，降级态文案由结构化 reason 驱动，前端不猜场景、不在文案里写死机制断言。

## 证据
- frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx（两处文案字符串）
- 提交 97e84e47c；纯前端文案按约定未写测试（记不适用，验收靠规范与人工）

## 适用条件
一切带慢路径与降级态的搜索、同步、生成类前端功能。

---
> This is a proposed knowledge entry. Review and merge into manual/ or generated/.