---
author: flow-machine-draft
created_at: 2026-09-26T00:22:26.592Z
---
# 决策记录（Decisions）— 2026-09-26-spec-consistency-writer

## D-001@v1: 风险与死路（design 槽4 收割）
- 决策：最大风险：对账的磁盘 walk 在万级文件树上秒级（rglob 同步 IO 已移线程池，对齐既有范式）——
  低频诊断端点可接受。次生：写方摘要 user:<id>:<email> 无法区分「daemon 服务身份」与「人」——当前
  鉴权解析后都是 User；daemon 轨道身份细分（runtime_id）留待 auth 层提供 principal 类型后增强。放弃：
  ①对账进周期任务+告警——先给手动端点验证口径，自动化等消费面确认；②三向含「本地树」（daemon 侧）
  ——平台看不到本地树，属 daemon 侧职责，分界清晰。
