---
author: qinyi
created_at: 2026-08-16 23:22:00
change: 2026-08-16-change-center-quick-tab
status: draft
---

# 需求（Requirements）— 变更中心「快速修复」tab

来源：用户对话确认（2026-08-16，展示位置/方案 B/双链路升级三项决策均用户亲选）+ Design Grill 修订。

## 功能需求

- **FR-01** QUICKLOG 条目解析器：解析 `spec_root/quicklog/QUICKLOG-*.md` 全目录，按 `## ql-` 块切分，产出 ql_id/timestamp/title/status/author_raw/linked_changes/files（含括注）/四段正文；宽松解析（全半角冒号、CRLF 剥行尾、多状态行取最后、linked_changes 白名单正则 `^\d{4}-\d{2}-\d{2}-`）。
- **FR-02** CLI 推送链路：sillyspec quicklog.js 在 allocateQuicklogEntry/completeQuicklogEntry 两触发点后 best-effort POST 条目 JSON 到平台（local.yaml platform 段；无配置/失败静默不阻断）。
- **FR-03** 平台接收端点：`POST /api/quicklog-entries`，shpsync_ 工作区令牌鉴权（workspace 由 token 派生，payload 不含 workspace 字段），(workspace_id, ql_id) 幂等 upsert 落 PG quicklog_entries。
- **FR-04** 查询 API + 双源合并：`GET /api/workspaces/{id}/quicklog-entries`（分页/search 全文/status/author/linked_change 筛选/include_placeholder）+ 单条详情；合并 PG ∪ 文件解析，ql_id 去重 PG 优先；列表含 author enrich（users.display_name 优先）与 affected_modules（module-map 推导）。
- **FR-05** 前端「快速修复」第三 tab：徽标计数；列=状态（4 态徽标）/标题/负责人/影响模块/关联变更（跳转）/时间；筛选=关键词全文+状态+负责人+空壳开关（默认隐藏）；存在 in_progress/stale 条目 30s 轮询、全终态停轮。
- **FR-06** 抽屉详情：四段正文 + 文件带括注清单 + 关联变更链接 + 原始 md 切换；不新建独立详情页。
- **FR-07** 反向关联区块：变更详情页「关联的快速任务」SectionCard（linked_changes 命中本变更的条目，点击跳快速修复 tab）。
- **FR-08** 状态判定（双源统一，前缀匹配+括注进 status_note）：已完成→completed；已暂存→partial_done；进行中>24h→stale；进行中≤24h→in_progress；标题=`(quick 任务)`→placeholder（默认过滤）。

## 非功能需求

- **NFR-01** 解析性能：~500 条量级毫秒级（进程级 mtime 指纹缓存）；单文件 1MB 截断上限。
- **NFR-02** 推送失败不影响 quick 主流程（CLI 侧任何异常静默）。
- **NFR-03** 端点只增不改，旧 CLI（无推送）文件链路全量兼容。
- **NFR-04** Windows/Linux/macOS 兼容（CRLF/路径分隔符）。

## 验收标准

- 真实 QUICKLOG 样本（本仓 10 文件 ~500 条）解析零异常，状态/负责人/关联/文件括注正确；
- 带令牌 POST 后平台列表即时出现该条目（无需等 daemon 同步）；
- 快速修复 tab 全功能可用，空壳默认隐藏，进行中条目 30s 自动刷新；
- 变更详情页可见关联 quick 区块且可互跳；
- backend pytest 新增用例全绿 + 既有测试零回归；frontend vitest + tsc 零错；gen:types 同步提交。
