---
author: qinyi
created_at: 2026-08-17 00:02:00
---
# 提案书（Proposal）

## 动机
CLI 每步只上行进度 JSON，文档四件套需手动 platform sync-docs——本地直跑 sillyspec 的产出文档永远不自动到平台（变更中心长期"进度到了文档没到"的根因）。

## 关键问题
1. sync() 不推文档（sync.js:32 注释明写 run 流程不自动推）；syncDocuments() 实现齐全仅手动命令调用。
2. daemon 自动同步推旧缓存推不出主仓新文档；手动按钮（b004038e 已修）需人工点击。

## 变更范围
sillyspec 仓 sync() 成功路径追加 syncDocuments（best-effort+全缺失跳过）+ 测试。

## 不在范围内
- daemon 自动链路改造（CLI 直推后降级非必要）
- 四件套外文件（走 daemon tar 链路）
- 增量 diff

## 成功标准（可验证）
- 本地直跑 sillyspec 任一步 --done 后，平台变更详情出现/更新四件套文档（无需手点同步）。
- 四件套全缺失（quick 极早期）不调端点不报错。
- documents 失败不影响进度上行成功。
- 未连平台零变化。
