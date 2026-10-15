---
author: qinyi
created_at: 2026-10-15 15:59:42
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
知识库页目前只有文件树浏览 + 单文件查看，用户找一个概念（如「鉴权 token 分轨」「会话状态点」）只能靠记忆逐目录翻文件。spec 树沉淀的四类知识资产——知识手册（knowledge/ 顶层 conventions/patterns/known-issues）、需求规格（knowledge/fr/）、决策库（knowledge/decisions/）、模块文档（docs/<project>/modules/ 等）——都以 md 存在且已同步到平台侧，具备就地建检索的全部原料；sillyspec CLI 侧已用平台向量端点做决策召回（2026-10-15-platform-vector-search），证明「fastembed 本地小模型 + 进程内懒索引」在平台侧可行。本变更把该能力延伸到平台用户侧：一个覆盖四类资产的搜索入口，让用户用自然语言或精确词找到内容并直接跳转阅读。

## 关键问题
1. **无搜索入口**：知识库页是纯树形导航，跨文件语义查找不可行；模块文档页（scan-docs）只有 SQL LIKE 词面过滤（backend/app/modules/scan_docs/service.py:158），既不管知识区也无法理解同义表达。
2. **既有向量端点不可直接复用**：POST /api/spec/knowledge/vector-search 只接受 shpsync_ CLI token（vector_router.py:88）且语料只有 decisions——平台用户 JWT 调不通、语料也窄。
3. **语料形态参差**：350KB 级大文件（knowledge/fr/backend.md、decisions/unmapped.md）与 `## D-xxx@vN` / `## FR-xxx-NNN` 条目化文件混存，直接整文件 embedding 召回粗、构建慢，需要按结构切块。

## 变更范围
- 后端：新建平台知识搜索服务（语料扫描 + 结构切块 + 词面/向量融合检索 + 进程内懒索引）与用户侧端点 POST /api/workspaces/{workspace_id}/knowledge/search（JWT + KNOWLEDGE_READ 门控，docs 结果按 SCAN_DOCS_READ 过滤）。
- 前端：知识库页内嵌搜索框 + 结果面板（来源徽章/路径/条目/片段高亮/匹配度）+ 双落点跳转（knowledge 深链现成；scan-docs 页补 ?path= 深链选中）。
- 测试：后端切块/融合/权限过滤/降级单测；前端搜索交互与跳转单测。

## 不在范围内（显式清单）
- 不做 changes/ 归档变更文档的检索（7550 个 md，噪音与体量不匹配「理解知识内容」场景）。
- 不做 CLI 端点（/api/spec/knowledge/vector-search）的任何改动。
- 不做跨 workspace / 平台级全局搜索。
- 不做搜索历史、热门搜索、个性化排序。
- 不做 DB 持久化索引（沿用进程内懒构建；若实测构建过慢另论，见 D-007）。
- 不做 ⌘K 全局命令面板（页内搜索为本期形态）。

## 成功标准（可验证）
- 知识库页输入中文自然语言（如「会话状态点语义」）能召回对应条目（跨 knowledge/ 与 docs/ 至少各一类），结果含可读片段。
- 输入精确标识符（如 D-xxx 编号、FR-xxx、文件名片段）能词面精确命中并排前。
- 点击 knowledge/ 结果跳转对应文件（条目锚点定位）；点击 docs/ 结果跳 scan-docs 页选中该文档。
- fastembed 不可用（模型缺席）时搜索仍返回词面结果且页面标注降级，不报错不空白。
- 无 SCAN_DOCS_READ 的用户搜索响应不含 docs/ 开头的结果；无 KNOWLEDGE_READ 返回 403。
- 索引对 spec 文件增删改自动失效重建（mtime 指纹），无需重启。

## 方案对比与选择（Step 4）

| 维度 | 方案 A：新用户侧端点 + 文件系统直读 + 词面/向量融合（选中） | 方案 B：扩展 CLI 向量端点（落选） | 方案 C：基于 DB 表（ScanDocument + 新增 knowledge 表）混合检索（落选） |
|---|---|---|---|
| 核心思路 | 新建独立服务与端点；spec 根直读文件、结构切块、双路融合、懒索引 | 把现有 /api/spec/knowledge/vector-search 扩语料至全树、放开 JWT | knowledge 内容先入库，检索打 DB（含全文索引） |
| 优势 | 不碰 CLI 契约；语料/切块/权限全可控；复用 fastembed 与懒索引先例；失败模式简单（纯文件读取） | 无新端点 | SQL 检索成熟；scan-docs 已有表可复用一半 |
| 劣势 | 新代码面（服务+端点+前端） | 破坏 CLI 契约：CLI 按 anchor 解析决策条目（knowledge-vector.js 契约头），混入非决策条目即解析失败；shpsync_ 鉴权通道与 JWT 用户会话冲突；CLI 侧「平台只做语义召回」原则被污染 | knowledge 侧无 DB 表，需新增 daemon 上行链路或同步任务（D-unmapped-012 死路④ daemon 挂点）；延迟同步；索引维护复杂 |
| 覆盖决策 | D-001~D-007 全覆盖 | 违反 D-001 | 违反 D-007（发散到 DB） |

**推荐：方案 A**。理由：唯一不破坏既有契约（CLI 端点/CLI 解析语义）且能复用平台既有 embedding 基建的路径；文件系统直读与 vector_search.py 已验证的懒构建模式同构，故障面最小。落选 B/C 的否决理由与复潮条件见 decisions.md（D-009/D-010）。

