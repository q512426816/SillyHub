---
author: flow-machine-draft
created_at: 2026-10-15T04:09:55.184Z
---
# 决策记录（Decisions）— 2026-10-15-platform-vector-search

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：真模型首查秒级 embed 延迟（700-2400 条）+ 首次模型下载 90MB——已卸线程池不卡事件循环；生产建议镜像预烤模型（文档在 FastembedEmbedder docstring）；workspace 语料超万条时首查可感——当前量级（本体系最大 2400）无虞，超限再引增量索引。次风险：fastembed/ONNX 依赖体积（镜像 +~200MB）——用户已拍板接受；embedding 质量对极短条目（纯标题无理由）弱——语料契约本就含理由文本，模板保证在场。死路（放弃）：①API embedding（litellm/openai）——用户指出 litellm 平台侧已去，且要 key 要钱要外网；②统计向量（TF-IDF/n-gram）——与 CLI 本地层同构重复建设，语义增益零；③pgvector——2400 条暴力余弦毫秒级，数据库往返反而更慢且加迁移负担；④daemon sync 挂点灌索引——免 daemon 改动的懒构建已覆盖，挂点属过早优化。
