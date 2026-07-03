---
author: qinyi
created_at: 2026-07-04T01:10:00
---

# SillySpec 坑：light plan.md 也需要 `## Wave N` 标题

## 现象
plan_level=light 的 plan.md 用 `## Tasks` 包 checkbox task，execute contract 校验报：
```
plan.md 中没有找到 checkbox task（格式: "- [ ] task-XX: 任务名"）
```

## 根因
`execute.js:358 parseWavesFromPlan` 用 `^#+\s*Wave\s+(\d+)` 匹配 Wave 标题（line 365）。
无 Wave 标题时 `currentWave` 一直 null（line 382 `if (!currentWave) continue`），
checkbox task 不被收集 → `allTasks` 为空 → 报"没有找到 checkbox task"。

## 修复
light plan.md **不要用 `## Tasks`**，改用 `## Wave 1`（多组则 `## Wave 2` ...）包 checkbox。
light 模板（`plan.js:195-227`）示例用 `## Tasks` 是误导——light 自检清单（plan.js:333-345）没列 Wave 要求，但 execute 解析依赖 Wave 标题。

## task 蓝图中文章节名
execute.js plan-postcheck 蓝图一致性校验要求 task-NN.md 的验收章节叫 **`## 验收标准`**（中文），Step 3 prompt 写英文 `acceptance` 是误导。其他章节也用中文：`## 目标 / ## 实现步骤 / ## 验收标准 / ## 验证方式 / ## 约束`。

## dump_openapi.py Settings 兜底
`from app.main import app` 触发 `create_app() → get_settings() → Settings()`，Settings 的 `database_url` / `secret_key` 是 required。dump 是构建期工具不连 DB，脚本内 `os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite://dump-only")` + `SECRET_KEY` 兜底即可（lifespan 不跑，不消费这些值）。

## 关联
2026-07-04-frontend-openapi-types 变更踩到。
