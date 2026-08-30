---
author: qinyi
created_at: 2026-08-27 00:12:30
---

# 模块影响分析（Module Impact）— 会话输入框智能联想（/ 技能指令 + @ 关联变更/快速修复）

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend daemon | 修改 | SessionInjectRequest 加 bind_change_key/bind_quick_id 可选字段；inject 三层透传（router → Facade service.py → SessionService）；SessionService.inject_session 接入幂等 binder（行锁后/tool_report 早退前 + None 守卫）；新增 test_session_service/test_session_router/test_session_queue 用例 |
| backend agent | 修改 | skills_bundle_service._summarize_skills 聚合透传 invoke_name（frontmatter name 原值）；用例并入 daemon/tests/test_skills_bundle.py（既有精确断言同步更新） |
| frontend | 修改 | daemon 组件族——session-input-bar 接入联想（检测/IME/光标回填/onMentionsChange）、session-panel 7 发送点位接线 + placeholder 文案、新增 session-mention-popover；lib——新增 session-mention.ts 纯函数与 session-mention-sources.ts hooks、daemon.ts 透传、custom-skills.ts 手写类型、query-keys.ts 缓存键；api-types/openapi 重生成 |
| sillyhub-daemon | 无变化 | 技能落盘与 slash 解析链路零改动（linkSkillsToWorkdir 既有行为依赖） |

## 未匹配文件

无——design §6 清单全部文件均落在上述模块内。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新 daemon 模块卡（inject bind 字段 + binder 接入点）与 agent 模块卡（manifest invoke_name）条目 | pending（execute/verify 后同步） |
| `modules/frontend.md` | 更新 frontend 模块卡（输入联想组件 + session-mention lib 族 + 类型纪律）条目 | pending（execute/verify 后同步） |
| `_module-map.yaml` | 无变化（未增删模块，仅模块内新增文件） | skipped |
