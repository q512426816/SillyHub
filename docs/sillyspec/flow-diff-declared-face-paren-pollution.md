# flow diff 冻结件 declared-face 路径被括号后缀污染（sillyspec 工具缺陷,2026-10-13）

状态：活跃坑（待工具修复）

## 现象

`flow diff` 消费方冒烟（multi-agent-platform 仓,归档件 2026-10-13-turn-nav-rail-overflow-fix）发现:change-patch.json 的 scopeAudit.rows[] 里 declared-face（design 文件变更清单）行的 **path 字段携带括号残片**——

```
rows[2].path = "frontend/src/components/sessions/turn-nav-list.tsx（交付"
rows[2] = { additions: 0, deletions: 0, verdict: "untouched" }
```

同一真实文件出现两行（numstat 行 +47/-0 verdict=unplanned 与 declared 行 +0/-0 verdict=untouched）,totals.files 按行数计（该件实报「4 文件」,唯一路径仅 2 个）。终端态渲染同病:行尾括号不闭合（`turn-nav-list.tsx（交付｜untouched`）。

## 根因（推断,待工具侧确认）

design.md「文件变更清单（自声明）」按以下格式书写:

```
- frontend/src/components/sessions/turn-nav-list.tsx（交付：rail 去 shrink-0 + nav 滚动条隐藏 + 注释）
```

declared-face 解析器提取路径时未剥除行内括号注记后缀,把 `path + "（交付"` 整体当路径入库。旁证:同会话收口时该文件被判「未归因 1 hunk,不在 design 清单」——同一解析缺陷的两面（归因判不到 + 路径脏）。

## 影响

- 文件数虚高（dup 零行计入 totals.files）;
- `--json` 消费方（平台后续轮锚对账）拿到不可机读的脏路径, join 真实路径必然失配;
- 归因面失真:declared 文件被判 unplanned。

## 可能的修复方向

- declared-face 解析时剥除 `（…）`/`(…)` 全角/半角括号注记（含分隔到「：」前的「（交付」「（计划」等角色前缀）;
- 归档件去重策略:numstat 行与 declared 行同真实路径时合并,verdict 取归因语义更准确的一行;
- 存量归档件不回填（审计件冻结原则）,修复只影响新收口。

## 关联

- 发现于 2026-10-13-turn-nav-rail-overflow-fix 归档件（flow diff 冒烟）;
- 对照件 2026-10-13-change-files-view-polish 无此病（其 design 清单无括号注记写法）——写法规避:文件变更清单行裸写路径,角色/说明移到行外或行尾空格后。
