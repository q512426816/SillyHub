---
author: flow-machine-draft
created_at: 2026-10-19T07:43:28.314Z
---
# 决策记录（Decisions）— 2026-10-19-translate-live-verify

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：第三方个人仓库（jiangzhuo9357）可能失联/删除——缓解：TRANSLATE_MODEL_REPO env 可换任意 ct2 仓库、TRANSLATE_MODEL_DIR 指本地目录彻底离线、README 预烤文档已覆盖。放弃的方案：`ooeoeo/opus-mt-en-zh-ct2-float16`（float16 权重 CPU 推理不友好，且无必要）；本地 ct2-transformers-converter 自行转换 Helsinki-NLP/opus-mt-en-zh（需装 torch ~200MB，重且慢于直接用现成 int8 转换）。
