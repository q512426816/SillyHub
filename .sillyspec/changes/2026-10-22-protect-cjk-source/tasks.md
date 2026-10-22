---
author: flow-machine-draft
created_at: 2026-10-22T02:40:09.618Z
---
# 任务注册表（Tasks）— 2026-10-22-protect-cjk-source

- [x] task-01: chunking.py 的 _PROTECT_RE 增加中文片段保护分支（汉字 + 中文/全角标点）；test_chunking.py 新增中文片段切分用例（中文引用成保护段、纯英文不变），跑该文件全绿
- [x] task-02: test_service.py 新增生产复现用例（中文引用逐字保留 + 输出无连续反斜杠）；确认既有纯英文回归用例不变，跑 translate 模块测试全绿
- [x] task-03: README 同步源端中文保护说明；生产容器用修复后代码复跑复现脚本验证无反斜杠乱码
