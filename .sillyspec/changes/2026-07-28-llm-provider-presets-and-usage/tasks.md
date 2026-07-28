---
author: qinyi
created_at: 2026-07-28 10:14:18
---

# 任务清单（Tasks）

> 粗粒度任务清单。Wave / Task 细化、依赖关系、验收点在 plan 阶段（`plan.md`）完成。

## Wave A · 预设供应商模版（纯前端，零后端改动）

- **task-A1**：新建 `frontend/src/config/llmProviderPresets.ts`（10 家预设常量 + `LlmProviderPreset` 类型，抄 cc-switch `claudeProviderPresets.ts` 的 settingsConfig env 块）
- **task-A2**：`llm-provider-form.tsx` 顶部加预设选择器（网格 + 分类排序 官方/国内官方/聚合站 + 点预设 setState 填表单 + ＋自定义入口 + 💰可查用量标记）
- **task-A3**：预设数据测试（可选，plan 阶段定是否单列 `config/__tests__/llm-provider-presets.test.ts`）

## Wave B · 用量查询（后端代查 + 前端展示）

- **task-B1**：`schema.py` 加 `UsageResult` / `UsageData` / 用量错误类 schema
- **task-B2**：新建 `usage_handlers.py`（balance: DeepSeek / 硅基流动 / OpenRouter；token_plan: Kimi / Kimi For Coding / 智谱 / MiniMax —— 硬编码 query + parser，对照 cc-switch `balance.rs` / `coding_plan.rs` 逐家抄准）
- **task-B3**：`service.py` 加 `query_usage` + `detect_provider(base_url)` + 错误两态（瞬时 raise / 确定性 success:false）+ SSRF 复用 `assert_public_hostname`
- **task-B4**：`router.py` 加 `POST /{id}/usage` 端点（owner 级 `get_current_user`）
- **task-B5**：`lib/api/llm-providers.ts` 加 `queryUsage(id)` + `UsageResult` / `UsageData` 类型
- **task-B6**：新建 `usage-footer.tsx`（多 tier 余额条 + 翻红 + 保留上次成功值 10 分钟 + 不支持文案，照 cc-switch `UsageFooter.tsx`）
- **task-B7**：`llm-provider-list.tsx` 每行挂 `usage-footer` + 「查余额」按钮 + 进页面自动查一次
- **task-B8**：后端测试 `test_usage.py`（mock httpx：每家正常 / 401 / 404 / 超时 / SSRF / detect 识别 / 多 tier 解析）
- **task-B9**：前端测试 `usage-footer.test.tsx`（成功 / 翻红 / 保留上次值 / 多 tier / 不支持）

## 待 plan 阶段明确

- 智谱团队版用量查询 = **非目标**（B-01 P2，同 base_url 需 org/project 参数）
- 预设测试文件是否单列
- 各家余额接口精确响应字段 parser 对照 cc-switch 源码抄准（design 自审存疑）
- 余额条是否抽独立组件 `usage-footer.tsx` vs 内联（倾向独立，可复用可测）
- migration head 复核（`alembic heads` 应单头 `202607270900`，本变更不加 migration）
