---
author: qinyi
created_at: 2026-05-31T10:00:00
---

# CLI 平台同步对接 Design

## 概述
对接 SillySpec CLI 的 sync.js 模块，实现平台侧 API，支持 CLI 将 progress 状态、文档内容同步到 SillyHub，并支持审批流程。

## 依据
- CLI 源码: `/Users/qinyi/Desktop/sillyspec/src/sync.js`
- CLI DB 模型: `/Users/qinyi/Desktop/sillyspec/src/db.js`
- CLI 变更文档: `2026-05-31-sqlite-migration`

## DB 变更 (changes 表)
| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| current_stage | VARCHAR(50) | NULL | CLI 当前进度阶段 |
| stages | JSONB | NULL | CLI stages 进度数据 |
| approval_status | VARCHAR(30) | 'not_required' | 审批状态 |
| approved_by | UUID FK→users | NULL | 审批人 |
| approved_at | TIMESTAMPTZ | NULL | 审批时间 |
| rejection_reason | TEXT | NULL | 拒绝原因 |

## API 设计

所有 API 使用 Bearer JWT 认证，通过 change_key（字符串）定位变更。

### 1. POST /api/changes/{change_key}/progress
同步 CLI progress 数据到平台。Body 为 CLI ProgressManager.read() 输出的 JSON。

### 2. POST /api/changes/{change_key}/documents
同步四件套文档。Body: `{ "proposal.md": "...", "design.md": "...", ... }`

### 3. GET /api/changes/{change_key}/approval
查询审批状态。Response: `{ status, approved_by, approved_at, rejection_reason }`

### 4. POST /api/changes/{change_key}/approval/approve
批准变更。Body: `{ "comment": "..." }`

### 5. POST /api/changes/{change_key}/approval/reject
拒绝变更。Body: `{ "reason": "..." }`

## 前端变更
Change 详情页新增：
- 阶段进度条（读取 stages JSON 展示）
- 审批状态徽章 + 操作按钮
