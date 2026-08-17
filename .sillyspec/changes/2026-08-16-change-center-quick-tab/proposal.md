---
author: qinyi
created_at: 2026-08-16 23:20:00
change: 2026-08-16-change-center-quick-tab
status: draft
---

# 提案（Proposal）— 变更中心「快速修复」tab

## 一句话

在变更中心新增「快速修复」tab，把 sillyspec quick 操作（QUICKLOG）以条目级结构化展示，并给 quick CLI 增加对齐变更范式的平台直推链路——quick 一启动平台即时可见。

## 问题

1. **无展示**：quick 不建 changes/ 目录，变更中心（唯一自然的"agent 干活记录"入口）完全不含 quick；唯一展示位是「知识&日志」页按文件列原始 markdown，无状态、无进度、无关联，等于不可用。
2. **不及时**：QUICKLOG 文件靠 daemon 会话级同步（会话结束/下次回灌），quick 落盘到平台可见存在会话粒度延迟；完整变更已有 CLI 直推（triggerSync → POST /api/changes/{name}/progress），quick 没有对等链路。
3. **数据形态没人管**：QUICKLOG 是非结构化 markdown（轮转文件/全半角冒号/状态 4 形态/空壳占位/死会话残留），平台侧从未解析。

## 方案（已过 Design Grill，review pass）

双链路：
- **推送链路**：sillyspec CLI 在 quick 启动/完成两触发点 best-effort POST 条目 JSON 到平台 `POST /api/quicklog-entries`（shpsync_ 令牌鉴权、workspace 由 token 派生、(workspace_id, ql_id) 幂等 upsert 落 PG quicklog_entries 表）——即时性。
- **文件链路**：平台 change 模块新增解析器直读 spec_root/quicklog/（daemon 已同步的镜像），全目录扫描 + ql-ID 去重——兜底与旧 CLI 兼容，daemon 离线也可看（与变更列表同机制）。
- **展示**：列表=双源合并（PG 优先）；变更中心第三 tab（4 态状态徽标/负责人 enrich/影响模块推导/全文搜索/空壳过滤/进行中 30s 轮询）+ 抽屉详情（四段正文+文件括注+关联变更跳转）+ 变更详情页反向「关联的快速任务」区块。

## 不在范围内（Non-Goals）

- 3 步步骤级活体进度（`.runtime/quick-sessions/` 不上传）
- 代码 diff、耗时统计（数据源无）
- 知识&日志页现有快速日志 tab 改造（保留并存）
- quick CLI ↔ daemon 实时联动通知
- 平台侧主动写回 QUICKLOG 文件（会撞 daemon 增量同步 base_version 乐观锁，禁止）

## 收益

- quick 操作从"完全不可见"变为"即时可见 + 可检索 + 可追溯（双向关联）"；
- 中断/空壳 quick（实测 11 条死会话 + 21 条占位）首次可被系统性暴露；
- CLI 推送范式对齐变更，为后续 quick 步骤级进度等演进铺路。

## 成本与风险

- 跨仓改动：sillyspec CLI 1 文件（两触发点+POST helper），依赖其发版节奏（未发版期间文件链路先交付全部展示能力）；
- 新表 + migration（项目未上线，无历史兼容负担）；
- 解析器面对自由文本 markdown 的健壮性（宽松解析 + 真实样本 fixture 测试兜底）。
