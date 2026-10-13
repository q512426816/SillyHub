---
author: qinyi
created_at: 2026-10-13T12:30:00+08:00
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 工作空间成员 | 在会话页面观察 agent 执行变更的用户（CHANGE_READ 权限） |

## 功能需求

### FR-01: 会话关联变更列表端点
覆盖决策：D-001@v2, D-003@v1
Given 工作空间内存在一个会话，且 `change_session_links` 表中记录了它与若干变更的关联（轻量或全量出身均可）
When 成员请求 `GET /api/workspaces/{wid}/changes/-/by-session/{session_id}`
Then 返回该会话关联的全部变更摘要 `list[ChangeSummary]`（含 `is_thin`/`current_stage`/`last_pushed_at` 投影），已删除（`location='deleted'`）变更 MUST NOT 出现，排序 MUST 为「未归档（`location != 'archive'`）优先 → `created_at` desc」，取数 MUST 有界（limit 100）

#### 场景：会话不存在或不属于该工作空间
Given 请求路径中的 session_id 不存在，或会话不属于路径中的 workspace_id
When 成员请求该端点
Then 返回 404，detail MUST 为中文文案（l10n 守护测试把关）

#### 场景：无关联变更
Given 会话存在但没有任何关联变更
When 成员请求该端点
Then 返回 200 空列表 `[]`（MUST NOT 404）

### FR-02: 悬浮胶囊入口与显隐
覆盖决策：D-001@v2
Given 会话页面已选中一个会话
When 该会话存在关联变更（含已归档）
Then 聊天区右下角 MUST 渲染非圆圈胶囊入口（「变更文件 + 进行中变更数量徽标」）；会话在跑（running）且有进行中变更时徽标 MUST 呈呼吸动画
When 该会话没有任何关联变更
Then 入口 MUST NOT 渲染（不占位）

### FR-03: hover 下拉分组列表
覆盖决策：D-001@v2
Given 胶囊入口已渲染
When 用户鼠标悬浮入口（或触屏点击入口）
Then MUST 弹出下拉项形式的变更列表：「进行中」组置顶（每项含 change_key、轻量/全量徽标、阶段 pill、相对时间），「已归档」组默认折叠 MUST 可点击展开；触屏无 hover 时点击入口 MUST 能固定展开/收起（兜底）

### FR-04: 点项开大弹窗复用展示组件
覆盖决策：D-001@v2, D-004@v1
Given 下拉列表已展开
When 用户点击某个变更项
Then MUST 打开大弹窗（对齐 ChangeFilesCard 规格 `h-[85vh] max-w-6xl`，shadcn Dialog 惰性 mount），内嵌与变更文件页相同的 `ChangeFileTree` 组件（点击文件的结构化预览/全屏预览由组件自带）；弹窗头部 MUST 提供变更切换 Select（含归档变更）；切换变更 MUST 通过 key=changeId 重挂载文件树

### FR-05: 文件树与列表实时刷新
覆盖决策：D-004@v1
Given 弹窗已打开
Then 弹窗内 `ChangeFileTree` MUST 以 15s 周期自动刷新文件树（新 prop `autoRefreshMs`，复用组件内 refreshTree 路径）；弹窗关闭（组件卸载）时轮询 MUST 停止
Given 悬浮下拉或弹窗打开
Then 变更列表（react-query）MUST 以 15s 周期重新拉取；关闭时 MUST NOT 后台轮询

#### 场景：autoRefreshMs 默认行为不变
Given 既有消费方（ChangeFilesCard、移动端变更详情）渲染 ChangeFileTree 且不传 autoRefreshMs
When 组件挂载
Then MUST 与现状行为一致（无新增定时器、无额外请求）

## 非功能需求

- 兼容性：纯新增只读端点 + 可选 prop，MUST NOT 影响任何既有端点/DTO/表结构/组件消费方；api-types.ts MUST 由 `pnpm gen:types` 生成并连同 backend/openapi.json 同批提交（禁手写）。
- 性能：端点 MUST 复用 `enrich_summaries` 批量投影管道（禁 N+1）；UI 与文案 MUST 中文（日期格式化 `toLocaleString("zh-CN", …)`）。
- 可测试：后端 pytest 覆盖排序/软删排除/404/工作空间隔离/投影字段；前端 vitest 覆盖显隐/分组/折叠/切换/默认行为回归；测试仅跑改动相关模块（禁全量）。
- 可回退：前端入口显隐数据驱动（无关联变更即不渲染），后端端点独立无调用方耦合，回退 = 移除入口挂载与端点。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v2 | FR-01~FR-05 | 定稿交互形态：胶囊入口 + hover 下拉 + 点项开大弹窗 |
| D-002@v1 (rejected) | —（防复潮） | 详情列内嵌形态否决，非目标 |
| D-003@v1 (rejected) | FR-01（反面支撑） | 纯前端拼凑否决 → 反向端点是必选项 |
| D-004@v1 | FR-05 | 实时性走可选 autoRefreshMs prop（Grill 修正） |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
