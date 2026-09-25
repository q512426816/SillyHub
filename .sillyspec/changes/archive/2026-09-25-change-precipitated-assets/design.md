---
author: qinyi
created_at: 2026-09-25 10:18:00
scale: small
---

# 设计文档（Design）— 2026-09-25-change-precipitated-assets

## 背景

用户在变更详情页想看「本次变更沉淀的项目资产」。核对结论：CLI 归档时沉淀的 FR 索引（knowledge/fr/*.md）、决策蒸馏（knowledge/decisions/*.md）、测试绑定（test-trace.json）、patch 留档（change.patch/change-patch.json）、delta（delta.md）全部经 spec 树同步进入平台镜像，且平台已有按路径读镜像的现成能力（/changes/{cid}/files/content、/knowledge/{filename}），缺的只是「按变更名聚合解析」一层（全后端无 per-change 资产解析）。方案 a（服务端聚合端点+前端折叠卡）经用户拍板，CLI 命令与前端解析两路已证伪（D-001@v1）。

## 设计目标

变更详情 aside 新增「沉淀资产」卡：归档变更展示其沉淀的 FR 条目/决策条目/测试绑定行/patch 统计/delta 摘要，条目可跳知识库页；在途变更显示引导空态。

## 非目标

- 不动知识库页/扫描文档页（前轮核对 0 必须项）；不新增 CLI 侧命令；不改 CLI 产物文件格式。
- 不做移动端详情卡（桌面 aside 先行，移动端对等另议）。
- 不做资产的结构化入库（解析层实时读镜像，退役判据见 D-001@v1）。

## 总体方案

后端：`change` 模块新增 `assets.py` 解析层（~百行）+ router 端点 + schema DTO。解析规则（对齐 CLI 机械契约，只读不写）：
- fr 条目：扫 `knowledge/fr/*.md`，节头 `^## (FR-\S+)\s+(.+)$` 分条，节内 `^变更：<change_key>$` 行命中才收录（status 行/全文锚点行顺带提取）；decisions 同构（`^## (D-\d+@v\d+)\s+(.+)$`，无「变更：」行的条目跳过）。
- test-trace.json：归档目录直读，rows 原样（文件本身 per-change）。
- change-patch.json：存在才读（存量归档无此件 → patch=None）；delta.md：取标题行与 Before/Delta 段行数摘要。
- 镜像根获取复用 knowledge 模块先例（SpecWorkspace.spec_root，asyncio.to_thread 读盘）；变更目录解析复用 `_resolve_change_dir`（含 archive 段）。

前端：aside 尾部挂 `ChangeAssetsCard`（观测事件卡同构：useQuery 自取数、retry:false、isError → return null、默认折叠）；四组逐组「有数据才渲染」；FR/决策行点击跳知识库页（query 带文件锚点）；在途变更（archived=false）显示引导空态。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/app/modules/change/assets.py | 聚合解析层：镜像根获取 + fr/decisions 按变更名过滤 + 归档目录三件容错读（asyncio.to_thread） |
| 修改 | backend/app/modules/change/router.py | GET /workspaces/{ws_id}/changes/{cid}/assets（CHANGE_READ 权限，404 随变更不存在） |
| 修改 | backend/app/modules/change/schema.py | ChangeAssetsRead DTO（fr_entries/decisions/test_rows/patch/delta，全 Optional 容错） |
| 新增 | NEW:backend/app/modules/change/tests/test_assets.py | 聚合解析测试：以已归档的 2026-09-25-change-center-thin-flow 为金样本（fr 8 引用/决策 2/test-trace 221 行）+ 空态/无 patch 容错/在途变更 |
| 新增 | NEW:frontend/src/components/changes/detail/change-assets-card.tsx | 沉淀资产折叠卡（原型 prototype-precipitated-assets-card.html） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | aside 尾部挂载（page.tsx:422 一带） |
| 修改 | frontend/src/lib/changes.ts | getChangeAssets 客户端函数 |
| 新增 | NEW:frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | 组件测试：四组渲染/空态静默/失败隐藏/在途引导 |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/backend.md | change 模块补 assets 端点 |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md | changelog 条目 |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/frontend.md | changes 组件族补沉淀资产卡 |
| 修改 | .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md | changelog 条目 |

## 接口定义

```python
# GET /workspaces/{ws_id}/changes/{cid}/assets → ChangeAssetsRead
class ChangeAssetsRead(BaseModel):
    change_key: str
    archived: bool
    fr_entries: list[FrEntry] = []      # {id,title,status,file}
    decisions: list[DecisionEntry] = [] # {id,title,status,file}
    test_rows: list[TestRow] = []       # {row_id,anchor,tests,state}
    patch: PatchMeta | None             # {files,additions,deletions,patch_status,saved_at}
    delta: DeltaMeta | None             # {headline,before_lines,delta_lines}
```

数据流：assets.py 读镜像（producer）→ FastAPI JSON → getChangeAssets（frontend/src/lib/changes.ts）→ ChangeAssetsCard（consumer，逐组容错渲染）。

## 兼容策略

- 纯新增端点+卡片，存量 API/UI 零改动；解析失败/文件缺失逐项降级为空（fail-open 展示面，不影响变更详情主功能）。
- 「变更：」行格式属 CLI 机械契约——解析层做未知行跳过与容错，上游格式演进时本层同步（D-001@v1 故障面）。

## 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 镜像大仓扫 fr+decisions 全域文件的读盘耗时（40+20 文件×几十 KB） | P2 | asyncio.to_thread + 单请求一次性读；量级实测无压力（核对结论）；不做缓存（YAGNI，失败可重试） |
| R-02 | CLI 格式演进致解析漂移 | P1 | 解析只认节头+「变更：」行最小契约；金样本测试锁格式（thin-flow 归档） |
| R-03 | 在途变更误触发归档目录读取 | P2 | archived=false 时跳过目录件读取，仅返回引导空态 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案全节；FR-01~04 | 已覆盖 |

## 自审

- [x] 章节齐全 / frontmatter（scale: small——用户裁决轻量跑道，单能力闭环）
- [x] 决策引用 D-001@v1
- [x] 生命周期契约：不涉及（无 session/lease/daemon 面——纯读端点；「不涉及生命周期契约」）
- [x] UI 原型已生成（prototype-precipitated-assets-card.html）
- [x] 无「⚠️ 自审存疑」项
