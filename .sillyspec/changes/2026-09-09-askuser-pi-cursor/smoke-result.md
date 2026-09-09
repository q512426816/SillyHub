# 冒烟与验收记录 — task-13（2026-09-09-askuser-pi-cursor）

> 执行人：主代理（自动化部分）；日期 2026-09-10 凌晨。真机交互项受环境约束部分转人工清单（见 §3）。

## 1. 自动化回归证据（worktree 内全绿）

| 套件 | 结果 |
|---|---|
| backend `test_session_permissions.py`（含影子授权 9 新例） | **41 passed** |
| backend `test_provider_caps_alignment.py`（dialog 键三端对齐） | （含上行 41 内） |
| frontend `askuser-marker.test.ts` | 31 passed |
| frontend `ask-user-dialog-card.test.tsx`（推荐条/关闭态 7 新例） | 29 passed |
| frontend `ask-user-marker-card.test.tsx`（含时间线接入级） | 18 passed |
| frontend `group-chat/`（聚合 10 新例 + panel 57 + member 43） | 110 passed |
| frontend vitest 汇总（6 文件） | **188 passed** |
| daemon `pi-rpc-driver.test.ts`（四态 22 新例） | **73 passed**（两轮稳定） |
| daemon `pnpm typecheck` / frontend `pnpm exec tsc --noEmit` | 双 0 错 |

连带适配：pre-session-picker.test.tsx（caps 键数 8→9）、session-sse/sessions.ts（answered_by_actual_user 透传，13 用例绿）。

## 2. spike 结论（task-05，详见 spike-cursor-marker.md）

**INCONCLUSIVE（额度受阻）**：2/2 有效运行全部合规输出 ```askuser 标记；其余 8 次 CLI 层 `ActionRequiredError: usage limit`（Cursor 免费档）。不触发 D-003@v2 降级；task-08 挂起至额度恢复补测（脚本 %TEMP%/askuser-spike.mjs 已验证可用）。

## 3. 真机冒烟清单（转人工，受环境约束如实记录）

- **pi 一问一答同轮**：需用户环境（daemon 在线 + pi 会话）。步骤：开 pi 会话发一条信息不足指令（如「把配置改一下」）→ 期待 agent 提问弹卡 → 选选项 → 期待 pi 同轮继续。daemon 侧四态已有 73 用例覆盖（上抛/回流/中止/红线），端到端待用户实测。
- **cursor 标记全流程**：受免费额度墙阻（本次 spike 2 次即触顶）——额度恢复后：重跑 spike ≥8/10 → 执行 task-08（prompt 注入）→ 真机验证卡片渲染与续轮。
- **群聊聚合答题**：需群聊会话环境。群主视角：成员提问卡出现在群聊流（含推荐 @条）→ 答题 → 关闭态。已知限制见 §4。

## 4. 已知限制（如实登记，后续另卡）

1. **非群主群成员看不见提问卡**：读侧 list_pending_dialogs 仍 owner/admin-only + 群频道 SSE 不转发 permission 事件——答题端点已放行（task-09）但卡片对非群主不可见。放开读侧需 backend 另卡（自然落点：影子会话 pending 列表群成员可读）。
2. **他答场景关闭态人名缺失**：answered_by_actual_user 在影子会话频道，群面板不订阅——非本端答题时降级「已回答」不带名。
3. **cursor 免费额度现实约束**：Agent 用量极小（2 次/窗口触顶），生产使用需 Pro——独立于本变更的账号问题。
4. task-08（marker prompt 注入）挂起（额度恢复后补测 spike → go 才做）；cursor caps 暂为 marker 初值，若最终 no-go 需三端一行改 none（task-12 已留锚点）。

## 5. 结论

自动化验收面 **PASS**（全部相关套件绿、双端类型 0 错、红线/越权反例覆盖）；真机三项按 §3 转人工/受阻如实记录，不虚报。
