---
author: qinyi
created_at: 2026-09-16 00:06:44
generated_by: sillyspec-fourpiece-init
change: 2026-09-16-logs-cursor-tiebreaker
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->

## D-001@v1: 游标修复方案——before_id 附加参数 + 块内复合过滤（方案 A）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 同 ts 批次 ≥ 页大小（100）时纯 timestamp 游标停摆（重复拉页+React key 撞号+批内前段行永久不可达），修法四选一？（A before_id 复合过滤 / B 不透明 cursor token / C 前端 only 无进度守卫+去重 / D 全局 (ts,id) 排序 keyset）
- answer: A。backend get_agent_session_logs 新增可选 before_id 查询参数，before_id 非空时过滤改 `(ts < before) OR (ts = before AND id < before_id)`，缺省保持现行 `ts <= before` 旧语义；ORDER BY（run 块序 anchor_ts→ts→id）零改动；openapi/gen:types 同步；前端游标升级 (ts,id) 二元组 + pageKey 追加 id 后缀 + loadEarlierOnce 进度判定二元组化
- normalized_requirement: 同 ts 批次逐页可达、边界行零重叠（严格复合小于）、旧客户端零回归（before_id 缺省分支行为不变）、run 块序与前端轮序派生零影响
- impacts: [FR-01, FR-02, FR-03, FR-04]
- evidence: 用户指令「干这个」（2026-09-16）；step3 四选一与 step5 确认关用户均跳过提问，按架构推荐 A 推进（透明记录为 AI 代确认，verify 阶段仍有验收关卡）
- rationale: ①排序事实排除 D——ORDER BY 是 run 块序（read_model.py:409-414 anchor_ts DESC→ts DESC→id DESC），前端 logsToTurns 按 run_id 首见序定轮序（runtime-session-helpers.tsx:324-334），全局 (ts,id) 序会使轮序随分页窗口漂移；②同 ts 批次来自单 run 事务（submit_messages 批量写），run 块内序恰为 (ts,id)——块内复合过滤天然对齐；③B 契约破坏（before 参数形态改变）无 A 之外收益；④C 只修循环不修可达性（批内前段行仍不可见）；⑤PG uuid 有全序，id 比较 deterministic
- 故障面: WHERE 裸 ts 过滤与 run 块序排序键不对齐是既有已接受局限（跨 run 时间交叠时 ts 游标可跳行）——顺序会话（一会话一活跃轮）不受影响，本变更不扩大该局限（复合过滤仅在块内收紧）
- 退役判据: 若未来日志查询改为全局 (ts,id) 序的专用分页端点或换 cursor token 协议，before_id 参数随 before 一并退役
