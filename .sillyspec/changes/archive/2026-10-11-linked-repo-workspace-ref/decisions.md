---
author: qinyi
created_at: 2026-10-11 16:53:11
generated_by: sillyspec-fourpiece-init
change: 2026-10-11-linked-repo-workspace-ref
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 需求本体——关联仓与平台工作区打通（可挂载引用+跳转+回显匹配）
- type: term
- priority: P0
- status: accepted
- source: user
- question: 「关联仓与平台工作区关联上」指什么？
- answer: 关联仓登记条目可以挂载一个平台工作区引用（ref_workspace_id），实现：①列表可点击跳转到对方工作区详情；②本机回显对照时按名字自动匹配平台工作区，提示可关联。形态=手动选+跳转（推荐），回显匹配=提示不写库。
- normalized_requirement: 加可空 FK + 下拉选择 + 跳转链接 + 回显匹配提示。
- impacts: [全部]
- evidence: 用户原话轮 1；两轮 AskUserQuestion 未答自主推进（推荐形态）

## D-002@v1: 不做自动写库匹配/双向/路径复用
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: 要不要自动按名字匹配写库/双向同步/复用对方工作区绑定路径？
- answer: 不做。自动匹配只提示（local-echo 回显时标 matched_workspace），确认后由用户手动挂载；双向自动会在两表间形成同步循环面；路径复用涉及跨工作区权限边界，均留 v2 候选。
- normalized_requirement: 非目标显式列三条。
- impacts: [design 非目标]
- evidence: D-001 推荐形态边界
