---
author: flow-machine-draft
created_at: 2026-10-19T11:08:26.361Z
---
# 提案书（Proposal）— 2026-10-19-cross-repo-patch-slicing

## 动机

任务原话转写：资产卡跨仓单文件 diff 切片

动机与背景：跨仓冻结元数据已上资产卡（2026-10-19-change-assets-cross-repo-repos），但想看跨仓某文件的具体 diff 只能进全屏预览读数 MB JSON；主仓文件可点开切片，跨仓没有对等能力。

成功标准：
- assets/patch-file 端点新增可选 repo 参数（值须命中已解析 repos keys），切片取 change-patch.json 对应仓 repos[].patch 内联正文，复用既有切片与上限逻辑
- 资产卡仓段下列出该仓文件清单（后端从 patch 头解析投影，超上限截断标注），点开单文件弹窗看跨仓 diff
- 后端单测覆盖命中/未知仓/无 repos 三态，前端组件测试覆盖列表与点开弹窗，类型重生成同步

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. assets/patch-file 端点新增可选 repo 参数（值须命中已解析 repos keys），切片取 change-patch.json 对应仓 repos[].patch 内联正文，复用既有切片与上限逻辑
2. 资产卡仓段下列出该仓文件清单（后端从 patch 头解析投影，超上限截断标注），点开单文件弹窗看跨仓 diff
3. 后端单测覆盖命中/未知仓/无 repos 三态，前端组件测试覆盖列表与点开弹窗，类型重生成同步

## 成功标准（可验证）

1. assets/patch-file 端点新增可选 repo 参数（值须命中已解析 repos keys），切片取 change-patch.json 对应仓 repos[].patch 内联正文，复用既有切片与上限逻辑
2. 资产卡仓段下列出该仓文件清单（后端从 patch 头解析投影，超上限截断标注），点开单文件弹窗看跨仓 diff
3. 后端单测覆盖命中/未知仓/无 repos 三态，前端组件测试覆盖列表与点开弹窗，类型重生成同步
