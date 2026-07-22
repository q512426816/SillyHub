---
author: WhaleFall
created_at: 2026-07-14 19:42:00
status: active
---

# SillySpec 坑：Windows 下 python 写 task-NN.md 变 CRLF，破坏 plan-postcheck 正则

## 现象
plan 阶段 Step 3 子代理用 **Write 工具**生成 task-NN.md（LF 行尾，正常）。
若后续用 **Windows python 脚本**二次处理这些文件（例如本例：把正文的 goal/implementation 等字段合并进 frontmatter），`open(f, "w", encoding="utf-8")` 默认文本模式会把 `\n` 转成 `\r\n`（CRLF）。
随后 plan Step 4 postcheck 报一堆**假错误**：
- `frontmatter 缺少 allowed_paths（需非空数组）`
- `缺少 goal/implementation/acceptance/verify/constraints 字段`

实际字段都在文件里，只因行尾变 CRLF，CLI 正则失配、frontmatter 解析为空。

## 根因
- Windows python 文本模式写文件默认 newline 转换（`\n` → `os.linesep` = `\r\n`）
- SillySpec `plan-postcheck.js`（node_modules/sillyspec/src/stages/plan-postcheck.js L445、L484-488）正则用 `^---\n`、`^goal:` 等，**不兼容 CRLF**

## 绕过方案（已验证）
python 写 `.sillyspec/**/*.md` 时强制 LF：
```python
open(f, "w", encoding="utf-8", newline="\n").write(content)
```
或写回前归一化：`content = content.replace("\r\n", "\n")`。

## 建议工具修复
`plan-postcheck.js` 的 frontmatter / 字段正则兼容 CRLF：
- `content.match(/^---\r?\n([\s\S]*?)\r?\n---/)`
- 字段检查前先 `content = content.replace(/\r\n/g, "\n")` 归一化

## 影响范围
- plan Step 3「生成 TaskCard」若用 python 脚本做后处理（合并/重排字段）
- 任何用 python 批量改 `.sillyspec/*.md` 的场景（Windows）

## 关联
`2026-07-14-milestone-module-import` 变更 plan 阶段踩到；改用 `newline="\n"` 后 postcheck 通过。
