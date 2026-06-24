---
author: qinyi
created_at: 2026-06-24 11:30:00
---

# sillyspec-plan step7 蓝图模板缺 author/created_at(可改进项)

## 现象

`sillyspec run plan` step7「生成任务蓝图(子代理并行)」输出给子代理的 prompt 模板里,task-N.md 的 frontmatter 示例只含 `id/title/priority/depends_on/blocks/requirement_ids/decision_ids/allowed_paths`,**未包含 `author` 与 `created_at`**。

子代理照模板写出的 task-N.md 头部缺这两项,step10 `--done` 的元数据检查会警告:

```
⚠️  以下文件缺少 author 或 created_at 元数据：
  - tasks/task-04.md / task-05.md / task-06.md / task-10.md
```

## 影响

- 违反 sillyspec 铁律「文档类型文件头部必须包含 author + created_at(精确到秒)」。
- 子代理不会自行补(它严格按 prompt 模板),需人工/额外步骤补齐。
- 本变更 `2026-06-24-concurrent-refresh-revoke` 10 个蓝图中 4 个(task-04/05/06/10)缺元数据,用 `sed '1a author: qinyi\ncreated_at: ...'` 批量补。

## 建议改进

在 step7 子代理 prompt 模板的 frontmatter 示例中补两行:

```yaml
---
author: <git 用户名>      # 新增
created_at: <当前时间精确到秒>  # 新增
id: task-01
title: ...
...
---
```

prompt 正文已提供「当前时间 / 当前用户」变量(本变更里是 `2026-06-24 11:17:15` / `qinyi`),只需让模板 frontmatter 引用它们即可,子代理就能一次写对。

## 临时规避

执行 sillyspec-plan 时,在启动子代理前自行在 prompt 里强调 frontmatter 必须含 `author` + `created_at`,或生成后统一 `sed -i '1a author: ...\ncreated_at: ...'` 批量补。
