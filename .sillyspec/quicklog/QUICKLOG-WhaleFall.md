
## ql-20260818-003-14d3 | 2026-08-18 09:52:53 | 切档案后人格实际不生效
状态：已完成
关联变更：（无）
文件：（见实际改动）
需求：切档案后人格实际不生效。
根因：SDK systemPrompt 选项 resume 时被 CLI 忽略（jsonl 固化，人格热切换从未生效过）；另有等值+空 prompt 落普通 inject 致 run 卡 pending 堵死会话。
方案：带人格 reload 走 forkSession=true（fork 新会话使 system prompt 生效+历史复制）；forkedInitPending 标记让 init 新 session_id 更新 state；driver 透传 forkSession/extraArgs；后端等值+空 prompt 409 拒绝；reload 吞错补日志。
结果：E2E 实证模型自报「当前会话角色：智能体档案设计师」；daemon 21+43 用例过、全量 2364（2 失败=既有基线+抖动）；后端 802 过。backend+daemon 已在运行环境生效，待 commit+push。
