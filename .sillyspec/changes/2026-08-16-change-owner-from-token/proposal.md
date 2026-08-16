---
author: qinyi
created_at: 2026-08-16 07:52:00
---
# 提案书（Proposal）

## 动机

变更责任人（owner）目前只在代理写路径填充，进度上行不更新；列表只显示 UUID 前 8 位；多 agent/多用户协作中责任人交接平台无感知无记录。而 token 鉴权已派生签发人真实身份，只是被丢弃。

## 关键问题

1. **身份在手里却不用**：push_progress 的鉴权依赖已解析出 token 签发人 User 对象，router 丢弃不用。
2. **无变化留痕**：owner 交接无任何记录，履历中不可见"谁在何时交给谁"。
3. **展示不可读**：UUID 前 8 位对人类无意义。

## 变更范围

- 新表 `change_events`（通用事件模型，event_type+JSONB detail，可扩展）。
- push_progress 接受分支：diff 更新 owner_id + 变化写事件（savepoint 原子，best-effort）。
- enrich 批量 join users 填 owner_name；时间线合成事件条目（kind=step|event）。
- 前端：owner 列显示用户名；时间线事件专属样式；**履历明细不截断**（用户追加需求，仅列表摘要保留截断）。

## 不在范围内（显式清单）

- 不改 sillyspec CLI / daemon
- 不做 owner 手工指派 UI
- 不回填存量变更历史 owner
- 不做事件表管理/删除接口（append-only）
- 不实现 owner_change 以外的事件类型（只留扩展点）

## 成功标准（可验证）

- 两个不同 token 用户先后上行同一变更 → owner 为后者，时间线出现"A → B"事件条目。
- 同用户重复上行 → 零事件零写（幂等）。
- 首次上行（占位行）→ owner 填充但无事件。
- 列表/详情显示用户名；从未上行的变更显示 — 降级。
- 时间线明细内容全量展示不截断；列表摘要保持 ~200B。
- 既有测试全绿，gen:types 重生成。
