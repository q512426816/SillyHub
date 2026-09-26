---
author: flow-machine-draft
created_at: 2026-09-26T07:51:57.085Z
---
# 任务注册表（Tasks）— 2026-09-26-change-real-timeline

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。
- [x] task-01: 后端 NEW timeline.py ChangeTimelineQueryService 三源聚合——platform_change_events 正序（workspace_id+change_key）、tasks.md 任务行正则、requirements.md created_at 诞生锚；GET /changes/{cid}/timeline 端点 + schema 五 DTO；git 提交标题经 GitLogService.list_commits（daemon RPC limit 50）短哈希前缀匹配，异常降级仅哈希
- [x] task-02: kind→图标/强调映射对齐 CLI watcher timeline（📝 内容变更/✅ 勾选/⚠️ 告警琥珀/🔀 提交/📦 归档/🁢 诞生），commit 行哈希+标题，fake-check 醒目态，provisional 观测语义脚注披露盲窗
- [x] task-03: 前端 NEW change-timeline-card.tsx（事件轴+任务面+脚注三段式，useQuery 自取数 30s 轮询失败静默）+ 详情页 steps 为空处挂载填补空窗；api-types 生成字段 ?? 兜底防旧后端过渡窗口
- [x] task-04: 后端 test_timeline.py 4 用例（金样本聚合含诞生锚/任务锚推断/墙钟统计、空 events 容错、git 降级仅哈希、跨工作区 404）+ 前端组件 4 用例（三段渲染/fake-check 醒目/空数据隐藏/失败隐藏）+ 页面 1 用例（steps 空挂卡且原步骤时间线不渲染）+ 三个既有页面测试 mock 工厂补 getChangeTimeline
- [x] task-05: 规则 21 gen:types 同步 backend/openapi.json + frontend/src/lib/api-types.ts 随提交；lib/changes.ts 客户端 getChangeTimeline + 类型引 api-types 生成版
- [x] task-06: 后端 change 模块 585 passed + 2 skipped（新增 4）；前端聚焦 27 passed；tsc exit 0；ruff/lint 干净
