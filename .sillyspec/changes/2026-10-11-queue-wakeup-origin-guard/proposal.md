---
author: flow-machine-draft
created_at: 2026-10-11T03:40:33.351Z
---
# 提案书（Proposal）— 2026-10-11-queue-wakeup-origin-guard

## 动机

任务原话转写：排队满员豁免按消息内容前缀判定可被用户伪造（24h 审查 P2）：queue.py 以 prompt.startswith("[后台任务通知]") 判定豁免与计数排除，而 /inject 端点对用户 prompt 零过滤——用户发该前缀消息即可冒充系统通知绕过 5 条额度并落入不可编辑的通知条目。修复：豁免/合并/计数全部改读排队行结构化 origin='task_wakeup'；标记仅由服务凭证（X-API-Key，api_key:admin 签发给 daemon）经请求显式字段携带，Bearer 用户携带该字段直接 403；daemon 唤醒链路随请求携带 origin 标记。
成功标准：
- 用户（Bearer、无 origin 标记）以 [后台任务通知] 前缀发消息：计为普通用户消息占额度，队满第 6 条照旧 QueueFull，不进通知合并
- daemon 服务凭证（X-API-Key + origin=task_wakeup）注入通知：豁免满员、不占用户额度、同 origin pending 行合并不新增行，排队行 origin 落 task_wakeup
- Bearer 请求携带 origin=task_wakeup 字段：403 拒绝（仅服务凭证可标记）
- origin 非 task_wakeup 字面量：422（DTO Literal 校验）
- 通知条目编辑保护改为 origin 结构化判定（兼容存量前缀行 409 不回归）
- 既有 test_session_queue 相关用例改结构化口径全绿，新增伪造/合并/门控用例先红后绿

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. 用户（Bearer、无 origin 标记）以 [后台任务通知] 前缀发消息：计为普通用户消息占额度，队满第 6 条照旧 QueueFull，不进通知合并
2. daemon 服务凭证（X-API-Key + origin=task_wakeup）注入通知：豁免满员、不占用户额度、同 origin pending 行合并不新增行，排队行 origin 落 task_wakeup
3. Bearer 请求携带 origin=task_wakeup 字段：403 拒绝（仅服务凭证可标记）
4. origin 非 task_wakeup 字面量：422（DTO Literal 校验）
5. 通知条目编辑保护改为 origin 结构化判定（兼容存量前缀行 409 不回归）
6. 既有 test_session_queue 相关用例改结构化口径全绿，新增伪造/合并/门控用例先红后绿

## 成功标准（可验证）

1. 用户（Bearer、无 origin 标记）以 [后台任务通知] 前缀发消息：计为普通用户消息占额度，队满第 6 条照旧 QueueFull，不进通知合并
2. daemon 服务凭证（X-API-Key + origin=task_wakeup）注入通知：豁免满员、不占用户额度、同 origin pending 行合并不新增行，排队行 origin 落 task_wakeup
3. Bearer 请求携带 origin=task_wakeup 字段：403 拒绝（仅服务凭证可标记）
4. origin 非 task_wakeup 字面量：422（DTO Literal 校验）
5. 通知条目编辑保护改为 origin 结构化判定（兼容存量前缀行 409 不回归）
6. 既有 test_session_queue 相关用例改结构化口径全绿，新增伪造/合并/门控用例先红后绿
