---
author: flow-machine-draft
created_at: 2026-09-30T07:27:52.459Z
---
# 提案书（Proposal）— 2026-09-30-takeover-handoff-any-location

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:5792a1e0c24f73b7e9b0c42059fb50060f399f03c5442559719f4c6913238b31:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-handoff-any-location 留痕重锚 -->
任务原话转写：真机验收后用户裁决：handoff 档（zcode 等无 adapter 会话）接手的执行位置应与「新建会话 · 选择运行位置」完全一致——任意在线机器 × 该机白名单引擎（SESSION_SUPPORTED_PROVIDERS：claude/codex/pi/cursor），而非仅原机引擎；原机仅用于读交接文档（读取失败提示后仍可继续，上下文从新会话起步）。native 档（claude-code/codex resume）仍锁原机不变（D-002 宁拒不猜）。当前实现问题：接手引擎下拉只列原机引擎且未过滤白名单（openclaw/kimi 等不可会话引擎也列出）。
成功标准：
- handoff 档 TakeoverRequest 支持可选 runtime_id（用户所选机器+引擎），服务端校验属主+在线后用作派发位置；缺省保持原四级匹配（原机）不回归
- handoff 档原机匹配失败不再阻塞（显式 runtime_id 时 handoff_doc=false 降级继续）；未传 runtime_id 且原机无匹配仍 409
- 前端 handoff 档选择器为两级（在线机器 → 该机白名单在线引擎），默认预选上报机器；native 档不渲染选择器且仍锁原机
- 接手引擎候选过滤 SESSION_SUPPORTED_PROVIDERS（不可会话引擎不再出现）
- 既有 takeover 用例零回归 + 新增覆盖（runtime_id 显式/原机离线降级/白名单过滤）
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:302840e4208e22792ddc3ba749012f8649f998ba7f8f7f04e1565de87cd595bd:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-handoff-any-location 留痕重锚 -->
按成功标准机械推导，共 8 条验收面：
1. handoff 档 TakeoverRequest 支持可选 runtime_id（用户所选机器+引擎），服务端校验属主+在线后用作派发位置
2. 缺省保持原四级匹配（原机）不回归
3. handoff 档原机匹配失败不再阻塞（显式 runtime_id 时 handoff_doc=false 降级继续）
4. 未传 runtime_id 且原机无匹配仍 409
5. 前端 handoff 档选择器为两级（在线机器 → 该机白名单在线引擎），默认预选上报机器
6. native 档不渲染选择器且仍锁原机
7. 接手引擎候选过滤 SESSION_SUPPORTED_PROVIDERS（不可会话引擎不再出现）
8. 既有 takeover 用例零回归 + 新增覆盖（runtime_id 显式/原机离线降级/白名单过滤）
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:f8a1a9b3cedb166287f50484c3eed345df1ffa329eca9f1f9100d15fb8ca2b5a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-takeover-handoff-any-location 留痕重锚 -->
1. handoff 档 TakeoverRequest 支持可选 runtime_id（用户所选机器+引擎），服务端校验属主+在线后用作派发位置
2. 缺省保持原四级匹配（原机）不回归
3. handoff 档原机匹配失败不再阻塞（显式 runtime_id 时 handoff_doc=false 降级继续）
4. 未传 runtime_id 且原机无匹配仍 409
5. 前端 handoff 档选择器为两级（在线机器 → 该机白名单在线引擎），默认预选上报机器
6. native 档不渲染选择器且仍锁原机
7. 接手引擎候选过滤 SESSION_SUPPORTED_PROVIDERS（不可会话引擎不再出现）
8. 既有 takeover 用例零回归 + 新增覆盖（runtime_id 显式/原机离线降级/白名单过滤）
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
