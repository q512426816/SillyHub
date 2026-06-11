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
- `parse_semver(raw: str?) -> tuple[int,int,int] | None` — 从任意字符串提取第一个 semver 三元组
- `format_semver(triple) -> str` — 格式化为 "major.minor.patch"
- `check_min_version(provider, version) -> str | None` — 低于最低版本返回警告文本，否则 None
- `MIN_VERSIONS: dict[str, tuple[int,int,int]]` — 各 provider 的最低版本要求（claude: 2.0.0, codex: 0.100.0, copilot: 1.0.0）

## 关键逻辑
```
parse_semver(raw)
  re.search(r"(\d+)\.(\d+)\.(\d+)", raw) → (major, minor, patch) tuple

check_min_version(provider, version)
  min_ver = MIN_VERSIONS[provider]  # 没有 entry 则直接返回 None
  parsed = parse_semver(version)
  if parsed < min_ver → 返回 warning string
```

## 注意事项
- `parse_semver` 使用 `re.search`（非 `match`），可处理前缀文本如 "Claude Code 2.1.5"
- `MIN_VERSIONS` 只定义了 3 个 provider，新增 provider 的版本限制需在此添加
- 被agent-detector 导入使用，也通过 `__all__` 重新导出

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
