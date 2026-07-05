---
author: qinyi
created_at: 2026-07-02 10:46:07
change: 2026-07-02-change-detail-file-tree-editor
---

# Proposal

## 动机

变更中心 / 变更详情页当前混入了不该由 UI 承担的信息（生命周期流程图、文档完整性面板），且无法查看 / 编辑变更目录下的真实文件。本次把变更详情的文档区改造成「文件树 + 编辑器」，让用户能直接看全变更目录、手动修正文档内容，保存经 outbox 队列写回客户端本机（daemon-client 工作区）。

## 关键问题（现有方案为什么不够）

1. **变更中心生命周期流程图越界**（`changes/page.tsx:341-361`）：把「扫描」混进了变更生命周期——扫描属于工作区初始化，不属于单个变更。整条流程图对用户无操作价值，徒增视觉噪音。
2. **文档完整性面板是 CLI 越权**（`[cid]/page.tsx:828-914`）：必需/可选文档完整度应由 SillySpec CLI 在流程内把控，UI 重复展示属越权，且与下方 DOC_TABS 查看器（916-993）职责重叠。
3. **daemon-client 读文档实际失效**：`ChangeService.get_document_content`（`service.py:211-265`）用 `workspace.root_path` 读文件，对 daemon-client 工作区 `root_path` 是宿主路径（`C:\Users\qinyi\...`），后端容器不可达，异常分支返回 `exists=False`——用户看到「文档尚未创建」假象。
4. **无法手动修改文档**：用户在 UI 发现文档有笔误/需微调时，只能去本机改文件，无法在平台直接编辑回写。

## 变更范围

- 变更中心列表页：删除「变更生命周期」流程图 SectionCard。
- 变更详情页：
  - 删除「变更文档完整性」面板 + DOC_TABS 只读查看器（D-008，文件树是超集）。
  - 新增「文件树 + 编辑器」：递归展示变更目录全部文件（含 tasks/、references/、prototype-*.html），文本文件可编辑、保存。
  - 保存经 `path_source` 分流：server-local 直写；daemon-client 后端直写平台镜像 + 入 DaemonChangeWrite outbox 队列回写本机，离线续传。
  - 保存后自动 per-change resync 刷新 DB（ChangeDocument 行 + title）。
  - UI 展示保存状态（保存中/已保存/排队中/失败）+ 镜像 last_synced_at。
- 后端：4 新端点 + 删 get_document_content 死代码 + DaemonChangeWrite 加 kind 列。

## 不在范围内（显式清单）

- 不做新建文件、重命名、删除文件（仅编辑现有文件内容）。
- 不做 diff 增量保存（全量 {path, content}）。
- 不做全工作区 reparse（仅 per-change 文档 resync）。
- 不做 server-local / daemon-client 之外的 path_source。
- 不改 SillySpec CLI 的文档完整性校验逻辑。
- 不做多端并发编辑冲突解决（last-write-wins）。
- 不改 daemon 侧消费代码（已核实 runChangeWrite 通用，零改动）。

## 成功标准（可验证）

- 变更中心列表页不再展示「变更生命周期」流程图，其余功能（列表/分页/搜索/新建/重新扫描）不变。
- 变更详情页不再展示「文档完整性面板」与 DOC_TABS 查看器；新文件树展示该变更目录全部文件（含子目录）。
- daemon-client 工作区下，文件树能正确读出文档内容（修掉 root_path 失效）。
- 编辑文本文件并保存：server-local 同步落盘 + DB 刷新；daemon-client 入队 + 镜像即时刷新 + DB 刷新，daemon 在线时几秒内回写本机，离线时排队待重连。
- 保存状态徽标正确流转（idle→saving→done|pending|failed）；排队文件在树上有「排队中」标记。
- 路径穿越攻击（../ 、绝对路径、符号链接）被拒（4xx）。
- 现有创建变更 / 归档门禁 / agent dispatch 流程零回归。
