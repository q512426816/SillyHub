---
author: qinyi
created_at: 2026-07-28 17:05:00
---

# 模块影响分析（Module Impact）— LLM 供应商预设模板 + 用量/余额查询

> 角色：impact-analyzer（依据 `.sillyspec/workflows/archive-impact.yaml`）
> 方法：三重交叉验证（proposal/design 声明范围 × plan/tasks 任务范围 × `git diff 712ccd3a~1..712ccd3a` 真实变更），**以 git diff 为准（真实 > 声明）**。
> 变更落地：main 分支 `712ccd3a`（30 文件 +3679 行），verify 已 PASS（后端 107 passed + mypy 零错 + 前端测试全绿）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend | 接口变更 / 新增 | `backend/app/modules/llm_provider/schema.py`<br>`backend/app/modules/llm_provider/usage_handlers.py`（新增）<br>`backend/app/modules/llm_provider/service.py`<br>`backend/app/modules/llm_provider/router.py`<br>`backend/app/modules/llm_provider/tests/test_usage.py`（新增） | llm_provider 子模块新增「用量/余额查询」能力：`UsageData`/`UsageResult` schema；`usage_handlers.py` 按 balance（DeepSeek/硅基/OpenRouter）与 token_plan（Kimi For Coding/智谱/MiniMax）两路径硬编码各家 query+parser；`service.query_usage()` 解密 key + `_detect_usage_provider(base_url)` 路由 + 错误两态（瞬时 5xx raise / 确定性 401/403 返回 success:false）+ SSRF 复用 `tool_policy.assert_public_hostname`；router 新增 `POST /{provider_id}/usage`。无 DB 字段新增（D-004）。 | false |
| frontend | 接口变更 / 新增 / 逻辑变更 | `frontend/src/config/llmProviderPresets.ts`（新增）<br>`frontend/src/lib/api/llm-providers.ts`<br>`frontend/src/components/llm-providers/llm-provider-form.tsx`<br>`frontend/src/components/llm-providers/usage-footer.tsx`（新增）<br>`frontend/src/components/llm-providers/llm-provider-list.tsx`<br>3 件 `__tests__/*.test.tsx`（新增） | 新增 10 家 claude 风格预设常量（D-001 前端常量、后端不动）+ 预设选择器（网格按钮、分类排序、💰可查用量标记、＋自定义重置）；`queryUsage(id)` + `detectUsageProvider`；`usage-footer.tsx` 多 tier 余额条、翻红、keep-last-good 10 分钟（移植 cc-switch `resolveDisplayUsage`）；list 每行挂 UsageFooter + 💰 徽标 + 进页面自动查 + 手动单家刷新。 | false |
| prototype | 新增 | `.sillyspec/changes/2026-07-28-llm-provider-presets-and-usage/prototype-presets-and-usage.html`（新增） | 预设选择器 + 用量余额条交互原型（视觉/交互总纲参照）。 | false |
| sillyspec | 新增 | `design.md` / `plan.md` / `proposal.md` / `requirements.md` / `tasks.md` / `tasks/task-01~11.md` | 本变更的规范流程四件套 + 11 个 task 卡。 | false |

## 影响边界说明

- **不触及 DB / migration**：D-004 决策不新增数据库字段，用量路由基于 `detect_provider(base_url)` 实时判断，无持久化。无 alembic 迁移，无迁移链风险。
- **不触及 daemon / deploy / ci / build**：变更仅 backend + frontend 两端，daemon、部署、CI、构建文件零改动。
- **外部契约**：仅新增一个 REST 端点 `POST /api/llm-providers/{id}/usage`（owner 级 `get_current_user`，跨用户 404/403 不泄漏），对既有端点无破坏性变更。

## 未匹配文件

无。所有真实变更文件均已匹配到上述模块（`.sillyspec/**` 通用 glob 命中 sillyspec，其中 `prototype-*.html` 按更精确的 prototype glob 归 prototype）。

## 结论

变更集中于 **backend.llm_provider** 与 **frontend.llm-providers** 两个既有子模块，类型为「新增能力 + 接口扩展」，无数据结构与部署面变更，无需额外 review。可进入 doc-syncer 阶段同步模块文档。
