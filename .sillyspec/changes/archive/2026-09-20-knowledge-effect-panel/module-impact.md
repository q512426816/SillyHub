# 模块影响分析（骨架由 `sillyspec module-impact --change <变更名>` 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `.claude/CLAUDE.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyhub-docker-deploy/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-archive/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-auto/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-brainstorm/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-commit/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-continue/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-execute/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-explore/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-knowledge/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-plan/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-propose/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-quick/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-resume/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-state/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-verify/SKILL.md` <!--TODO: 归属判定-->
- `.zcode/skills/sillyspec-workspace/SKILL.md` <!--TODO: 归属判定-->
- `AGENTS.md` <!--TODO: 归属判定-->
- `backend/openapi.json` <!--TODO: 归属判定-->
- `frontend/src/lib/api-types.ts` <!--TODO: 归属判定-->

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `backend/modules/knowledge.md` | 补 hits 第三面：knowledge_hits 表（uq 幂等）+ POST hits/batch / GET stats 两端点（六型白名单宽容外型、使用计数 {inject,fr-inject}、per_task 次任务归一口径+%两档显示、slug 双端归一、daemon_local_id）+ parse_knowledge_entries 条目全集 + list 透传 use_count + 运营四指标口径（task-07） | done |
| `sillyhub-daemon/modules/spec-sync.md` | 补 hits 上报 best-effort 钩子（postSpecSync 成功汇聚点+独立 try/catch R-05）、`~/.sillyhub/daemon/.hits-upload-state-{wsId}.json` offset 状态文件、≤2000 行分批（R-06）、完整行断点（R-01）语义（task-07） | done |
| `sillyhub-daemon/modules/client.md` | spec 同步方法面补 postKnowledgeHitsBatch（URL/body 契约+daemon_local_id 取 runtime_id+返回三计数）（task-07） | done |
| `SillyHub/modules/frontend_components.md` | 知识域条目追加 ops-dashboard（四指标卡/内嵌死条目清单/使用率榜 % 两档格式 formatPerTaskPct/三态/knowledgeStatsQueryKey 导出）与 entry-card-list（四形态分发/slugifyAnchor 双端归一/防复潮/superseded 折叠/entryCounts 降级）一行式紧凑增量（task-07） | done |
| `_module-map.yaml` | 无需增改：新文件 `sillyhub-daemon/src/knowledge-hits-upload.ts` 未入 map paths，但其语义已并卡（spec-sync 上报钩子 + client postKnowledgeHitsBatch），模块索引 rebuild 留待下次全量扫描 | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
