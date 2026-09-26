---
author: flow-machine-draft
created_at: 2026-09-26T23:40:52.477Z
---
# 决策记录（Decisions）— 2026-09-27-audit-followup-hardening

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：合法但形态特殊的 doc 值（如含反斜杠的合法相对路径）被误判越界丢弃 chip——影响面仅展示降级（名回退 id），不丢模块触达本身。试过放弃：①「resolve+is_relative_to 白名单」——Windows 大小写/符号链接语义跨三平台分歧大（规则 13），纯词法判定更可移植；②「doc 保留仅去 h1 读取」——越界路径仍外发给前端 chip 可点击，留下二次面；③「同步修 explorer 预览侧」——explorer 自有寻径防护（前端传参仅展示路径），无需重复设防。
