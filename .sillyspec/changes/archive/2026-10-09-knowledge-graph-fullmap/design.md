---
author: qinyi
created_at: 2026-10-09 00:26:50
generated_by: sillyspec-design-init
scale: large  # 跨 sillyspec 仓 CLI + daemon + backend + frontend 四端 ≈12 文件，需 Wave 编排
---

# 设计文档（Design）— 2026-10-09-knowledge-graph-fullmap

<!-- 由 sillyspec design-init 生成的骨架（2026-10-09-knowledge-graph-fullmap）——逐节填散文后删除本注释；存量手写路径不受影响 -->
<!-- 引用规范：全文源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## 背景

2026-10-08-platform-knowledge-graph（已归档、已部署阿里云）交付了平台知识图谱：五查询切片 + lite 簇气泡总览 + 默认 orphans 视图。用户看实际效果后裁决两项调整（触发归档 D-008@v2 的复潮条件）：

1. **默认视图太空**：真实数据 orphans 仅 4 节点，进页画面内容感不足；
2. **想要原型星空**：归档原型的全图模式是 4628 节点预计算坐标的"星空聚类"静态渲染，观感远优于 lite 的 50 个簇气泡。

用户原话：「设计裁决差异 1 想更有内容」「想要星空效果全图」。

## 设计目标

1. 图谱页默认进页=**全图星空总览**（原型同款视觉：簇分组散布、缩放平移、标签分级）。
2. 点任意节点**下钻切片**（neighbors 力场查询），胶囊手动回全图——状态机复用既有 lite↔切片 骨架。
3. 全图数据**浏览器零布局计算**：坐标由 CLI 离线预计算（确定性），gzip 传输约 100-200KB。
4. 旧 CLI 探测降级不阻塞：无 dump 子命令时全图胶囊隐藏、默认回退 orphans（cli_feature_missing 先例）。

## 非目标

- 在线全图力导向（O(n²) 永久排除，归档 D-008@v2 延续）。
- 不改五查询/图卡/锚点补全等既有面（零回归）。
- 不做全图悬空/孤儿高亮叠加（下钻查询里已有，全图保持纯总览）。
- dump 落盘缓存（现算，D-003@v1）。

## 拆分判断

跨仓两段（沿用 2026-10-08 成功模式）：Phase 0 sillyspec 仓 CLI dump 子命令（另仓轻量 flow）+ Phase 1-4 平台仓对接。平台侧以探测降级保证两段独立交付。

## 总体方案

### Phase 0 — sillyspec 仓前置（另仓 flow）

- `sillyspec knowledge graph dump --layout --json` → `{ok, nodes:[{id,type,label,x,y}], edges:[{s,t,type,strength}], stats}`（stats 与 summary 同源聚合）。
- 布局算法从归档原型 `prototype-data-gen.cjs` 移植为 `layoutFullGraph(graph)` 纯函数。**分组口径=逐行移植原型 `comm()` 粗分组**（Grill F-01 钉死）：模块=单组、文档=单组、file 按顶级目录、fr/decision 按域、change/ql 按名——真图 ≈10-15 个"星系"即原型视觉；**显式排除** summary 的 883 细簇（那是已废弃 lite 的语义：细簇会把主环半径撑到 sqrt(883)*300≈8900px，视觉退化为均匀散点）。常量固化（原型 cjs:282-304 同值）：簇按 count 降序（同数 id 字典序稳序）、主环半径 `sqrt(gi+1)*300`（gi=簇序）、簇内半径 `16*sqrt(j+1)`（j=簇内节点序号）、黄金角 2.39999、簇相位偏移 `+gi`、坐标 `Math.round` 取整；**确定性为硬约束**（同输入两次调用逐位一致），**与原型生成器逐位等价非约束**（tie-break 稳序差异）。
- USAGE 行与 available 列表收编 `dump`。

### Phase 1 — daemon

- `KNOWLEDGE_GRAPH_SUBS` 白名单加 `dump`；`--layout` 旗标白名单（dump 子命令专属）；dump 回包**不裁剪**（全量是设计目的）；其余消毒/超时/回码沿既有 graph 方法零改动。

### Phase 2 — backend

