---
author: qinyi
created_at: 2026-09-10 11:42:58
---
# 任务清单（Tasks）

- [x] task-01: sess id 提取纯函数 + fixture SQLite 测试库构造器（depends_on: —）
- [x] task-04: backend content 端点 zcode 分支——messages RPC 合成伪 jsonl + read_file 回落（depends_on: —）
- [x] task-02: read-zcode-sqlite 读取器——开库/归一化/隐藏过滤/窗口/容错（depends_on: task-01）
- [x] task-03: host-fs-handler 分派接线——守卫后先库后文件四态（depends_on: task-02）
- [x] task-05: @types/node bump + 相关套件回归 + 真实库冒烟（depends_on: task-02,03,04）
