---
name: sillyspec:knowledge
description: Agent-safe knowledge base commands for SillySpec repositories. Search, inspect, validate, refresh, and propose knowledge entries.
argument-hint: "search --query \"<text>\" --limit N | inspect --id \"<id>\" | validate | refresh | propose --title \"<title>\" --category <name>"
version: "3.19.2"
---

## 交互规范
当需要用户从多个选项中做出选择时，必须使用 Claude Code 内置的 AskUserQuestion 工具，将选项以参数传入。

## 何时使用此技能
Use this skill when working on a SillySpec repository and the task may depend on prior project knowledge, known issues, implementation patterns, scan-derived learnings, execute-stage knowledge hits, or `.sillyspec/knowledge`.

Before implementing changes, **first search the knowledge base** to avoid repeating known work or running into known issues.

## 命令列表

### 1. knowledge search — 搜索知识库
在执行任务前搜索相关知识。

```bash
sillyspec knowledge search --query "<task summary>" --limit 5
```

**示例：**
```bash
sillyspec knowledge search --query "worktree baseline apply conflict" --limit 5
sillyspec knowledge search --query "postcheck validation error"
sillyspec knowledge search --query "GLM usage metadata"
```

**输出（JSON）：**
```json
{
  "ok": true,
  "query": "worktree baseline",
  "matches": [
    {
      "id": "patterns",
      "path": "knowledge/patterns.md",
      "title": "Patterns",
      "summary": "每个阶段对应 `src/stages/` 下的独立模块...",
      "score": 3,
      "tags": ["worktree", "git-worktree", "WorktreeManager"],
      "category": "Patterns"
    }
  ]
}
```

**使用场景：**
- 实现新功能前，检查是否有现有模式可复用
- 遇到报错前，搜索是否是已知问题
- 修改特定模块前，了解约定和坑点

---

### 2. knowledge inspect — 读取知识条目详情
搜索命中后，读取完整条目内容。

```bash
sillyspec knowledge inspect --id "<knowledge-id>"
```

**示例：**
```bash
sillyspec knowledge inspect --id "patterns"
sillyspec knowledge inspect --id "known-issues/sqljs-wasm-only"
sillyspec knowledge inspect --id "generated/worktree-baseline-conflict"
```

**输出（JSON）：**
```json
{
  "ok": true,
  "entry": {
    "id": "patterns",
    "title": "Patterns",
    "summary": "每个阶段对应 `src/stages/` 下的独立模块...",
    "zone": "manual",
    "path": "knowledge/patterns.md",
    "meta": {
      "author": "qinyi",
      "created_at": "2026-06-19T12:40:00+08:00",
      "updated_at": "2026-06-24T10:00:00+08:00"
    },
    "body": "完整 markdown 内容..."
  }
}
```

**zone 说明：**
- `manual` — 人工维护的知识（可直接信任）
- `generated` — 自动提取的知识（scan 生成，需人工审核）
- `proposed` — 提议待审核的知识（未合并）

---

### 3. knowledge validate — 校验知识库健康度
在 commit/archive 前检查知识库是否可用。

```bash
sillyspec knowledge validate
```

**输出（JSON）：**
```json
{
  "ok": false,
  "errors": [
    {
      "code": "broken_reference",
      "path": "knowledge/generated/foo.md",
      "referenced_in": "INDEX.md",
      "display": "Foo Pattern"
    },
    {
      "code": "empty_file",
      "path": "knowledge/bar.md"
    }
  ],
  "warnings": [
    {
      "code": "too_many_uncategorized",
      "count": 12,
      "path": "knowledge/uncategorized.md"
    },
    {
      "code": "unregistered_file",
      "path": "knowledge/new-file.md"
    }
  ]
}
```

**错误码说明：**
| code | 说明 |
|---|---|
| `knowledge_dir_missing` | `.sillyspec/knowledge/` 目录不存在 |
| `missing_index` | `INDEX.md` 不存在 |
| `broken_reference` | INDEX.md 引用的文件不存在 |
| `empty_file` | 知识文件为空 |
| `too_many_uncategorized` | uncategorized.md 条目 ≥10，需清理 |
| `unregistered_file` | 手动知识文件未在 INDEX.md 注册 |

