---
id: task-09
title: E2E 联调验证
priority: P0
estimated_hours: 1
depends_on:
  - task-07
  - task-08
blocks: []
allowed_paths:
  - backend/app/modules/change_writer/
  - backend/app/modules/agent/
  - frontend/src/lib/changes.ts
  - frontend/src/lib/change-writer.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
---

# task-09: E2E 联调验证

## 目标

对整个变更中心改造流程进行端到端联调验证，确保从"新建变更"到"启动执行"到"查看进度"的完整用户流程畅通，同时确保已有功能未被破坏。

## 操作步骤

### Step 1 — 后端测试通过

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest backend/app/modules/change_writer/tests/ -v
.venv/bin/python -m pytest backend/app/modules/agent/tests/ -v
```

确认所有测试通过，无 regression。

### Step 2 — 前端构建通过

```bash
cd /Users/qinyi/SillyHub/frontend
npm run build
```

确认构建成功，无 TypeScript 错误。

### Step 3 — 验证完整用户流程

#### 3.1 新建变更

1. 访问 `/workspaces/{id}/changes/create`
2. 填写表单：标题="E2E 测试变更"，描述="端到端测试描述"，规模选择"大需求"
3. 点击提交
4. **预期**：跳转到变更详情页，status="active"，current_stage="created"
5. **验证**：确认 DB 中创建了 Change 记录 + `.sillyspec/changes/change/{key}/` 目录存在

#### 3.2 列表展示

1. 返回工作空间详情页
2. **预期**：变更列表中出现新创建的变更行
3. **验证**：行中有"已创建"阶段 Badge（灰色）
4. **验证**："新建变更"按钮可见且可点击

#### 3.3 启动执行

1. 进入变更详情页
2. **预期**：显示"🚀 启动执行"按钮
3. 点击启动
4. **预期**：按钮变为 disabled，显示"启动中…"
5. **预期**：随后出现 Agent 状态 Badge："等待中" → "执行中…"
6. **预期**：执行完成后 Badge 变为"已完成 ✓"（或"失败 ✗"，取决于 sillyspec 是否可用）

#### 3.4 文档查看

1. 在详情页切换文档 Tab
2. **预期**：各文档 Tab 可点击，存在的文档能正常显示内容
3. **验证**：MASTER.md 始终可见（创建时生成）

### Step 4 — 向后兼容验证

#### 4.1 不传新字段的 API 调用

```bash
curl -X POST http://localhost:8000/api/workspaces/{id}/changes/create \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"title": "旧式调用"}'
```

**预期**：成功创建，description=""，scope="full"，无报错。

#### 4.2 现有前端功能不受影响

1. 变更列表页面正常加载（无 `current_stage` 的旧变更不显示 Badge）
2. 变更详情页的状态转移按钮仍正常工作
3. 审批流程不受影响
4. Agent run 原有的 task-level 执行不受影响

### Step 5 — 修复联调中发现的问题

记录并修复以下类型的问题：
- 前后端类型不匹配（字段名、类型）
- 路由路径不一致
- 状态码处理不当
- UI 交互细节（按钮禁用、错误提示）

### Step 6 — 最终构建验证

```bash
cd /Users/qinyi/SillyHub
.venv/bin/python -m pytest --tb=short -q
cd frontend && npm run build
```

全部通过。

## 完成标准

- [ ] 后端所有测试通过
- [ ] 前端构建成功
- [ ] 新建变更 → DB + 文件系统同步创建 ✅
- [ ] 列表展示阶段 Badge ✅
- [ ] 详情页启动执行 → Agent 调度成功（至少创建 AgentRun 记录）✅
- [ ] Agent 完成后变更阶段更新 ✅
- [ ] 文档 Tab 正常工作 ✅
- [ ] 未配置新功能时已有行为不变 ✅
- [ ] 向后兼容：不传新字段的 API 调用正常 ✅

## 文件清单

| 文件 | 操作 |
|------|------|
| （可能涉及多个文件的 bugfix） | 修改 — 联调中发现的问题修复 |
