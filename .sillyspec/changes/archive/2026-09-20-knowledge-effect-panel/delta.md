---
generated_at: 2026-09-22T17:28:34.399Z
sources_reconcile: 未命中（apply-pathspec 兜底，28 项）
sources_verify_facts: 缺失
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-20-knowledge-effect-panel

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：.sillyspec/docs/SillyHub/modules/frontend_components.md、.sillyspec/docs/backend/modules/knowledge.md、.sillyspec/docs/sillyhub-daemon/modules/client.md、.sillyspec/docs/sillyhub-daemon/modules/spec-sync.md、backend/app/modules/knowledge/hits.py、backend/app/modules/knowledge/parser.py、backend/app/modules/knowledge/router.py、backend/app/modules/knowledge/schema.py、backend/app/modules/knowledge/service.py、backend/app/modules/knowledge/tests/test_hits.py、backend/app/modules/knowledge/tests/test_parser.py、backend/app/modules/knowledge/tests/test_router.py、backend/conftest.py、backend/migrations/versions/20260920220000_create_knowledge_hits.py、backend/openapi.json、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx、frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx、frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx、frontend/src/components/knowledge/entry-card-list.tsx、frontend/src/components/knowledge/ops-dashboard.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/knowledge.ts、sillyhub-daemon/src/hub-client.ts、sillyhub-daemon/src/knowledge-hits-upload.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/hub-client.test.ts、sillyhub-daemon/tests/knowledge-hits-upload.test.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 9 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

（无 reconcile 产物（变更先于 P3a 或 verify 未落盘），清单取 apply-pathspec——文件级，无 missing/undeclared 差集）

| 交付文件 | 模块归属 |
|---|---|
| .sillyspec/docs/SillyHub/modules/frontend_components.md | —（未匹配） |
| .sillyspec/docs/backend/modules/knowledge.md | —（未匹配） |
| .sillyspec/docs/sillyhub-daemon/modules/client.md | —（未匹配） |
| .sillyspec/docs/sillyhub-daemon/modules/spec-sync.md | —（未匹配） |
| backend/app/modules/knowledge/hits.py | —（未匹配） |
| backend/app/modules/knowledge/parser.py | —（未匹配） |
| backend/app/modules/knowledge/router.py | —（未匹配） |
| backend/app/modules/knowledge/schema.py | —（未匹配） |
| backend/app/modules/knowledge/service.py | —（未匹配） |
| backend/app/modules/knowledge/tests/test_hits.py | —（未匹配） |
| backend/app/modules/knowledge/tests/test_parser.py | —（未匹配） |
| backend/app/modules/knowledge/tests/test_router.py | —（未匹配） |
| backend/conftest.py | —（未匹配） |
| backend/migrations/versions/20260920220000_create_knowledge_hits.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | —（未匹配） |
| frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx | —（未匹配） |
| frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | —（未匹配） |
| frontend/src/components/knowledge/entry-card-list.tsx | —（未匹配） |
| frontend/src/components/knowledge/ops-dashboard.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| frontend/src/lib/knowledge.ts | —（未匹配） |
| sillyhub-daemon/src/hub-client.ts | —（未匹配） |
| sillyhub-daemon/src/knowledge-hits-upload.ts | —（未匹配） |
| sillyhub-daemon/src/spec-sync.ts | —（未匹配） |
| sillyhub-daemon/tests/hub-client.test.ts | —（未匹配） |
| sillyhub-daemon/tests/knowledge-hits-upload.test.ts | —（未匹配） |

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | （未填写） |
| D-002@v3 | （未填写） |
| D-003@v1 | （未填写） |
| D-004@v2 | （未填写） |
| D-005@v1 | （未填写） |
| D-006@v2 | （未填写） |
| D-007@v1 | （未填写） |
| D-008@v3 | （未填写） |
| D-009@v1 | （未填写） |

### 探针 metrics 摘要（验证结论表的机器半边）

（无 verify-facts.json：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\changes\2026-09-20-knowledge-effect-panel\verify-facts.json 不存在或不可解析——探针指标快照缺位，可跑 sillyspec verify-probes --change 2026-09-20-knowledge-effect-panel --init 补）

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `backend/modules/knowledge.md` | 补 hits 第三面：knowledge_hits 表（uq 幂等）+ POST hits/batch / GET stats 两端点（六型白名单宽容外型、使用计数 {inject,fr-inject}、per_task 次任务归一口径+%两档显示、slug 双端归一、daemon_local_id）+ parse_knowledge_entries 条目全集 + list 透传 use_count + 运营四指标口径（task-07） | done |
| `sillyhub-daemon/modules/spec-sync.md` | 补 hits 上报 best-effort 钩子（postSpecSync 成功汇聚点+独立 try/catch R-05）、`~/.sillyhub/daemon/.hits-upload-state-{wsId}.json` offset 状态文件、≤2000 行分批（R-06）、完整行断点（R-01）语义（task-07） | done |
| `sillyhub-daemon/modules/client.md` | spec 同步方法面补 postKnowledgeHitsBatch（URL/body 契约+daemon_local_id 取 runtime_id+返回三计数）（task-07） | done |
| `SillyHub/modules/frontend_components.md` | 知识域条目追加 ops-dashboard（四指标卡/内嵌死条目清单/使用率榜 % 两档格式 formatPerTaskPct/三态/knowledgeStatsQueryKey 导出）与 entry-card-list（四形态分发/slugifyAnchor 双端归一/防复潮/superseded 折叠/entryCounts 降级）一行式紧凑增量（task-07） | done |
| `_module-map.yaml` | 无需增改：新文件 `sillyhub-daemon/src/knowledge-hits-upload.ts` 未入 map paths，但其语义已并卡（spec-sync 上报钩子 + client postKnowledgeHitsBatch），模块索引 rebuild 留待下次全量扫描 | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：.sillyspec/docs/SillyHub/modules/frontend_components.md、.sillyspec/docs/backend/modules/knowledge.md、.sillyspec/docs/sillyhub-daemon/modules/client.md、.sillyspec/docs/sillyhub-daemon/modules/spec-sync.md、backend/app/modules/knowledge/hits.py、backend/app/modules/knowledge/parser.py、backend/app/modules/knowledge/router.py、backend/app/modules/knowledge/schema.py、backend/app/modules/knowledge/service.py、backend/app/modules/knowledge/tests/test_hits.py、backend/app/modules/knowledge/tests/test_parser.py、backend/app/modules/knowledge/tests/test_router.py、backend/conftest.py、backend/migrations/versions/20260920220000_create_knowledge_hits.py、backend/openapi.json、frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx、frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx、frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx、frontend/src/components/knowledge/entry-card-list.tsx、frontend/src/components/knowledge/ops-dashboard.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/knowledge.ts、sillyhub-daemon/src/hub-client.ts、sillyhub-daemon/src/knowledge-hits-upload.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/hub-client.test.ts、sillyhub-daemon/tests/knowledge-hits-upload.test.ts
