---
author: flow-machine-draft
created_at: 2026-10-14T08:09:10.370Z
---
# 决策记录（Decisions）— 2026-10-14-assets-knowledge-popup-preview

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：测试环境债——EntryCardList 的正文渲染链 CardMarkdown → MarkdownText 用 next/dynamic，jsdom 同步渲染为 null（entry-card-list.test 先例），组件测试必须 stub MarkdownText；jsdom 无 scrollIntoView，弹窗定位 effect 会抛未捕获错误拖挂测试（knowledge-page.test 先例），测试文件需按同款 beforeAll 打桩。 - 弃案 A：组件直接 `import { normalizeKnowledgeFileParam } from "@/app/.../knowledge/page"`——省一次迁移但把知识页整图（antd Tree 等）拖进变更详情页打包图，且组件反向依赖页面是反模式，弃。 - 弃案 B：弹窗内只渲染单条条目（自写解析器抽单卡）——EntryCardList 的条目解析是双端同域契约（slugifyAnchor 与 backend parser 对齐），单条抽取等于另起一套解析器，漂移风险大于收益；整文件渲染 + 锚点滚动与知识库页行为完全一致，弃。
