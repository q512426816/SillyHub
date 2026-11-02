---
author: flow-machine-draft
created_at: 2026-11-02T11:31:13.136Z
---
# 决策记录（Decisions）— 2026-11-02-group-member-footer-config

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是 config_snapshot「model」键语义切换的兼容面——现值为供应商名（错位），改存真实模型名后，前端 chips 与 multimodal gate（shadow.py:832）消费口径随之归正，但若有未盘点消费方按「供应商名」解析该键会读错。缓解：盘点 config_snapshot.model 全部消费点（前端 chips、shadow gate）随本变更一并切换；daemon 侧不消费该键（模型走 lease metadata）。次风险：thinking_level 引擎门控口径——pi/codex 的档位支持差异照 session-config-bar 既有 caps 判定复用，不另造词表。放弃的方案：①model/thinking_level 存 config_snapshot JSON 而非独立列——快照定位是展示冗余（组装自关联行），源数据入 JSON 会延续「快照当真值」的错位（本次正是要修它）；②整体替换三表面为 session-config-bar 复用——该组件绑会话 inject 暂存语义（running/ended/暂存态），成员表单是静态配置提交，硬套会引入无关状态面。
