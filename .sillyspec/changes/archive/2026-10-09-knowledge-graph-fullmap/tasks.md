---
author: qinyi
created_at: 2026-10-09 00:35:00
---
# 任务清单（Tasks）

> 初版清单（brainstorm）；plan 阶段展开为 Wave + 任务卡并回写。
> Phase 0（sillyspec 仓 dump 子命令）由该仓独立轻量 flow 交付。

- [x] task-02: daemon 白名单加 dump（layout 必 true 校验/全量不裁剪）+ handler 测试
- [x] task-03: backend GZipMiddleware + schema GraphDumpData + graph.py dump() + router GET /knowledge/graph/dump（通配前）+ 测试（mock/路由序/gzip 头/SSE 零回归）
- [x] task-04: gen:types + lib（getKnowledgeGraphDump + knowledgeGraphDumpQueryKey）
- [x] task-05: GraphCanvas full 模式静态渲染（无力场/k<0.5 不画边/标签分级/点节点 onSelect）+ lite 渲染分支移除（纯函数保留）+ 纯函数单测
- [x] task-06: 页面默认全图/胶囊两态/点节点下钻/dump 不可用回退 orphans + staleTime 5min + 用例更新（page/ops-dashboard 零回归） (depends_on: task-05)
- [x] task-07: 端到端验收——本地栈实测全图星空截图（对照原型）/点节点下钻/回退链/gzip 实测/WS 大帧实测留档 (depends_on: task-06)
