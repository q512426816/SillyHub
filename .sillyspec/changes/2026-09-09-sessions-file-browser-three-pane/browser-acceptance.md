---
author: qinyi
created_at: 2026-09-09T01:50:00
---

# 浏览器验收记录（task-04）— 会话页三分屏

环境：worktree dev server http://localhost:3100（NEXT_PUBLIC_API_BASE_URL=127.0.0.1:8001，会话 token 自 3001 源复制，1600×900 视口）。

## 已实测通过（DOM 级断言）

| 场景 | 结果 |
|---|---|
| ② 全局 /sessions 无选中 → 「查看工作区文件」disabled | ✅ 快照断言 `button "查看工作区文件" [disabled]` |
| ② 选中带工作区的会话 → 按钮翻转为可点 | ✅（选中「首响性能验证」后无 disabled） |
| ① 点 📁 进文件模式 | ✅ 「返回会话」按钮 + 「工作区文件」标题 + 文件搜索框挂载，SessionListPanel 卸载，中栏会话面板（#4ea41ed7）不受影响 |
| explorer 降级（daemon 离线 502） | ✅ 文件树显示设计内降级卡「本机守护进程当前离线，无法浏览文件…重试」（R-02） |
| ① 「← 返回会话」复原 | ✅ 会话列表回归、文件模式头卸载 |
| ④ 左把手拖宽 | ✅ 320px → 440px，localStorage `sillyhub.sessions.leftPanelWidth`=440 |
| ④ 双击复位 | ✅ 回 320px，存储同步 320 |
| 把手无障碍 | ✅ separator「调整会话列表宽度」在快照中 |

## 环境限制（未实测，由测试覆盖）

- **点文件开预览列/✕ 关列/切回保留**：本机全部 daemon 离线（已尝试注册临时本地 daemon——HTTP 注册成功但 WS 心跳静默未建立，机器恒 offline，已停止并删除临时 API Key），explorer 无数据可点。该链路由 sessions-portal.test 新增 12 用例（mock explorer 两组件，六组场景含开列/关列/保留/深链翻转）+ portal-file-panels.test 7 用例（mock lib/explorer，真实渲染 FileExplorer/FilePreview）覆盖；组件与工作区 explorer 页（生产已验证）完全同源。
- 深链 ?session= 翻转：测试覆盖（deferred mock 验证「置灰→可点」暂态）；实测等价路径（列表选中翻转）已通过。

## 静态与回归（worktree 实跑）

- vitest 六文件 226 用例全绿：sessions-portal 51（39 既有 + 12 新）、portal-file-panels 7、session-list-panel 100（单跑权威计数）、explorer 页 22、floating-session-host、agent-log-card 54 合计。
- tsc --noEmit：我方 5 文件 0 新增错误（workspace/__tests__/changes-overview-card.test.tsx 2 个并行会话在途预存错误）。
- eslint 5 文件：0 error / 1 warning（`(path: string)` 契约逐字签名，file-explorer.tsx:58 预存同款先例）。
