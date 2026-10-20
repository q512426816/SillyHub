---
author: flow-machine-draft
created_at: 2026-10-19T05:30:09.503Z
---
# 任务注册表（Tasks）— 2026-10-19-thinking-zh-translate

- [x] task-01: 后端 translate 模块骨架：schema.py（DTO+限额）、chunking.py（代码块/行内代码/URL 保护、值得翻启发式、≤1000 字符按段分块）、config.py translate_* 配置组、pyproject +ctranslate2；test_chunking.py 全绿后勾
- [x] task-02: 翻译引擎子进程：translate_worker.py（ct2 模型解析——TRANSLATE_MODEL_DIR 优先/HF 自动下载/三闸自灭/行协议）+ engine.py 子进程代理（懒启动/崩溃退避/单次透明重启）；test_engine.py 用 fake worker 全绿后勾
- [x] task-03: service.py 缓存编排（内存 LRU + Redis best-effort TTL 7d）+ router.py POST /api/translate/thinking（TASK_RUN_AGENT 鉴权、限额 422、engine 不可用 fail-soft 200）+ main.py 挂载；test_service.py + test_router.py 全绿后勾
- [x] task-04: 前端 lib/thinking-translate.ts（needsTranslation 启发式、splitIntoChunks、250ms 合批队列、同文本去重、内存缓存）+ stores/thinking-translate.ts（zustand persist 默认开）；thinking-translate.test.ts 全绿后勾
- [x] task-05: 共享组件 components/thinking-translate/（useTranslatedText hook：流式中不请求/结束后摘要翻前 500 字符/展开翻全文/失败退避 + TranslatedThinkingBody：译文默认+原文一键切换+翻译中标记+不可用轻提示）；组件测试全绿后勾
- [x] task-06: 三条渲染路径接入（turn-segment-views.tsx ThinkingRowView、turn-timeline.tsx TurnDetailsList、agent-log-viewer.tsx、agent-log-card.tsx）+ 接入测试；vitest + tsc 全绿后勾
- [x] task-07: 部署文档（模型预烤/TRANSLATE_MODEL_DIR 离线配置/HF_ENDPOINT 镜像说明）+ 后端全量 pytest + 前端全量 vitest 回归绿后勾
