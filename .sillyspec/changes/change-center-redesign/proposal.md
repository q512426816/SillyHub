---
author: qinyi
created_at: 2026-05-31T14:10:00+08:00
status: draft
---

# 变更中心流程改造

## 动机

当前变更中心靠扫描 `.sillyspec/changes/` 目录被动发现变更，用户无法在 Web 端主动发起变更需求。变更详情页展示的是审批状态而非 SillySpec 阶段进度，与 SillySpec 规范完全脱节。

平台需要成为用户与 SillySpec 执行引擎之间的桥梁：用户在 Web 端描述需求 → 平台调度 Agent 执行 SillySpec 流程 → 用户实时看到阶段进度和生成文档。

## 关键问题

1. **无主动发起入口**：变更只能通过 SillySpec CLI 命令行创建，Web 端无法创建新变更
2. **状态脱节**：Change 表有 `current_stage` 字段但从未被正确设置和更新
3. **无 Agent 调度**：平台的 Agent 模块已有 coordinator 但未对接 SillySpec CLI
4. **前端展示错位**：列表和详情页展示审批状态，不展示 SillySpec 阶段

## 变更范围

| 模块 | 改动类型 | 说明 |
|------|---------|------|
| `backend/change_writer` | 增强 | schema+service+router 增加 description/scope |
| `backend/agent` | 新增 | SillySpec 调度类型（full/quick） |
| `frontend/changes/create` | 新增 | 新建变更表单页 |
| `frontend/changes` | 改造 | 列表展示阶段Badge + 新建按钮 |
| `frontend/changes/[cid]` | 增强 | 启动Agent按钮 + 文档Tab |

## 不在范围内

- SillySpec CLI 本身不需要改动
- 不实现 SSE/WebSocket 实时推送（P2，用轮询替代）
- 不改造 workspace/components/release 等其他模块
- 不做移动端适配

## 成功标准

1. 用户能在 Web 端填写表单创建变更，DB 和文件系统同步创建
2. 变更列表展示 SillySpec 阶段 Badge（created→propose→plan→execute→verify→archived）
3. 变更详情页有"启动执行"按钮，点击后调度 CC 跑 sillyspec 命令
4. 阶段进度实时反映到前端（轮询）
5. 生成文档可在详情页查看
