# 符号影响面报告（execute Step 2）

调用点搜索命令：rg "injectSession(" / "SessionInputBar" / "UserTurnInput" / "mapUserTurnInputToSdk" / "SessionInjectRequest" 于 frontend/src、sillyhub-daemon/src、backend/app。

| task | 变更类型 | 受影响调用点 | 是否在范围 |
|---|---|---|---|
| task-01 | 新表 + 加列（新增） | 无既有符号变更（llm_providers.multimodal 为新列，ORM 默认值兼容旧行） | ✅ 无签名级变更 |
| task-02 | 新文件（新增） | 无调用点 | ✅ 纯新增 |
| task-03 | 新模块四文件 + main.py 注册两行 | main.py include_router 区（在 allowed_paths） | ✅ 纯新增 |
| task-04 | 既有 router.py 加端点（同文件追加） | 无外部调用点（新端点） | ✅ 纯新增 |
| task-05 | SessionInjectRequest 加可选字段 attachment_ids | 引用方：daemon/router.py（DTO 解析自动兼容，无需改）、daemon/tests/test_change_session.py（可选字段不破坏既有断言）。capability.py 新文件 | ✅ 可选字段叠加，卡外调用方零改动（不改原因：FastAPI 可选解析 + 前端未传字段缺省） |
| task-06 | session/service.py 内部组装扩展 | _inject_into_session 私有路径 | ✅ 内部实现 |
| task-07 | SessionInjectPayload 加可选 attachments | 消费方 daemon.ts（task-09 范围内）；旧 daemon 忽略新字段 | ✅ 协议向后兼容 |
| task-08 | 新文件 + main.py lifespan 挂载 | main.py（task-03 也改但跨波串行） | ✅ 挂载点在范围内 |
| task-09 | UserTurnInput 加可选 blocks/filesToFetch | 构造方：session-manager.ts（范围内）；input-queue.ts（仅类型传递不改）；codex-app-server-driver.ts（不读新字段——constraints 已注明兜底）；daemon.ts WS 透传（范围内） | ✅ 可选字段叠加；codex 忽略为设计内（D-6 三层门控） |
| task-10 | mapUserTurnInputToSdk 内部 content 形态 | 唯一调用点 claude-sdk-driver.ts:413（同文件内） | ✅ 内部函数 |
| task-11 | api-types 重生成 + 新 API 文件 | 消费方 task-12/13（范围内） | ✅ 纯新增 + 生成产物 |
| task-12 | SessionInputBar props 可选扩展 + injectSession 可选参数 + page.tsx 接线 | injectSession 卡外调用方：interactive-session-panel.tsx、session-config-bar.tsx（可选参数不传即旧行为，零改动）；SessionInputBar 卡外使用方：interactive-session-panel.tsx（props 可选默认关闭附件入口，零改动） | ✅ 可选叠加，卡外调用方零改动（不改原因：向后兼容默认值）；宿主接线 sessions/page.tsx 已核入 allowed_paths |
| task-13 | turn-timeline 用户气泡渲染 + helpers 纯函数 | 渲染点 turn-timeline.tsx（范围内） | ✅ 内部渲染 |
| task-14 | 测试文件（新增为主） | turn-timeline-session-input-bar.test.tsx 既有断言同步（在 task-12 allowed_paths 已声明 related_tests） | ✅ 测试归属已声明 |
| task-15 | 文档 + 部署验证 | module-impact.md / 模块卡（范围内） | ✅ 无代码变更 |

结论：无阻断项。全部卡外调用点均为「可选参数/可选字段叠加」的向后兼容变更，零改动是设计内行为（D-6 门控与协议向后兼容已覆盖）。
