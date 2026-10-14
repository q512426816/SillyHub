---
author: flow-machine-draft
created_at: 2026-10-14T07:54:34.800Z
---
# 设计记录（Design Record）— 2026-10-14-assets-knowledge-popup-preview

## 做法概述

只改前端 `ChangeAssetsCard`（frontend/src/components/changes/detail/change-assets-card.tsx）。「需求规则（FR 索引）」「决策蒸馏」「知识触达」三组内的 `<Link>`（整页跳知识库深链）全部改为 `<button>`，点击写入新状态 `knowledgeTarget: {file, anchor?}`，由第四个弹窗（复用本文件既有 Dialog 壳三先例）展示条目具体内容。

弹窗主体 = 新增组件内私有函数 `KnowledgePreviewBody`：用知识库页同款数据链——`normalizeKnowledgeFileParam` 归一 file → `getKnowledge` 取全文 → `EntryCardList` 条目卡渲染（zone 取自响应）→ 内容落定后按 `data-entry-anchor="文件#锚"` 单次 scrollIntoView 定位（查无静默落文件级顶部）。归一函数从知识库页迁到 `lib/knowledge.ts` 单一源——避免组件反向 import 页面模块造成的打包耦合。弹窗头部放「在知识库中打开 ↗」`<Link>`，href 与改造前深链逐字同构（encode 规则不变），满足「弹窗内可跳转过去」。

「测试绑定 / 模块触达 / 归档留档」三组本就是点击弹窗（FilePreview / 模块文档 / DiffView），行为不动，仅在本 design 留痕确认。

## 接口契约

- 后端：无改动。前端复用既有 `GET /knowledge/{filename}`（getKnowledge）与 `GET /changes/{cid}/assets`。
- `normalizeKnowledgeFileParam(raw: string): string`：从 `app/(dashboard)/workspaces/[id]/knowledge/page.tsx` 迁至 `lib/knowledge.ts`（纯函数，签名与行为逐字不变）；页面改为 import 使用，页面测试的 import 路径随迁。对外无行为变化。
- `ChangeAssetsCard`：新增内部状态 knowledgeTarget 与私有组件 `KnowledgePreviewBody`（不导出）；三组行/池的 DOM 从 `<a>` 变 `<button>`（视觉样式不变），点击行为从路由跳转变弹窗打开。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：弹窗体 useQuery 按 `[workspaceId, filename]` 缓存，react-query 单键单请求；用户快速连续点开不同条目时各键独立，晚到响应不会写错键（无手工 seq 需求）。锚点定位 effect 以 `q.isSuccess` 为闸，内容未落定不执行。
2. 并发写：本设计纯读（getKnowledge GET），无写路径，无并发写问题。
3. 切换/生命周期：弹窗关闭仅清 knowledgeTarget，查询缓存留在 QueryClient（默认回收），重开同条目命中缓存秒开；路由跳转（点弹窗内深链）时整页卸载，状态自然销毁。fail-open 惯例不变：assets 接口失败整卡隐藏，条目取数失败弹窗内就近错误文案。
4. 作用域：所有请求带 workspaceId 路径段，queryKey 含 workspaceId，跨工作区不串台。

## 风险与死路

- 最大风险：测试环境债——EntryCardList 的正文渲染链 CardMarkdown → MarkdownText 用 next/dynamic，jsdom 同步渲染为 null（entry-card-list.test 先例），组件测试必须 stub MarkdownText；jsdom 无 scrollIntoView，弹窗定位 effect 会抛未捕获错误拖挂测试（knowledge-page.test 先例），测试文件需按同款 beforeAll 打桩。
- 弃案 A：组件直接 `import { normalizeKnowledgeFileParam } from "@/app/.../knowledge/page"`——省一次迁移但把知识页整图（antd Tree 等）拖进变更详情页打包图，且组件反向依赖页面是反模式，弃。
- 弃案 B：弹窗内只渲染单条条目（自写解析器抽单卡）——EntryCardList 的条目解析是双端同域契约（slugifyAnchor 与 backend parser 对齐），单条抽取等于另起一套解析器，漂移风险大于收益；整文件渲染 + 锚点滚动与知识库页行为完全一致，弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | frontend/src/components/changes/detail/change-assets-card.tsx | 三组链接改弹窗 + 知识条目预览弹窗（KnowledgePreviewBody） |
| 改 | frontend/src/lib/knowledge.ts | 迁入 normalizeKnowledgeFileParam（单一源） |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | 本地定义改 import lib 版 |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | import 路径随迁 |
| 改 | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | 三组断言改弹窗交互 + 新弹窗用例 + 环境 stub |
