---
author: flow-machine-draft
created_at: 2026-10-22T02:16:34.210Z
---
# 任务注册表（Tasks）— 2026-10-22-fix-translate-cjk-segments

- [x] task-01: chunking.py 新增 should_translate_segment（语言占比判定，不套长度阈值）；test_chunking.py 新增用例（中文为主跳过、短英文段送翻、纯符号跳过），跑该文件全绿
- [x] task-02: service.py 送翻循环加段级二次判定 + translated_ids 实际送翻标记（替换 _has_translation）；test_service.py 新增混合内容返回原文/全跳过 translated=false/纯英文保护段回归用例，跑 translate 模块测试全绿
- [x] task-03: README 同步段级判定与实际送翻语义说明
