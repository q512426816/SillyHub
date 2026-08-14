---
author: qinyi
created_at: 2026-08-14 21:38:00
---

# 提案（Proposal）— platform_sync 契约缺口端点

## 动机

2026-08-14 全接口实测发现 sillyspec CLI 预留的两个平台端点后端从未实现（`sync.js:959` TBD-hub-api 标注）：
1. `POST /api/changes/{name}/documents` → 404，`sillyspec platform sync-docs` 命令不可用（best-effort 静默失败）；
2. `POST /api/changes/{name}/approval` → 405（后端只有 GET），`sillyspec platform approve/reject` **必失败**（exitCode=1）。

连带：GET approval 硬编码永远 approved，CLI execute 审批门控形同虚设——平台无法把 rejected 传给 CLI。

## 方案概要

platform_change_progress 表加 documents/approval 两个 JSON 列（单写者定向列互不覆盖），实现两个 POST 端点（body 照 CLI 字面契约），GET approval 改读库（无记录默认 approved 放行保持兼容，rejected 真正阻断 CLI execute）。

## 收益

- `platform sync-docs` / `platform approve` / `platform reject` 三个 CLI 命令端到端可用。
- 审批门控闭环：平台侧 reject → CLI execute 启动硬阻断。
- 四件套文档上云，为后续平台侧文档展示留数据基础。

## 不在范围内（Non-Goals）

- 审批策略配置化（谁可审批/多级审批）。
- documents 下行 GET 端点（CLI 无消费方，只推不拉）。
- change 模块 review 四端点与前端审批卡改造（`2026-08-14-change-center-conversation-driven` 范围）。
- sillyspec 仓任何代码改动（后端照 CLI 字面契约实现，D-004@v1）。
