---
schema_version: 1
doc_type: module-card
module_id: version
author: qinyi
created_at: 2026-06-10T16:55:00
---

# version

## 定位
语义化版本（semver）解析与最低版本检查工具。为 agent-detector 提供版本比较能力，判断已安装的 agent 二进制是否满足最低版本要求。

## 契约摘要
- `SemVerTuple` — 三元组类型 `[major, minor, patch]`
- `MIN_VERSIONS` — 各 provider 的最低版本要求对象（claude: 2.0.0, codex: 0.100.0, copilot: 1.0.0）
- `parseSemver(raw?: string): SemVerTuple | null` — 从任意字符串提取第一个 semver 三元组
- `formatSemver(tuple: SemVerTuple): string` — 格式化为 "major.minor.patch"
- `checkMinVersion(provider: string, version?: string): string | null` — 低于最低版本返回警告文本，否则 null

## 关键逻辑
```
parseSemver(raw)
  /(\d+)\.(\d+)\.(\d+)/.exec(raw) → [major, minor, patch] as SemVerTuple | null

checkMinVersion(provider, version)
  minVer = MIN_VERSIONS[provider]  // 没有 entry 则直接返回 null
  parsed = parseSemver(version)
  if parsed == null || parsed < minVer → 返回 warning string
```

## 注意事项
- `parseSemver` 使用正则非锚定匹配，可处理前缀文本如 "Claude Code 2.1.5"
- `MIN_VERSIONS` 只定义了 3 个 provider，新增 provider 的版本限制需在此添加
- 被 agent-detector 导入使用，也通过 `src/index.ts` 重新导出
- API 与 Python 版一致（仅 snake_case → camelCase）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
