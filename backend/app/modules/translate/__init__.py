"""思考内容离线翻译模块（change 2026-10-19-thinking-zh-translate）。

后端本地 en→zh 翻译服务：CTranslate2 int8 量化 opus-mt-en-zh 子进程推理
（复刻 knowledge/embedding_worker 三闸自灭模式）+ 双层缓存（进程内 LRU +
Redis best-effort）。POST /api/translate/thinking 端点 fail-soft：引擎缺席
返回 engine_ready=false 原文透传，不阻塞应用启动。代码块/行内代码/URL
保护不送翻（chunking.py）。零外部云翻译 API 调用。
"""
