---
id: task-02
title: 新建 backend/app/modules/llm_provider/usage_handlers.py：balance 路径（DeepSeek /user/balance、硅基 /v1/user/info、OpenRouter /api/v1/credits）+ token_plan 路径（Kimi/Kimi For Coding /coding/v1/usages、智谱 /api/paas/v4/coding-plan/quota、MiniMax /v1/api/openplatform/coding_plan/remains）各家硬编码 query + parser，对照 cc-switch balance.rs/coding_plan.rs 逐家抄准精确字段。返回 list[UsageData]（多 tier）。依赖 task-01。
title_zh: 新建用量查询各家硬编码 handler（balance+token_plan）
author: qinyi
created_at: 2026-07-28 10:37:44
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-03]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/app/modules/llm_provider/usage_handlers.py
provides: []
expects_from:
  task-01:
    - contract: UsageData
      needs: [plan_name, is_valid, total, used, remaining, unit, extra]
goal: >
  实现 7 家供应商用量查询的硬编码 HTTP 调用与响应解析，对照 cc-switch balance.rs/coding_plan.rs
  逐家抄准精确字段，每家 async def query_xxx(client, base_url, headers) -> list[UsageData]，
  多窗口（5h/周/月）各自一条 tier。
implementation:
  - 用 httpx.AsyncClient（timeout=15s，由 task-03 注入）；本文件只负责「请求 + 解析」，返回 list[UsageData]，不做错误两态分类、不做 SSRF（那在 task-03）。
  - balance·DeepSeek: GET {base}/user/balance；解析 balance_infos[].{currency,total_balance}，currency 缺省 CNY；remaining=total_balance, plan_name=currency, unit=currency, is_valid=is_available(缺省 true)。照 balance.rs:116-139。
  - balance·SiliconFlow: GET {base}/v1/user/info（.cn→CNY / .com→USD）；解析 data.totalBalance → remaining，plan_name "SiliconFlow"(/"SiliconFlow (EN)")，unit 按域名 CNY/USD。照 balance.rs:253-278。
  - balance·OpenRouter: GET {base}/api/v1/credits；解析 data.{total_credits,total_usage}，remaining=total_credits-total_usage，total=total_credits, used=total_usage, unit=USD, is_valid=remaining>0。照 balance.rs:323-345。
  - token_plan·Kimi / Kimi For Coding（同 api.kimi.com/coding 子路径，共用一个 handler）: GET {base}/coding/v1/usages；limits[].detail.{limit,remaining,resetTime} → five_hour tier，usage.{limit,remaining,resetTime} → weekly tier。照 coding_plan.rs:148-194。
  - token_plan·智谱 GLM: 真实端点是 {base}/api/monitor/usage/quota/limit（**design §5 写的 /api/paas/v4/coding-plan/quota 是错的，照 cc-switch 源码为准**）；Authorization 头**不加 Bearer 前缀**（裸 key），带 Content-Type + Accept-Language；解析 data.limits[] 中 type==TOKENS_LIMIT（大小写不敏感），按 unit 字段分窗（unit 3→five_hour, unit 6→weekly，缺 unit 走 nextResetTime 升序兜底），percentage 直接作 utilization。照 coding_plan.rs:224-298/373-405。
  - token_plan·MiniMax: GET {base}/v1/api/openplatform/coding_plan/remains（.com.cn / .io）；先查 base_resp.status_code!=0 报错；model_remains[] 取 model_name=="general"（跳过 video）；5h=current_interval_remaining_percent, weekly 仅当 current_weekly_status==1 取 current_weekly_remaining_percent，利用率=100-remaining_percent，重置时间 end_time/weekly_end_time。照 coding_plan.rs:410-491/639-695。
  - tier 表达约定：balance 三家回绝对额（total/used/remaining 是金额，unit=USD/CNY）；token_plan 四家回百分比，映射 total=100/used=utilization/remaining=100-utilization/unit="%"，重置时间（ISO8601）放 extra；解析层忠搬运负数/超100值不裁剪（照 cc-switch 约定，裁剪归前端渲染层）。
acceptance:
  - balance 三家（DeepSeek/硅基/OpenRouter）正常响应解析出 remaining/total/unit 正确；DeepSeek 多币种多 tier、OpenRouter remaining=total-used、硅基按域名分 CNY/USD。
  - token_plan 四家多 tier 正确：Kimi 产出 five_hour + weekly 两条；智谱按 unit 分 5h 窗 + 周窗两条（老套餐仅一条降级 five_hour）；MiniMax general 桶 5h + weekly（status==1 才出周桶）。
  - 智谱端点用 /api/monitor/usage/quota/limit 且 Authorization 无 Bearer；MiniMax 跳 video 桶。
  - 本任务不含 SSRF / 错误两态 / detect_provider 路由逻辑（task-03 负责），handler 入参收 base_url + 已拼好的 headers，parser 对缺字段/非法值不崩。
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/llm_provider/tests/test_usage.py -q --no-cov
  - cd backend && .venv/Scripts/python.exe -c "from app.modules.llm_provider.usage_handlers import query_deepseek"
constraints:
  - parser 字段照 cc-switch 源码（balance.rs / coding_plan.rs）逐家抄，不靠猜；design §5 智谱端点路径有误，以 cc-switch 源码为准。
  - handler 只负责请求 + 解析，不负责错误两态分类 / SSRF / api_key 解密 / detect_provider 路由（均在 task-03）。
  - Kimi 与 Kimi For Coding 同 api.kimi.com 走 /coding 子路径，共用同一 handler；detect 的区分（含 /coding）在 task-03。
  - 不加 migration、不改 schema（UsageData 由 task-01 定义）、不改 router/service。

---