- **压缩面仅限 dump 端点**（Grill F-00 修正：原案全站 GZipMiddleware 会压缩既有 SSE 流——StreamingResponse 是普通 HTTP 响应必经中间件，EventSource 默认带 Accept-Encoding: gzip，有 zlib 缓冲致事件批量延迟风险；main.py:711-767 / agent/router.py:518-547 / change/router.py:625-642 均同 app SSE 面）。实现：dump 端点内手动 `gzip.compress(payload)` + `Content-Encoding: gzip` 响应头（浏览器 fetch 透明解压）；**不加全站中间件**，既有端点/SSE/WS 零接触。
- `GET /knowledge/graph/dump`：信封同族（六键 reason，**cli_feature_missing:dump 归 upgrade_required**——Grill F-02 钉死，与 cli_subcommand_missing 同键区别于 rpc_error 瞬时错误）；data={nodes,edges,stats}（x/y 浮点）；**注册序铁律**（{filename:path} 通配前）；KNOWLEDGE_READ。
- graph.py `KnowledgeGraphService.dump()`：单 RPC（sub=dump, layout=true），60s 超时。

### Phase 3 — frontend

- `GraphCanvas` 加 `mode: 'full'`：静态渲染（不进力场引擎）——全图分支直译原型（标签只在大半径节点〔module/project/doc〕或 k>1.35——原型 HTML:396 同值；缩放平移复用既有视口代码）；**新增性能护栏（非原型直译，Grill F-04 标注）**：k<0.5 时只画节点不画边（万级边在低缩放下无意义），护栏谓词入 Phase 4 前端测试面；点节点回调 onSelect（页面层转 neighbors 下钻）。
- 页面：数据面胶囊「全图 / 查询切片」（lite 胶囊移除）；首载（可用且 dump 在场）默认加载 dump→全图渲染；dump 不可用→默认回退 orphans；点全图节点→切切片+neighbors；`fullMapData` 单独 useQuery（staleTime 5min，全图数据不频繁变）。
- lite 渲染分支与 lite 胶囊移除；`liteClusterLayout` 纯函数+单测保留（无死码检查面，注释标注保留原因）。
- lib：`getKnowledgeGraphDump()` + `knowledgeGraphDumpQueryKey`；gen:types 再生成。

### Phase 4 — 测试

