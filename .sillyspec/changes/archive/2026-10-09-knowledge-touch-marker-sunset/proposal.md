---
author: flow-machine-draft
created_at: 2026-10-09T04:12:25.717Z
---
# 提案书（Proposal）— 2026-10-09-knowledge-touch-marker-sunset

## 动机

任务原话转写：知识触达面板归档态仍按「待复核」标记反查并宣称以标记为准，但 CLI 自 2026-09-29-rot-retire-inject-cap 起已退役标记落盘（371 条零消费实证），标记面恒空——归档前后列表恒等（实测 48→48）文案失真；且渲染层 id/title 同 slug 连排两遍、锚点条目与整文件域路由 48 行平铺噪声大。

成功标准：
- backend：change assets 聚合不再扫「待复核」标记（_REVIEW_MARK_RE 与 owner_line_re 分支删除），knowledge_touch 单一来源为 knowledge_hits inject 实时命中，API 响应形状不变
- frontend：知识触达标题与悬停文案不再宣称归档态以标记为准的双口径，统一为注入命中留痕口径
- frontend：同 slug 的 id 与 title 只显示一个；裸文件整文件路由条目按文件分组收拢，不再与锚点条目混排平铺
- 测试：backend change assets 相关测试与 frontend 卡片测试更新并通过（仅跑相关测试，不全量）

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. backend：change assets 聚合不再扫「待复核」标记（_REVIEW_MARK_RE 与 owner_line_re 分支删除），knowledge_touch 单一来源为 knowledge_hits inject 实时命中，API 响应形状不变
2. frontend：知识触达标题与悬停文案不再宣称归档态以标记为准的双口径，统一为注入命中留痕口径
3. frontend：同 slug 的 id 与 title 只显示一个；裸文件整文件路由条目按文件分组收拢，不再与锚点条目混排平铺
4. 测试：backend change assets 相关测试与 frontend 卡片测试更新并通过（仅跑相关测试，不全量）

## 成功标准（可验证）

1. backend：change assets 聚合不再扫「待复核」标记（_REVIEW_MARK_RE 与 owner_line_re 分支删除），knowledge_touch 单一来源为 knowledge_hits inject 实时命中，API 响应形状不变
2. frontend：知识触达标题与悬停文案不再宣称归档态以标记为准的双口径，统一为注入命中留痕口径
3. frontend：同 slug 的 id 与 title 只显示一个；裸文件整文件路由条目按文件分组收拢，不再与锚点条目混排平铺
4. 测试：backend change assets 相关测试与 frontend 卡片测试更新并通过（仅跑相关测试，不全量）
