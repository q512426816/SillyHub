---
id: task-06
title: typing presence and audience realtime channels
title_zh: 实时通道——typing/presence/受众事件
author: 'qinyi'
created_at: 2026-09-02 00:35:00
priority: P0
depends_on: ['task-02']
blocks: []
requirement_ids: [FR-12, FR-13]
decision_ids: [D-012@v1]
expects_from:
  task-02:
    - needs: [group service 与群会话流端点（群 SSE 校验分支）]
provides:
  - contract: typing SSE 事件流与 presence
    fields: [typing 事件 payload member_name/preview, online_member_ids, audience_user_ids]
allowed_paths:
  - backend/app/modules/daemon/group/router.py
  - backend/app/modules/daemon/group/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/session_events.py
  - backend/app/modules/agent/service.py
  - backend/app/modules/daemon/tests/test_group_realtime.py
goal: >
  群 SSE 生成器多路订阅合流（群消息 + typing 同流）+ typing 端点与 agent typing 自动事件 +
  presence 在线绿点 + agent_sessions:changed 受众过滤（FR-12/13，D-012@v1）。
implementation:
  - 群 SSE 生成器双订阅 agent_session:{群id} 与 group_typing:{群id} 两频道合流进同一 SSE 流（事件 event=typing 区分）；生成器取消时两订阅都释放防泄漏（对照现有单订阅清理路径）
  - typing——POST /api/group-chats/{id}/typing 端点（前端 250ms 节流、preview ≤400 字、TTL 2.5s，仅广播 typing 状态+昵称+可选草稿预览）；不落库不进 AI 上下文不进群摘要；影子 run 开始时后端自动发 agent typing（「昵称」正在输入…）
  - presence——group_presence:{群id}:{用户id} key TTL 60s，SSE 生成器循环每轮 keepalive 周期 touch 续期；群列表/详情返回 online_member_ids（读 group_presence 前缀 keys）
  - audience——session_events publish_sessions_changed payload 增 audience_user_ids（群事件=全部用户成员 id 内嵌，免每事件查库）；daemon/router.py _stream_sessions_events 过滤改 payload.user_id 命中或 audience_user_ids 包含当前用户
  - 自带 pytest app/modules/daemon/tests/test_group_realtime.py——typing TTL 过期/presence touch 续期/audience 投影过滤/双订阅取消释放
acceptance:
  - 两浏览器同看群各收 typing 与消息流（同一 SSE 连接双频道合流）
  - typing 草稿不落任何库表不进 AI 上下文不进群摘要
  - 成员面板绿点随 SSE 在线变化（presence touch 续期、断线 60s 过期）
  - 群事件全员收到列表刷新信号（audience 过滤命中全部用户成员）
verify:
  - cd backend && uv run pytest -q app/modules/daemon/tests/test_group_realtime.py
  - cd backend && uv run ruff check app && uv run mypy app
constraints:
  - typing/presence 纯 ephemeral（Redis TTL 自清理，不落库不进 AI 上下文）
  - 单聊 SSE 路径零改动（仅群分支多路订阅）
  - 双订阅释放必须有测试（防 Redis 连接泄漏）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
