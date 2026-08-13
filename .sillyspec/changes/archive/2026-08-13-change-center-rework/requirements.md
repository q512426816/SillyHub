---
author: qinyi
created_at: 2026-08-13 09:41:17
---

# 需求规约 — 变更中心列表页整体重做

## 功能需求

### FR-01：主 tab 维度统一 + 待我处理聚焦筛选
- 主 tab 按 location 分：**进行中 / 已归档**（不再有待我处理独立 tab）。
- 「进行中」视图顶部有聚焦开关 `☑ 只看待我处理(N)`，**默认勾上**。
- 勾选时只显示 `pending_review` 非空的变更；取消勾选显示全部进行中。
- 覆盖 D-007。

### FR-02：「待我处理」语义 = 全局待人工
- 「待我处理」= `pending_review IS NOT NULL`（待提案审核/待计划审核/待人工测试/待归档确认）。
- 不区分用户、不引入 assignee。覆盖 D-002。

### FR-03：ChangeSummary 携带 pending_review（零 migration，走 PG 镜像）
- `ChangeSummary` 新增 `pending_review: str | None`。
- 由后端从 PG `platform_change_progress.latest_progress`（进度镜像）解析 stages + `_map` 算出（D-008，**不读 sillyspec.db**）；pending_review 与 current_stage 同源。
- 不新增数据库列、零 migration。覆盖 D-003/D-008。

### FR-04：默认排序「最近活动优先」+ 可切换
- 列表默认 `updated_at DESC`（取代现 `change_key ASC`）。
- list API 支持 `sort` 参数；前端列头可切换排序方向。覆盖 D-004。

### FR-05：待办状态徽标
- 每行显示「待办状态」徽标：proposal_review→待提案审核、plan_review→待计划审核、human_test→待人工测试、archive_confirm→待归档确认（warning 色）；status=blocked→阻塞中（error 色）；无则不显示。
- 删除与「阶段」列冗余的旧「状态」列。

### FR-06：负责人列
- 表格新增「负责人」列，展示 `owner_id` 对应用户；空则显示 "—"。

### FR-07：查询区消除留白
- 查询条件网格从 grid-cols-4（只填 2 格）改为 grid-cols-2，消除右半留白。

### FR-08：新建变更升主按钮
- 「+新建变更」从 outline 小按钮升级为主按钮（primary），置于标题区显眼位置。

### FR-09：空状态引导 CTA
- 各视图空状态显示分场景文案 + 「+新建变更」CTA（不再是一句干话）。

### FR-10：tab 挂计数
- 「进行中」「已归档」tab 显示对应数量徽标。

### FR-11：副标题修正
- 副标题从"← 组件列表"改为 workspace 名 + 待处理计数（如"3 个变更待你处理（共 20 个进行中）"）。

### FR-12：删除死代码
- 删除 `page.tsx` 中未使用的 `GATE_LABELS`（详情侧误拷孤儿），由 FR-05 真实徽标映射替代。

### FR-13：接口类型同步
- `pnpm gen:types` 重新生成 `api-types.ts`（ChangeSummary 多 pending_review）+ 同步提交 `openapi.json`。

## 非功能需求

### NFR-01：零数据库 migration
- pending_review 为计算字段，changes 表结构不变。

### NFR-02：降级安全
- `latest_progress` 缺失 / 解析失败 / stages 表缺时，pending_review 返回 None（防御式 fail-closed），列表仍可用（不报错、不阻断）。

### NFR-03：跨平台
- 前后端代码兼容 Windows/Linux/macOS（路径、换行）。

### NFR-04：UI 中文
- 文案中文为主（专业术语除外）。
