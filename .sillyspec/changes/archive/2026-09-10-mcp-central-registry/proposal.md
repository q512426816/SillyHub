---
author: qinyi
created_at: 2026-09-10 10:50:06
---
# 提案书（Proposal）

## 动机

平台 MCP 配置目前只是 settings 表两个 KV（`mcp.platform_default` + `mcp.whitelist`，`backend/app/modules/settings/router.py:160`），无独立实体、无分组/标签、无导入、无用户私有配置、无注入诊断。本变更把 MCP server 定义升级为一等资产（中央资产库 registry），对标 ai-toolbox 成熟模式（`docs/research-ai-toolbox-config-management-2026-09-10.md`），配套方案 `docs/proposal-config-management-capability-2026-09-10.md` §3（P0-A）。

## 关键问题

1. **无资产沉淀**：用户想复用一个 MCP 定义（如 context7）只能手抄 JSON，无搜索/标签/模板，团队内无法共享配置。
2. **无私有配置**：带个人 token 的 MCP 无法与平台共享配置共存——KV 是全员同一份，个人凭证被迫交 admin 代管。
3. **无导入与诊断**：散落在各 workspace `.mcp.json` 的存量配置无法反向收编；注入失败（白名单拒绝/类型非法）只在 daemon 本地日志留痕，用户无感知。

## 变更范围

- 新建 backend `mcp_registry` 标准模块：`mcp_servers` / `mcp_server_bindings` / `mcp_templates` 三表 + CRUD + 双层可见性（平台共享/用户私有）+ binding 启用集（D-001/D-002/D-007）
- 注入链换源：daemon 拉取端点 `GET /api/daemon/mcp/config` 从 KV 切 registry 渲染；加可选 `user_id`（lease 归属强校验授权，D-008@v2/D-010）；claim payload 透传 user_id
- 六项能力（D-004）：JSON 粘贴导入 / workspace 扫描导入（同名去重）/ 注入诊断预检（五项，D-011）/ 收藏模板（预置+自存）/ cmd 归一化 / CRUD+标签搜索
- 前端 settings/mcp 页升级为管理页（平台库/我的库双 tab + 诊断面板）
- 旧 `GET/PUT /api/platform-settings/mcp` 端点废弃移除（D-003 零迁移：存量 KV 无真实数据）

## 不在范围内（显式清单）

- 不放行 http/sse 传输（D-005：stdio-only 保持防 SSRF；建模预留枚举）
- 不做 workspace 级 binding（workspace 级继续用 `.mcp.json`，registry 扫描导入吸收不替代）
- 不动 `mcp.whitelist` 治理层（留 settings KV，两层分离）
- 不做 MCP server 健康探测/版本检测、daemon WS 主动推送（D-007 否决项）
- 不迁移 AgentProfile.mcp_refs（正交关系：binding 管池子、mcp_refs 管消费过滤）
- 不做 KV→registry 数据迁移（D-003：无真实数据直接弃）

## 成功标准（可验证）

- daemon 拉取端点无 `user_id` 调用行为与现状 golden 对照一致（`backend/app/modules/daemon/tests/test_mcp_config_endpoint.py` 契约测试）
- 带 `user_id` 调用（合法 lease）返回 platform ∪ user 注入集；无 lease/跨 daemon 返回 404（授权三态单测）
- 非 admin 用户写平台库 403、跨用户读私有库 404（权限矩阵单测）
- 六项能力各有对应单测/集成测试（导入去重 skip-or-rename、诊断五项、模板 seed、cmd 归一化比对）
- secret env 键加密落库（`encrypted_env` 无明文）、列表/详情响应脱敏 `<set>`、daemon 渲染解密回填
- 旧端点删除后前端 `mcp-settings.ts` 调用新端点，`pnpm gen:types` 类型同步提交
