---
author: flow-machine-draft
created_at: 2026-10-19T06:28:36.074Z
---
# 决策记录（Decisions）— 2026-10-19-knowledge-search-build-switch

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 风险①：默认值写错（如 False）会让所有部署静默失去懒建库。对策：默认 True + FR-02 用例③显式回归「缺省=仍建库」。 - 风险②：`reason="index_not_built"` 语义与 `model_ready=False` 的既有口径（「语义模型不可用」）有细微偏移——此处模型可能可用但索引缺失。裁决：沿用该字段（schema 注释已写「model_ready=False + results 纯词面 + reason 带因」的 fail-soft 语义，reason 词表扩一个值），文档同步说明。 - 风险③：关闭时跳过差量 sync，state 行存在但指纹过期的 ws 会静默服务陈旧索引。这是显式交付边界：禁建库服务器的索引新鲜度职责移交外部预建机器（known-issues 运维解既有口径），服务器端不做部分嵌入（部分嵌入=重新打开容器内嵌入门）。 - 风险④：无索引词面降级每次搜索全语料 scan（文件读放大）。裁决：可接受——仅发生在「未预建的 ws + 禁建库服务器」组合，本就是运维例外态；量级 ~百文件（生产实证 108 md/7 ws），且 DB 异常降级路径已是同款实现先例。 - 放弃方案A：开关关闭时对无索引 ws 返回空结果（不词面降级）——搜索完全不可用，违背「搜索永不 5xx/可查」的既有设计底线，放弃。 - 放弃方案B：per-workspace 建库白名单（哪些 ws 允许容器内建）——配置面与运维模型复杂化（known-issues 口径是「建库一律外部机器」，全局开关即够），放弃。
