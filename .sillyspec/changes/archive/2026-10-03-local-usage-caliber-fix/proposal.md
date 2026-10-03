---
author: flow-machine-draft
created_at: 2026-10-03T05:43:23.068Z
---
# 提案书（Proposal）— 2026-10-03-local-usage-caliber-fix

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:a3515eb71ebd065b677a3a5c7b6894dde6bcc8d21e284a6ac43266c75534fd99:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-local-usage-caliber-fix 留痕重锚 -->
任务原话转写：修复变更中心本地 CLI 用量口径缺陷（用户验收 2026-10-02-change-center-token-usage 时发现）：ZCode 日志 inputTokens 实证含缓存命中部分（113/113 恒满足 total=input+output），现有命中率公式分母重复计入缓存读取导致命中率被腰斩（49.6%，实际约 98.3%）；且时间三元组/请求次数当时裁定不展示，但库内 first_seen/last_seen（上报观察时间）与 invocations（CLI 累计调用计数）数据现成。
成功标准：
- 摄取落库口径归一：usage_input_tokens 存「输入−缓存读取」（非缓存输入，与平台 agent_runs 口径对齐），max(0,...) 防负；注释锚定 113/113 实证
- 命中率展示归正：归一后既有公式自动正确（缓存读取/(缓存读取+输入)≈98%）
- 本地段参与时间三元组：开始=MIN(first_seen)、结束=MAX(last_seen)、耗时含跨度（ISO 字符串字典序比较）；混合场景与 run 段取 MIN/MAX、耗时相加
- 请求次数：本地段 SUM(invocations) 并入 api_requests
- 注脚声明口径（输入=非缓存输入；时间为上报观察跨度；请求次数含 CLI 计数）
- 轮次维持 0（无来源）；覆盖写幂等使活跃日志下次上报自动重算
- 聚焦测试全绿：test_usage_ingest + test_usage_stats + change-usage-card
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:38c13f15f4501133447965004f2cab7955ef989b5fbc0f1ebebbafaa965265af:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-local-usage-caliber-fix 留痕重锚 -->
按成功标准机械推导，共 12 条验收面：
1. 摄取落库口径归一：usage_input_tokens 存「输入−缓存读取」（非缓存输入，与平台 agent_runs 口径对齐），max(0,...) 防负
2. 注释锚定 113/113 实证
3. 命中率展示归正：归一后既有公式自动正确（缓存读取/(缓存读取+输入)≈98%）
4. 本地段参与时间三元组：开始=MIN(first_seen)、结束=MAX(last_seen)、耗时含跨度（ISO 字符串字典序比较）
5. 混合场景与 run 段取 MIN/MAX、耗时相加
6. 请求次数：本地段 SUM(invocations) 并入 api_requests
7. 注脚声明口径（输入=非缓存输入
8. 时间为上报观察跨度
9. 请求次数含 CLI 计数）
10. 轮次维持 0（无来源）
11. 覆盖写幂等使活跃日志下次上报自动重算
12. 聚焦测试全绿：test_usage_ingest + test_usage_stats + change-usage-card
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:b7c40fb1eea6ea4e2063ecd5fc5cb505a4c916d2b08b9778cc162c27ccbc9e94:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-03-local-usage-caliber-fix 留痕重锚 -->
1. 摄取落库口径归一：usage_input_tokens 存「输入−缓存读取」（非缓存输入，与平台 agent_runs 口径对齐），max(0,...) 防负
2. 注释锚定 113/113 实证
3. 命中率展示归正：归一后既有公式自动正确（缓存读取/(缓存读取+输入)≈98%）
4. 本地段参与时间三元组：开始=MIN(first_seen)、结束=MAX(last_seen)、耗时含跨度（ISO 字符串字典序比较）
5. 混合场景与 run 段取 MIN/MAX、耗时相加
6. 请求次数：本地段 SUM(invocations) 并入 api_requests
7. 注脚声明口径（输入=非缓存输入
8. 时间为上报观察跨度
9. 请求次数含 CLI 计数）
10. 轮次维持 0（无来源）
11. 覆盖写幂等使活跃日志下次上报自动重算
12. 聚焦测试全绿：test_usage_ingest + test_usage_stats + change-usage-card
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
