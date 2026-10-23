---
author: flow-machine-draft
created_at: 2026-10-23T03:58:54.365Z
---
# 决策记录（Decisions）— 2026-10-23-diff-copy-p3-cleanup

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是脚注文案过长挤压 85vh 弹窗的可视区——缓解：脚注保持 10.5px muted 两行内文案，追加在半句后而非独立段；若仍拥挤可后移为 tooltip（本变更不做，避免过度设计）。 试过放弃的方案：① 给 diffRowsToText 加缓存（Map by rows 引用）——rows 每段唯一且弹窗生命周期短，缓存无收益还增加清理面，放弃；② 改 CopyButton 共享组件加 builtin getText 优化——其 getText 已存在，无需改；③ 回改上一变更归档的 requirements 修正 FR-02 措辞——归档件冻结（审计真相），不回改历史文档，放弃。
