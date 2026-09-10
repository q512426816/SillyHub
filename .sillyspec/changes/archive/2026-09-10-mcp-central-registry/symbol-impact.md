# 符号影响面报告

> tasks.md 内容指纹（生成时）: db7fe40518795617——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。

- task-01: 无既有签名变更——全新符号（McpServer/McpServerBinding/McpTemplate ORM + 全套 DTO + Alembic revision），不触碰任何既有类/函数签名。
- task-02: 无既有签名变更——全新 McpRegistryService 类；消费 core/crypto.py CredentialCipher.encrypt/decrypt（既有单值接口，按现状调用不改其签名）。
- task-03: main.py 新增一行 include_router(mcp_registry_router)（新增调用点，非签名变更）；router.py 全新符号。无既有函数签名增删改。
- task-04: 无既有签名变更——全新 render.py（render_injection_set/precheck_diagnostics）；只读消费 task-01 模型与 settings KV 读取 helper。
- task-05: **签名级变更 1 处**——backend/app/modules/daemon/router/daemon_rpc.py 的 GET /api/daemon/mcp/config 端点函数新增可选 Query 参数 user_id: UUID | None = None（向后兼容：不传行为不变）；受影响调用方为 daemon HTTP 客户端（task-06 接线，跨仓消费在本变更范围内）。端点内部 _read_mcp_config_raw（workspace 键读取）保留不动。
- task-06: **签名级变更 3 处**——① backend lease/context.py build_claim_payload 返回 dict 新增 user_id/userId 双键（返回结构扩展，旧 daemon 忽略未知键向后兼容，消费方 daemon.ts claim 解析在本变更范围内）；② sillyhub-daemon/src/daemon.ts execPayload 归一化对象新增 user 字段（内部载荷结构扩展）；③ sillyhub-daemon/src/mcp-config.ts fetch 函数新增可选 userId 参数（URL 拼接，缺省不拼）。均在任务范围内。
- task-07: 无签名级变更——纯测试文件（重写 KV-seed 七用例 + 新增 golden/授权三态/回落用例）。
- task-08: 无既有签名变更——全新 importer.py import_from_json；消费 task-02 create_server。
- task-09: 无既有签名变更——importer.py 扩展新函数（scan_workspaces/apply_workspace_import）；复用 daemon_rpc._read_mcp_config_raw 只读调用不改其签名。
- task-10: 无既有签名变更——全新 templates.py；task-02 service.py 若被补 seed 钩子为新增内部函数非签名变更。
- task-11: 前端页面重构（page.tsx 重写为双 tab 管理页）——既有默认导出组件形态保持（Next.js page 约定签名不变）；新组件/新 api 客户端为全新符号；menu-permissions.ts 仅改 menuLabel 字符串值（"MCP 管理"→"MCP 资产库"），无签名变更。
- task-12: 无既有签名变更——全新导入弹窗/诊断面板组件，消费 task-11 框架与 task-08/09/10 端点。
- task-13: **符号删除 2 处**——backend settings/router.py 删除 GET/PUT /api/platform-settings/mcp 两端点函数及 McpServersSchema 引用（消费方 frontend/src/lib/mcp-settings.ts:60-67 的 config 客户端同步删除，whitelist 客户端保留——两消费方均在本变更范围内）；_redact_mcp_env 若仅剩 whitelist 端点消费则保留。模块文档更新无签名语义。
