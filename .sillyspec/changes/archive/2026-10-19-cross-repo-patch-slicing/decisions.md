---
author: flow-machine-draft
created_at: 2026-10-19T11:34:34.065Z
---
# 决策记录（Decisions）— 2026-10-19-cross-repo-patch-slicing

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：`file_list` 从 patch 头解析（而非独立清单字段），若 CLI 未来改 patch 格式（如 no-prefix diff）清单会静默变空——投影是 best-effory 展示面，切片命中与否仍有 note 兜底，可接受。放弃方案：①CLI 在冻结件里新增独立 repos[].files 字段——要跨仓改冻结契约且需 CLI 发版协同，解析现有内联正文零协同即可达成同一效果；②未知 repo 键抛 422 白名单——与端点「读不到留档是展示面降级」的既有语义冲突，且无安全面收益；③前端自行拉全量 change-patch.json 解析清单——4MB 传输只为拿文件名，浪费且受 content 端点截断限制。
