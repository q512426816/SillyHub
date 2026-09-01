# 群聊功能真实 E2E 验证报告（task-10）

---
author: qinyi
created_at: 2026-09-02 04:45:00
change: 2026-09-01-session-group-chat
environment: 本机 Docker Compose（backend/frontend 镜像重建 @commit 08b3a268，PG 迁移 20260902010000 已执行，Redis 真实，宿主机 sillyhub-daemon 在线 ×7 runtime，LLM 出口=平台 llm-providers 智谱 GLM 真实调用）
---

## 验收结论：AC-01~AC-07 全部通过（AC-06 浏览器双开部分受 IAB 自动化环境限制，SSE 事件流已实测）

| AC | 结果 | 证据摘要 |
|---|---|---|
| AC-01 @触发+流式回复+刷新回放 | ✅ | POST /messages（@小码）→ 载体 run 7883cfb8 → 影子懒建 891b7bc8（grants 授权放行 borrowed）→ daemon 真实执行 Claude Code → GLM 真实回复投影回群（投影行 metadata 含 member_id/member_name/source_log_id/projection=true，身份=小码）；SSE 流实测：log 事件（sender_member_name）+ typing + turn_completed（member 三字段）+ run_error 四类帧；未 @ 消息 triggered=[] 零触发；回放读库与实时事件同 log_id（投影行 id 去重机制）；浏览器刷新后群聊分区渲染群行（成员头像堆叠 小/小/系 + 群名 + 最后消息摘要——回放数据接通） |
| AC-02 @全体广播+独立记忆 | ✅ | @全体 → mention_all=true → 小码+小测双触发（小码复用影子 891b7bc8、小测懒建 46329698，各自独立 run）；小测首轮 Codex 引擎 LLM 出口卡死（环境问题）→ 机器组热切换重建后正常回复 |
| AC-03 互@协作 | ✅✅ | 干净互@全链路：用户消息只 @小码 → 小码回复自主生成「@小测 负责测试的那位同事，管理员喊你来报个到～」（含群背景感知：记得小测报过到）→ 互@检测触发小测 → 小测回复「来啦来啦～我是小测…小码的代码写得好不好得先过我这关😎」；护栏实证：同链同成员去重（用户消息文本含@小测+小码回复再@小测 → 仅触发一次）+ 忙轮排队（queued=true，队满/重建清理符合设计） |
| AC-04 配置热切换 | ✅ | 模型组：PATCH llm_provider_id=智谱GLM → 下轮生效（第二轮回复为 GLM 内容且延续记忆——记得成员列表）；机器组：PATCH runtime+provider+llm → shadow active→pending+指针清空（影子重建、记忆重置语义）→ 再触发懒建新影子 14b79822 立即回复 |
| AC-05 权限三层边界 | ✅ | 非 workspace 用户 → 403（平台层）；workspace 普通成员（developer）非群成员 → 群详情/日志/发消息全部 404（不泄露存在性）；workspace 所有者/平台超管 → 200（admin 兜底设计内）；入群后 → 200 |
| AC-06 typing | ✅（流）| SSE 流实测 typing 事件（member_name=小码/member_kind=agent/typing=true，agent 触发自动事件）；typing 端点 publish group_typing 频道+多路订阅合流进群流（SSE log 抓到 6 次 typing 帧）；草稿不落库不进摘要（DB 零行验证在单测 test_group_realtime）。双浏览器互见 UI 实操受 IAB 自动化点击限制（见环境限制） |
| AC-07 单聊零回归 | ✅ | 会话页 183 个单聊会话正常渲染/操作；daemon 主仓全量 3333 测试全绿（本变更 daemon 源码零 diff）；相关 backend 套件全绿 |

## 过程中抓到并解决的问题
1. **环境**：admin 账号登录按 username 非 email（D-001 纯登录名）；登录滑块由失败计数触发（Redis 清计数恢复）；测试库历史用户均为平台超管（404 验证须造 is_platform_admin=false 新用户）。
2. **环境**：agent 成员 llm_provider 不指定时 daemon 本机默认 LLM 出口 ConnectionRefused → 热切换到平台「智谱 GLM」provider 后真实回复正常（反向验证了六要素中模型要素的必要性）。
3. **环境**：Codex runtime（4b495896）引擎 LLM 出口卡死 → 机器组热切换到 Claude runtime 重建后正常。

## 环境限制声明（非功能缺陷）
- IAB 浏览器自动化的 click 层对本应用系统性超时（Playwright click 含 force、dom_cua、坐标点击均间歇失效），fill/press/快照读可靠。故：建群向导 UI 点击流由 117 个组件测试覆盖 + API 建群实测替代；群聊面板打开后的时间线渲染由 183 个前端测试（含回放身份分组/排序一致/typing TTL/断线 resync）覆盖 + 群分区列表行浏览器实测渲染验证。
- 群消息端点路径为 /api/daemon/group-chats/{id}/messages（design §6.1 前缀偏差已注释锚定，execute 收尾回写 design）。

## 关键证据数据
- 群：8fed7949-28b3-435e-b888-58c6b8317b81「群聊E2E测试组」（workspace b97f8231）
- 成员：小码（agent, 20d04cc0, 影子 891b7bc8）、小测（agent, caa6461c, 影子重建 14b79822）、系统管理员（user/群主 43f2e40a）、二号（user, admin2 邀请验证）
- 真实 LLM 回复样例（智谱 GLM 经平台 llm_provider 下发）：
  - 小码：「你好！我是小码，群里的 Agent 成员之一，主要负责写代码、改代码这类开发协作。我看到的群成员共三位：小码（我，Agent）、小测（Agent）、系统管理员（用户）。」
  - 小测：「来啦来啦～我是小测，负责跑测试、验结果的质量保障岗，小码的代码写得好不好得先过我这关😎」
- SSE 流文件：.sillyspec/.runtime/e2e_sse.log（log/typing/turn_completed/run_error 帧）
