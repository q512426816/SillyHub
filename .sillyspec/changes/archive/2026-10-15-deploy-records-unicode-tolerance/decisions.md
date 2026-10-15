---
author: flow-machine-draft
created_at: 2026-10-14T22:52:28.114Z
---
# 决策记录（Decisions）— 2026-10-15-deploy-records-unicode-tolerance

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：捕获面过宽掩盖真实文件系统问题——不会：仅新增 `UnicodeDecodeError` 一类，OSError 分支语义不变，`parse_error` 仍留原因供排查。试过放弃的方案：① `read_bytes` + 手动 decode 再走解析——双份解码逻辑，容错分支翻倍不值；② 只修 skill 写入侧（强制 utf-8 落盘）——治不了存量坏文件与本机 Windows 手写文件，且 FR-04 已承诺服务端兜底，属治标不治本。
