---
author: qinyi
created_at: 2026-09-10 11:07:00
plan_level: full
---

# 实现计划（Plan）— MCP 中央资产库

> Step 1 分类锚点：plan_level=full——13 task / 18 文件跨 backend+daemon+frontend 三子项目 / 新表 schema（三表+partial index）/ daemon claim 链与平台端点联动。
> 受影响模块（module-map 实证）：backend settings / skills / llm_provider / daemon / models / migrations / core(crypto,auth) + frontend(settings/mcp) + sillyhub-daemon(mcp-config,daemon.ts)。
> decisions 当前版本：D-001~D-005、D-007、D-008@v2、D-009~D-011 全部 accepted，无 unresolved/blocking（D-006、D-008@v1 superseded 不引用）。

## Spike 前置验证

不需要。技术方案的关键假设已经 Design Grill 独立审查按源码逐项核验（D-008@v2 即源码事实修正版：daemon.ts 会话级缓存 :1698、context.py build_claim_payload :420-482、crypto.py 单值 Cipher :67-78、lease→user 关联链 daemon/model.py:403→:230）；无未经验证的新技术栈或集成点。

## Wave 1（数据层——表/ORM/DTO）

- task-01

## Wave 2（service 层，依赖 W1）

- task-02

## Wave 3（router 层，依赖 W2）

- task-03

## Wave 4（渲染与诊断，依赖 W1）

- task-04

## Wave 5（daemon 端点换源，依赖 W4）

- task-05

## Wave 6（claim 透传链，依赖 W5）

- task-06

## Wave 7（契约测试，依赖 W5/W6）

- task-07

## Wave 8（JSON 导入，依赖 W2）

- task-08

## Wave 9（workspace 扫描导入，依赖 W8——共享 importer.py 串行）

- task-09

## Wave 10（模板，依赖 W2——与 W8/W9 共享 tests/ 目录串行）

- task-10

## Wave 11（前端框架，依赖 W3）

- task-11

## Wave 12（前端导入与诊断，依赖 W11 与 W8-W10）

- task-12

## Wave 13（收尾，依赖全部）

- task-13

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 数据层：Alembic 迁移 + 三表 ORM + DTO | W1 | P0 | — | FR-01, FR-02, D-001, D-002, D-005 | 三表 + partial unique index + COALESCE sentinel 唯一索引（含 downgrade）；schema.py 全套 DTO（脱敏/输入/绑定/导入/诊断/模板）；encrypted_env {ct,key_id} 结构 |
| task-02 | service 层：CRUD + 可见性 + binding 约束 + 加密读写 | W2 | P0 | task-01 | FR-01, FR-02, FR-03, D-001, D-002 | 权限矩阵（非 admin 平台库 403/跨用户 404）、binding 双 partial 唯一 + scope_ref 归属校验、CredentialCipher 逐键加密/解密 |
| task-03 | router 层：/api/mcp-servers* 端点 + 权限 | W3 | P0 | task-02 | FR-01, FR-03 | 13 端点；平台库写 require_permission_any(SETTINGS_ADMIN)；main.py 注册 |
| task-04 | render.py：注入集渲染 + 诊断预检五项 | W4 | P0 | task-01 | FR-04, FR-08, D-008@v2, D-011 | platform ∪ user 渲染、解密回填、decrypt_failed 降级；五项诊断 |
| task-05 | daemon 端点换源 + user_id 授权 | W5 | P0 | task-04 | FR-03, FR-04, D-003, D-008@v2, D-010 | daemon_rpc.py 换 registry 渲染；lease 归属双校验（无匹配 404）；渲染错误 503；响应三键形状不变；**连带重写 test_mcp_config_endpoint.py 既有 KV-seed 用例**（:109-:227 七用例全部 seed mcp.platform_default 断言 KV 源，换源后失效） |
| task-06 | claim 透传链：user_id 下发与消费 | W6 | P0 | task-05 | FR-05, D-008@v2 | context.py build_claim_payload 加 user_id → daemon.ts execPayload 透传 → mcp-config.ts 请求 URL 加参；会话级缓存结构不动；**含 daemon 侧新增测试**（mcp-config URL 组装 + daemon.ts 透传用例，认领 AC-2） |
| task-07 | 契约测试：golden + 授权三态 + 回落 | W7 | P0 | task-05, task-06 | FR-03, FR-04 | 无 user_id golden 对照旧版响应形状（三键逐字段）；合法/无 lease/跨 daemon 三态；空库空集 + 渲染错误 503 回落链 |
| task-08 | importer：JSON 粘贴导入 | W8 | P1 | task-02 | FR-06, D-004 | mcpServers/servers/mcp 三包装解析；逐条容错；secret 键加密入库（与 task-09 共享 importer.py，wave 内 08→09 串行） |
| task-09 | importer：workspace 扫描 + 去重 + cmd 归一化 | W9 | P1 | task-08 | FR-07, D-004 | 扫描候选（只读）+ apply；同名同配置 skip/异配置改名；dedup_key；cmd /c 剥离比对 |
| task-10 | 模板：seed 预置 + 存为模板 | W10 | P1 | task-02 | FR-09, D-004 | 5-7 个预置模板；从 server 存模板（secret 丢弃提示） |
| task-11 | 前端：api 层 + 页面框架 | W11 | P0 | task-03 | FR-01, FR-03 | pnpm gen:types；双 tab/卡片/binding 开关/搜索标签（照原型 + FRONTEND_PAGE_STYLE.md）；menuLabel 改"MCP 资产库"（menu-permissions.ts）；**连带重写 page.test.tsx**（既有 7 用例 mock 旧 mcp-settings hooks 断言 JSON 编辑器形态，页面重构后失效） |
| task-12 | 前端：导入入口 + 诊断面板 | W12 | P1 | task-11, task-08, task-09, task-10 | FR-06~FR-09 | JSON 粘贴/workspace 扫描/模板三入口 + 诊断五项面板（照原型④⑤） |
| task-13 | 收尾：旧端点移除 + 旧调用切换 + 文档 | W13 | P0 | task-03~task-12 | D-003, D-007 | 删 GET/PUT /api/platform-settings/mcp；frontend mcp-settings.ts 切新端点；mcp_registry.md 模块卡片 + settings/daemon 模块文档 + module-map 更新 |

