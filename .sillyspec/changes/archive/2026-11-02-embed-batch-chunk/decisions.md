---
author: flow-machine-draft
created_at: 2026-11-02T01:59:47.843Z
---
# 决策记录（Decisions）— 2026-11-02-embed-batch-chunk

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险：批内失败重试粒度变粗的反向担忧——实为不变（今天单批失败也是整体重建重来，分批后同样整体重来，且单批成功率上升而非下降）。次级风险：批大小 64 若未来语料单条文本极长（每条数十 KB），单批字节量仍可能偏大——当前决策条目文本为百字级，64×百字 ≈ 数十 KB JSON，远低于风险线；若未来形态变化，常量提升为 Settings 配置即可（本变更不做，避免无据配置面）。试过但放弃的方案：① 代理层（`EmbeddingSubprocessProxy.embed`）透明分批——超时/透明重启重试语义需在代理内重造（整批序列共享 deadline 的切分与 `attempts` 计数重定义），复杂度高于收益，且现存爆炸面仅 search_sync 一处；② 只提 mem_limit（2500m→3500m）——治标：语料单调增长，2026-10-24 的 1100m→2500m 提额四天后即被 2.4GB 批复现，继续提额只是推迟；③ worker 侧（embedding_worker.py）内部再分批——worker 收到的单请求 JSON 已含全量 texts，解析瞬间内存峰值已发生，worker 内分批为时已晚，必须在请求发起侧收口。
