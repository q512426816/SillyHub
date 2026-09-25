---
author: qinyi
created_at: 2026-09-25 10:15:00
change: 2026-09-25-change-precipitated-assets
---

# 决策记录（Decisions）

## D-001@v1: 数据流=服务端聚合端点（方案 a），thin+brainstorm 跑法（用户裁决）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 变更详情展示沉淀资产（FR/决策/测试绑定/patch/delta）的数据通路走哪条？变更流程跑法？
- answer: 用户前轮方案对比后裁决「好，做」选定方案 a——后端新增聚合端点按变更名解析 spec 树镜像（knowledge/fr/*.md 与 knowledge/decisions/*.md 的「变更：」行过滤 + 归档目录 test-trace.json/change-patch.json/delta.md 容错读取），前端观测事件卡同构折叠卡；并裁决本变更走「轻量变更+头脑风暴预段」（原话：好，做，第二个变更走轻量变更附加头脑风暴）。b（CLI 命令：tests 无 --json/derive 无对应 facet/decisions list 只读 active）与 c（前端自行解析：全量拉 60+ 域文件 N+1 + CLI 机械解析契约前端化双端漂移）经两子代理核对证伪排除。
- normalized_requirement: 后端 GET /workspaces/{ws}/changes/{cid}/assets 单端点聚合；解析只认「变更：<名>」行与固定文件名，不改 CLI 产物格式；change.patch/change-patch.json 按「文件存在才展示」容错；前端只读折叠卡失败静默隐藏。
- impacts: [FR-01, FR-02, FR-03, FR-04]
- evidence: 用户裁决轮（本会话，2026-09-25）；两子代理核对报告（资产数据面/两页面）；backend/app/modules/knowledge/service.py:30-46（镜像根先例）；frontend/src/components/changes/detail/change-events-card.tsx（样式先例）
- 模块域: backend, frontend
- 故障面: 解析契约与 CLI 演进漂移——「变更：」行格式属 CLI 机械契约，上游改格式需同步本解析（加版本容错与未知行跳过）。
- 退役判据: 若平台后续引入结构化资产表（CLI 直推 DB），本解析层可退役改读表。
