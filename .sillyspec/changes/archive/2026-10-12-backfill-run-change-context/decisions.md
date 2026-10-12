---
author: flow-machine-draft
created_at: 2026-10-12T08:13:29.541Z
---
# 决策记录（Decisions）— 2026-10-12-backfill-run-change-context

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：同一 submit 批次（timestamp 全同）内多条不同绑定命令时，批内消息序在 DB 无可靠序号（无 seq/created_at 列，id 为 uuid4）——「最后一条生效」在该面内取边近似随机，其后 NULL run 可错锚且被幂等固化。缓解：解析出不同绑定目标的并列组计入 ambiguous_parallel_groups 显式暴露（dry-run 报告可见、人工可查该 run 日志），真实数据面极窄（同一轮内既 done X 又 start Y 的形态罕见）；次风险：content_redacted 密钥脱敏破坏命令 JSON 可解析性（脱敏在字符串值内替换，结构破坏概率极低），解析失败静默计数（logs_parse_failed）不中断。首命令轮保持 NULL（与运行时一致）的 ≤1 轮切换误差已在上一变更裁决可接受。 试过但放弃： - 用 change_session_links 的链接建立时间做归属——链接只有会话粒度无轮粒度，退化回旧口径；弃。 - 从 platform_agent_logs 水位差分重算——那是本地 CLI 通道，会话有 run 即被防双计谓词排除，不适用平台会话；弃。 - 回填时创建缺失 Change 的 placeholder 行——回填应无副作用超集，缺行意味着变更已删，静默跳过计数更诚实；弃。
