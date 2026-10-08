---
author: flow-machine-draft
created_at: 2026-10-08T17:51:05.716Z
---
# 决策记录（Decisions）— 2026-10-09-frontend-risk-fixes

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：overview 等待最长 200s——期间 UI 无中间反馈（react-query isLoading 态），用户可能重复刷新；属既有 UX 债非本变更引入，后续可加进度提示。次风险：copyText 去掉可选链后，jsdom/旧浏览器上 clipboard 缺失路径从「静默 no-op」变为「失败提示」——全文路径复制（fulltext-link）调用方仍忽略返回值静默降级（本体是可见文本），锚点复制从假成功变真失败提示，方向正确。试过放弃：(a) 渲染级测试钉 onPointerDown 置位——放弃，jsdom 无 canvas 2D 上下文，rAF 循环 effect 早退不可观测，改为提取 shouldAutoRefit 纯函数 + 双源置位一行接线（仓库 graph-canvas.test 纯函数惯例）；(b) 后端并发化 overview 三 RPC 缩短总预算——放弃，RPC 客户端并发安全性未证且超出本变更（前端风险收口）范围。
