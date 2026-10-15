---
author: qinyi
created_at: 2026-10-15 16:06:28
---
# 任务清单（Tasks）— 2026-10-15-platform-knowledge-search

- [ ] task-01: 后端检索服务 NEW:backend/app/modules/knowledge/search.py——语料扫描（knowledge/ + docs/，排 INDEX.md）+ 三档切块（decisions 条目/fr 条目/标题块+超长滑窗）+ kind 派生 + 懒索引（全语料指纹失效，独立于 CLI 索引）+ 词面/向量融合打分（精确命中保底）+ snippet 提取；配纯函数单测 NEW:backend/app/modules/knowledge/tests/test_knowledge_search.py
- [ ] task-02: 端点 POST /api/workspaces/{workspace_id}/knowledge/search——schema（KnowledgeSearchIn/ResultItem/Out）+ router 声明序（在 GET /knowledge/{filename:path} 之前）+ KNOWLEDGE_READ 门控 + SCAN_DOCS_READ 结果过滤（3×limit 候选）+ run_in_threadpool 卸载；配端点测试（鉴权 403/404、过滤、降级、响应形态）backend/app/modules/knowledge/tests/test_router.py
- [ ] task-03: 前端知识库页搜索——frontend/src/lib/knowledge.ts 增 searchKnowledge（POST + timeoutMs 120s）+ 生成类型别名；frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx 左栏搜索框（debounce 300ms）+ 结果列表替换树（徽章/标题/路径/片段高亮/匹配度）+ 点击跳转（knowledge 类 router.push ?file=&anchor= URL 深链、URL 已等值时直调 selectEntry（同 key 重选边界）；docs 类 router.push scan-docs?path=）+ 降级提示条；配测试 frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx（含同 key 重选场景）
- [ ] task-04: scan-docs 页 ?path= 深链——frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx useSearchParams 读取 + 列表就绪后选中目标文档 + 消费一次守门 + 查无静默；配测试 frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
- [ ] task-05: 类型生成与收口——pnpm gen:types（frontend）+ pnpm -C sillyhub-daemon gen:types（规则 21 双端义务），提交 backend/openapi.json + 两端 api-types.ts；跑相关测试（后端 knowledge 模块 + 前端知识库/scan-docs 页）全绿；实测首查索引构建耗时（R-01）与融合排序抽验（R-03）并回填文档
