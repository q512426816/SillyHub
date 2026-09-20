
## ql-20260920-001-1bf6 | 2026-09-20 12:45:00 | db.sqlite token 可得性实证（2026-09-20-agent-log-session-replay task-04 前置）
状态：已完成
关联变更：2026-09-20-agent-log-session-replay
文件：.sillyspec/changes/2026-09-20-agent-log-session-replay/evidence-dbsqlite-probe.md（证据档案）；sillyhub-daemon/src/agent-log/read-zcode-sqlite.ts（透传落地）
需求：task-04 前置——判定 zcode 持久库 db.sqlite 中 token 数据可得性（可得→读取器透传/不可得→缺省）
根因：（无缺陷——设计期实证任务，防「盲实现透传」或「盲缺省」两错）
方案：mode=ro 只读连接 ~/.zcode/cli/db/db.sqlite，PRAGMA 核列 + 样本抽取
结果：**可得（多源）**——model_usage 表 per-call 全字段（assistant_message_id 1:1 实证 144701/144702、input 已含缓存读与 rollout 口径一致）、turn_usage 表 user_message_id→turn_id、part step-finish tokens、message.data model 双拼键；透传按证据档案「透传设计落点」节实现，read-zcode-sqlite 25 用例绿（T1 可得命中/T2 不可得缺省/T3 DROP 表不炸）
