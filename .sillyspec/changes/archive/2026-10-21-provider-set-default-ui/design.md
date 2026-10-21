---
author: flow-machine-draft
created_at: 2026-10-21T03:16:10.861Z
---
# 设计记录（Design Record）— 2026-10-21-provider-set-default-ui

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

两件事：① 把 2026-08-20（ql-20260820-006）从 /settings/providers 删除的「设为默认」UI 加回来——后端 `set-default` / `unset-default` 端点与 claim 端 `_inject_provider_config` 用户默认优先链健在（当时只删了前端入口），`lib/api/llm-providers.ts` 加回 API 封装、`llm-provider-list.tsx` 加「设为默认 / 取消默认」按钮与默认徽标，修复「会话不选供应商=本机凭证」的根因（is_default 无 UI 可设）。② 按用户 2026-10-21 拍板（决策 D-002，否决 D-001 保留倾向）：`service.set_default` / `unset_default` **移除热切换推送**（删 `_dispatch_provider_switch` 调用与私有 helper）——默认变更仅对新会话生效，运行中会话独立保持原供应商；`notify_provider_switch` 模块与 daemon 侧 WS 消费链保留不动（独立测试锚定，docstring 标注无生产调用方，供后续会话级热切换复用）。

与当初删除版的差异（有意）：文案从「启动/停止」改为「设为默认 / 取消默认」（与档案侧后续「设为默认」统一）；表单「保存后立即启动」勾选**不**恢复（列表行内操作已覆盖，最小化功能面）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `frontend/src/lib/api/llm-providers.ts`：新增 `interface SetDefaultResult { switched: boolean; affected_sessions: number; error: string | null }`（对齐后端 schema.py `SetDefaultResult`，schema 三字段不变）+ `setDefaultProvider(id)`（`POST /api/llm-providers/{id}/set-default`）+ `unsetDefaultProvider(id)`（`POST .../unset-default`）。
- `backend/.../llm_provider/service.py`：`set_default` 删 step-3 推送（`affected_sessions` 恒 0）；`unset_default` 删尾部推送；删私有 `_dispatch_provider_switch`。`SetDefaultResult` 响应形态不变（`affected_sessions` 语义从投递计数变为恒 0）。
- `llm-provider-list.tsx`：新增 `handleSetDefault` / `handleUnsetDefault`（调 API → `switched` 分支 toast「已设为默认，新会话生效」/error → reload）；行内按钮与徽标。claim 注入链、`LlmProviderRead.is_default` 字段、其余 API 形态**零变化**。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/lib/api/llm-providers.ts | 加回 SetDefaultResult / setDefaultProvider / unsetDefaultProvider |
| 修改 | frontend/src/components/llm-providers/llm-provider-list.tsx | 设为默认/取消默认按钮、默认徽标、handlers、说明文案与顶部注释更新 |
| 修改 | backend/app/modules/llm_provider/service.py | set/unset_default 删热切换推送调用与 _dispatch_provider_switch helper |
| 修改 | backend/app/modules/llm_provider/router.py | set/unset-default docstring 更新（移除即时下发表述） |
| 修改 | backend/app/modules/daemon/lease/provider_switch.py | docstring 标注 2026-10-21 起无生产调用方（保留模块与测试） |
| 修改 | backend/app/modules/llm_provider/tests/test_llm_provider.py | 断言收紧：affected_sessions=0 且 notify 未被调用 |
| 修改 | backend/app/modules/llm_provider/tests/test_router.py | 端点断言 affected_sessions=0 |
| 修改 | frontend/src/lib/api/__tests__/llm-providers.test.ts | API 封装用例（URL/method/返回解析） |
| 修改 | frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx | 交互用例；翻转既有「无启动/停止按钮」断言为设为默认断言 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   成立。列表状态以服务器为单一真相源，每次操作后 reload 收敛；toast 依据当次响应的 `switched`/`error`，不依赖本地推导。移除推送后无异步侧效应，乱序面更小。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   同用户多端同时设默认由后端 `_clear_sibling_defaults` 事务内原子互斥（R-05：同 user×引擎集合至多一行默认），最终态唯一；前端无本地乐观锁，reload 后收敛到服务器真值。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   安全。`set_default` 凭证探测失败时后端不改 `is_default`（D-003 保留），前端收到 `switched=false` 仅 toast 不刷新状态；操作中途组件卸载由既有错误链兜底。运行中会话在新默认置位后完全不受影响（claim 只在会话创建时读默认）。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   不会。`is_default` 互斥粒度为 (user_id, agent_kind 集合)，claim 按会话引擎匹配默认行——用户级隔离，不跨用户/工作区串台；本变更不动该粒度。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：热切换移除后，正在依赖「换默认=活跃会话跟随切换」的隐含用户预期落空——但该预期自 2026-08-20 UI 删除后已无入口存在两个月，实际无人在用，风险可忽略；toast 文案「新会话生效」明示语义。次风险：`_dispatch_provider_switch` 删除后若未来要恢复热切换需回溯本变更（有 change.patch 审计件）。

决策 D-002（最终）：用户拍板移除热切换、仅新会话生效（否决 D-001 的「保留+透明化」倾向）；`notify_provider_switch` 与 WS 消费链保留为无生产调用方的基础设施（test_control_command_dispatch.py 直测函数本身，仍绿）。

死路：D-001「保留热切换 + toast 透明化 affected_sessions」——被用户显式否决；删除 provider_switch.py 模块及其直测用例——放弃：扩大测试改动面，且该链路是未来会话级热切换的现成基建，标注保留优于删除；恢复表单「保存后立即启动」勾选——放弃：列表行内操作已覆盖，功能面最小化。