---

### 4. knowledge refresh — 从 scan 文档刷新自动知识
**仅写 generated/ 区，不覆盖 manual/。**

```bash
sillyspec knowledge refresh
```

**使用场景：**
- scan 阶段完成后，自动提取可复用知识
- archive 阶段完成后，沉淀长期有效的模式

**行为：**
1. 扫描 `.sillyspec/docs/<project>/scan/*.md`
2. 提取每个 `## 章节`（至少 3 行）作为知识条目
3. 写入 `.sillyspec/knowledge/generated/<slug>.md`
4. 生成 `generated/INDEX.md`

**输出（JSON）：**
```json
{
  "ok": true,
  "generated_count": 8,
  "new_count": 5,
  "overwritten_count": 3,
  "files": [
    { "file": "generated/worktree-isolation.md", "title": "...", "new": true },
    { "file": "generated/progress-management.md", "title": "...", "new": false }
  ]
}
```

**注意事项：**
- generated/ 区知识是自动生成，不保证准确，需人工审核后合并到 manual/
- 已有文件会被覆盖（ overwrite_count）

---

### 5. knowledge propose — 提议新知识
不直接编辑 manual/，而是写入 proposed/ 供审核。

```bash
sillyspec knowledge propose --title "<title>" --category <category> --body "<content>" --from "<source>"
```

**参数说明：**
| 参数 | 必填 | 说明 |
|---|---|---|
| `--title` | ✅ | 知识标题 |
| `--category` | ❌ | 分类（默认 uncategorized），如 known-issues, patterns, conventions |
| `--body` | ❌ | 知识正文 |
| `--from` | ❌ | 来源标注（如 execute/quick/scan） |

**示例：**
```bash
sillyspec knowledge propose --title "GLM API 超时处理" --category known-issues --body "GLM 模型默认超时 30 秒..." --from "execute"
```

**输出（JSON）：**
```json
{
  "ok": true,
  "id": "proposed/glm-api-timeout",
  "path": "knowledge/proposed/glm-api-timeout.md",
  "title": "GLM API 超时处理",
  "category": "known-issues",
  "new": true,
  "action": "created"
}
```

**后续流程：**
- archive/commit 阶段审核 proposed/ 条目
- 合格的合并到 manual/，不合格的删除

---

## Agent 使用指南

### 任务前必查
在开始实现新功能、修改现有代码、或遇到报错前：
1. `knowledge search --query "<任务关键词>"`
2. 命中则 `knowledge inspect --id "<id>"`
3. 遵循知识中的约定和避坑建议

### 发现新知识
执行任务中发现可复用模式或新坑：
1. `knowledge propose --title "<标题>" --category <分类> --body "<内容>"`
2. 不要直接编辑 `.sillyspec/knowledge/manual/*.md`

### 提交前校验
commit/archive 前检查知识库状态：
1. `knowledge validate`
2. 如有 errors，先修复再提交

### 扫描后刷新
scan 阶段完成后：
1. `knowledge refresh`
2. 审核生成的 `generated/*.md`，有用的合并到 manual/

---

## 禁止事项

❌ **不要直接编辑** `manual/` 或 `generated/` 中的知识文件
- 使用 `knowledge propose` 提议新知识
- 使用 `knowledge refresh` 刷新自动知识

❌ **不要使用 `grep` 或 `cat` 直接读取知识文件**
- 使用 `knowledge search` 和 `knowledge inspect`
- 它们使用与 execute 阶段相同的匹配引擎

❌ **不要让 agent 去审核 proposed/ 条目**
- 提议供人工审核，不要自动合并
- 只有用户明确要求才合并

---

## 设计原则

- **Agent-safe：** 所有输出为 JSON，失败有明确错误码
- **写保护：** refresh 仅写 generated/，propose 仅写 proposed/，不碰 manual/
- **匹配引擎：** 使用 `knowledge-match.js`（与 execute 阶段一致）
- **审计友好：** 每个条目记录来源、创建/更新时间