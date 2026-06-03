# 14 — 风险登记

| ID | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-001 | projects 被误解为项目列表 | P0 | 明确 ProjectComponent 模型 |
| R-002 | 多人共用 Git Token | P0 | GitIdentity + 凭据隔离 |
| R-003 | 多任务共用 Worktree | P0 | WorktreeLease |
| R-004 | Agent 越权执行 Git | P0 | Git Tool Gateway |
| R-005 | Agent 读取服务器 SSH Key | P0 | 临时 HOME + 禁止全局 ~/.ssh |
| R-006 | Change 影响组件不明确 | P1 | affected_components 必填 |
| R-007 | 文档和代码脱节 | P1 | Spec Guardian |
| R-008 | Runtime 被误当事实源 | P1 | UI 标记 runtime 为临时态 |
| R-009 | 生产发布失控 | P0 | 审批 + 回滚 |
| R-010 | 平台过重 | P2 | V1 只做 Viewer + Git 隔离基础 |
| R-011 | 主密钥泄露 / 丢失 | P0 | 主密钥仅环境变量；docker secret；不入备份；KMS 接入留 V3+；丢失即所有 git_identity 失效 |
| R-012 | Agent 绕过 Tool Gateway 直接调裸 git/shell | P0 | V4 强制走 MCP 自定义 server；V4.1+ 用容器沙箱限制 PATH 中的二进制 |
| R-013 | Outbox 阻塞 / dead_letter 堆积 | P1 | 监控告警 + UI 重试按钮 + dead_letter 周报 |
| R-014 | Spec Guardian 误报阻塞流程 | P1 | 支持 `--override` + 写审计 + Reviewer 复核 |
| R-015 | 估时过度乐观 / scope creep | P1 | task 严格按 task-01 模板；超过预估 50% 必须重排或拆任务 |
| R-016 | 平台与 SillySpec 真实结构脱节 | P1 | 模板 fixture 必须通过自家 parser；定期跑 spike 02 验证 |
| R-017 | 状态机非法跳转造成数据腐烂 | P0 | `transitions.py` 单点白名单；任何 transition 经 `StateMachine.transition()` 否则拒绝 |
| R-018 | 审批超时无人响应 | P1 | approval 必须有 `expires_at`；过期自动 `expired`；管理面板看板 |
| R-019 | 多人同时编辑同一文档冲突 | P1 | `change_documents.version` 乐观并发；PATCH 必须传 If-Match |
| R-020 | Windows 与 Linux 行为差异 | P1 | CI 矩阵双跑；pathlib + posixpath；spike 01 双端验证 |