## 关键路径

task-01 → task-02 → task-04 → task-05 → task-06 → task-07 →（合流 W3/W4）→ task-12 → task-13（daemon 集成链决定最短交付周期；前端链 task-02→03→11→12 与其部分并行，task-04 依赖 task-01 的 model 层即可开跑）

## 全局验收标准

1. backend 相关测试全绿：`uv run pytest app/modules/mcp_registry app/modules/daemon/tests/test_mcp_config_endpoint.py -q`（仅跑相关，CLAUDE.md 规则 0）
2. daemon：`pnpm test`（mcp-config 契约用例 + daemon.ts 透传用例新增后全绿）
3. frontend：`pnpm test` + `pnpm gen:types` 产出提交（api-types.ts + openapi.json）
4. golden 契约：无 user_id 调用响应与旧版逐字段一致（三键 platform_default/whitelist/workspace）
5. 授权三态：合法 lease 通过 / 无 lease 404 / 跨 daemon 404（单测覆盖）
6. brownfield：registry 空库 → daemon 拉取得 `{"mcpServers": {}}` 不阻塞会话创建；渲染抛错 → 503 → daemon 本地回落链可达
7. lint：backend ruff+mypy、daemon typecheck、frontend lint 全过

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001 双层可见性 | task-01, task-02, task-03 | AC-1/5（权限矩阵单测） |
| D-002 独立 binding 表 | task-01, task-02 | AC-1（binding 约束单测） |
| D-003 弃 KV 零迁移 | task-05, task-13 | AC-4/6（旧端点删除 + golden） |
| D-004 全量六项 | task-08, task-09, task-10, task-12 | AC-1（导入/模板/诊断单测） |
| D-005 stdio-only 预留 | task-01, task-02 | AC-1（写路径校验单测） |
| D-007 方案A 新模块+白名单留 settings | task-03, task-05, task-13 | AC-4（whitelist 读取不变） |
| D-008@v2 claim 透传链 | task-05, task-06, task-07 | AC-2/4（透传用例 + golden） |
| D-009 设计整体确认 | 全部 | 全 AC |
| D-010 lease 归属强校验 | task-05, task-07 | AC-5（授权三态） |
| D-011 诊断五项重定义 | task-04, task-12 | AC-1（诊断预检单测） |