- CLI：dump 输出形状/确定性（两次调用同坐标）/簇布局合理性（同簇节点距离 < 跨簇距离抽样断言）/USAGE 收编。
- daemon：dump 白名单/--layout 校验/全量不裁剪回包。
- backend：dump 端点 mock/路由序/**压缩断言**（响应恒带 Content-Encoding: gzip 且 body 可 gunzip 还原 JSON——手动无条件压缩语义；另断言一个既有小端点无 Content-Encoding 头证压缩面未外溢）。
- 前端：full 模式渲染降级（>FORCE 上限不适用——全图恒静态）、默认加载/回退链、点节点下钻状态机、lite 移除后既有用例更新。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 另仓交付 | （Phase 0 在 sillyspec 仓另立 flow：src/knowledge-graph.js 加 layoutFullGraph + dump case + USAGE——非本清单权威面，此处仅注记） |
| 修改 | sillyhub-daemon/src/runtime-handler.ts | 白名单加 dump + --layout 专属校验 |
| 修改 | sillyhub-daemon/src/daemon.ts | knowledge.graph 注册层 layout 旗标透传（执行期接线缝隙修复，verify-e2e 留痕） |
| 修改 | backend/app/modules/knowledge/graph.py | dump() 方法 |
| 修改 | backend/app/modules/knowledge/router.py | GET /knowledge/graph/dump（通配前） |
| 修改 | backend/app/modules/knowledge/schema.py | GraphDumpData DTO |
| 修改 | backend/app/modules/knowledge/tests/test_graph.py | dump 用例组 |
| 修改 | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | dump 用例 |
| 修改 | backend/openapi.json + frontend/src/lib/api-types.ts | gen:types 生成物 |
| 修改 | frontend/src/lib/knowledge.ts | dump 函数 |
| 修改 | frontend/src/lib/query-keys.ts | knowledgeGraphDumpQueryKey |
| 修改 | frontend/src/components/knowledge/graph-canvas.tsx | full 模式静态渲染分支（lite UI 入口移除，纯函数保留） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx | 默认全图/胶囊/下钻/回退链 |
| 修改 | frontend/src/components/knowledge/__tests__（graph-canvas/page/ops-dashboard） | 用例更新+新增 |

## 接口定义

本变更接口面：+1 端点 + 1 RPC 子命令 + 0 数据库变更。

```
GET /api/workspaces/{workspace_id}/knowledge/graph/dump → GraphDumpOut（KNOWLEDGE_READ，注册在 {filename:path} 前）
GraphDumpOut.data: { nodes: [{id,type,label,x:float,y:float}], edges: [{s,t,type,strength}], stats: GraphSummary同构 }
RPC knowledge.graph: sub="dump" + layout=true（必带）→ daemon 拼 `sillyspec knowledge graph dump --layout --json`
CLI: sillyspec knowledge graph dump --layout --json（坐标确定性；stats 与 summary 同源）
```

## 生命周期契约表

本变更不涉及生命周期契约面：无 session/lease/agent_run/daemon 状态转换/heartbeat——dump 是一次性请求-响应（daemon 子进程 30s 超时杀树既有机制；全图 1.5-2MB WS 单帧经 uvicorn 默认 16MB 上限，实现期实测钉）。

## 数据模型

无 schema 变更：全图数据解析时内存派生现算坐标（D-003@v1），不落盘无缓存。

## 兼容策略（brownfield 必填）

- **旧 CLI（无 dump）**：daemon 回 cli_feature_missing:dump → 前端全图胶囊隐藏、默认回退 orphans——五查询/图卡/补全零影响。
- **旧 daemon**：upgrade_required 降级卡（既有六键链）。
- **dump 端点局部压缩**：仅 dump 端点手动 gzip（无条件压缩 + Content-Encoding: gzip 头，浏览器 fetch 透明解压）；SSE/WS/既有端点零接触（Grill F-00：不做全站中间件，规避 SSE 流被压缩缓冲的风险）。
- **lite 移除**：胶囊从三态变两态；无持久化状态引用 lite（会话级 UI 态）。
- 既有 knowledge 端点/前端面零回归（测试钉）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | dump 全量 WS 单帧（1.5-2MB）超 daemon/backend WS 上限 | P2 | uvicorn 默认 16MB（余量 8×）；实现期实测 5800 节点真图钉数据；超限回退方案=分页 dump（退役判据预案） |
| R-02 | 全图渲染性能（5812 节点静态帧） | P2 | 静态无物理、按缩放阈值裁剪边绘制（k<0.5 不画边）；脏标记只重绘交互帧；原型 4628 节点同方案实测流畅 |
| R-03 | 坐标确定性漂移（CLI 迭代改布局） | P3 | 算法纯函数+确定性 tie-break+两次调用同坐标单测钉；版本间坐标变化仅视觉重排无语义影响 |
| R-04 | dump 压缩面外溢 | P3 | Grill F-00 修正：不做全站中间件，仅 dump 端点手动 gzip（SSE/WS/既有端点零接触）；测试断言 dump Content-Encoding: gzip + 既有 SSE 用例零回归 |
| R-05 | 无长驻进程/外部资源，生命周期面不适用（显式留痕） | — | 子进程随 runSillyspecCmd 超时杀树（既有机制） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-04/FR-05；Phase 3 默认视图/回退链 | 已覆盖 |
| D-002@v1 | 全部 Phase；接口定义；R-01/R-02 | 已覆盖 |
| D-003@v1 | Phase 0 现算；数据模型 | 已覆盖 |

（跨变更承接注：D-001 supersedes 归档变更 D-006@v1、D-002 supersedes 归档变更 D-008@v2——版本链见 decisions.md evidence。）

## 自审

- [x] 章节齐全（背景/目标/非目标/拆分/方案/清单/接口/生命周期豁免/数据模型/兼容/风险/追踪/自审）
- [x] frontmatter 齐（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@v1（三条）
- [x] 生命周期豁免声明紧邻
- [x] UI 原型：复用归档原型全图模式（PHYS=false 星空）为钦定形态——跳过新原型，R 项已记（视觉参数直译+单测钉）
