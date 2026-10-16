<!-- 活跃坑索引：处置完成的条目移入 finished/（单坑单文件） -->
<!-- change-title-not-readable.md：变更标题不可读——完整变更恒变更名兜底、轻量变更 50 字截断长句；工具侧需强制 agent 命名（10-30 字），平台侧已上提炼防御+存量回填（2026-10-16） -->

# 变更标题不可读：完整变更恒变更名兜底、轻量变更 50 字截断长句（工具侧改进）

- **发现日期**：2026-10-16（multi-agent-platform 变更中心用户实证）
- **影响面**：sillyspec CLI（`src/quicklog.js` `deriveChangeTitle`/`deriveTitleFromLinkedChange`、`src/flow.js`、`src/run/command.js`）；平台侧已做防御与存量回填（multi-agent-platform 仓 2026-10-16-change-title-condense-backfill），增量病根在 CLI。
- **用户验收口径（2026-10-16 定）**：标题必须简洁、让人明确认识到变更大概做什么；**建议约 20 字，10-30 字之内（必须）**；可强制让 agent 命名。

## 现象（本地进度库 2026-10-16 实测 20 条）

- 7 条 title=变更名兜底（`10-16-fix-auth-random-logout` 等）——完整流程 `run brainstorm --change <名>` 无 --input，`initChange` 用变更名兜底；agent 写完 proposal 后 H1 仍是模板字面 `# 提案书（Proposal）`，`deriveTitleFromLinkedChange` 剥完模板前缀为空即放弃，标题永远不刷新。
- 8 条 title=50 字硬截长句带尾省略号——轻量流程 `deriveChangeTitle` 取 `--input` 首行原样截 50 字，而 agent 常把整段动机当首行写（例：「change 文件树「刷新」同步链路三层静默失败——后端 RPC 预算 3s 短于实测 6~13.5…」）。
- 仅 5 条勉强合格。2026-09-29 约定（title=中文概括 ≤50 字、建议 ~20 字）纯靠 agent 自觉，无强制，长期不稳。

## 工具侧改进要求（待工具组实施）

1. **强制命名门（核心）**：`flow start` 必须拿到 10-30 字中文概括才放行——`--title` 显式给或 `--input` 首行（≤30 字）满足；两者皆缺/超带时 exit 2 给修正指引（对齐既有清晰度门形态）。`run` 完整流程同口径：brainstorm 收口时校验 proposal 首节生成 10-30 字概括写 title，不满足在完成门拦截。
2. **deriveChangeTitle 排版对齐**：截断从「50 字硬截」改为「自然标点截断，10-30 字带、约 20 字目标」——强边界（。！？；…——）优先、弱边界（：，、）兜底、无边界才硬截加省略号；与平台侧 `title_norm.condense_title` 同规则（平台侧已有 Python 实现+实证样本单测，可直接对照移植）。
3. **deriveTitleFromLinkedChange 补回退**：H1 剥模板前缀为空时，回退读 proposal `## 动机` 首个非空段过同款提炼产出标题（平台侧 description 提取同源规则已在 `title_norm.extract_description`）。
4. **存量修复通道**：CLI 侧可选 `progress repair-titles --dry-run/--apply`（本地进度库同规则重派生）；平台侧存量已由回填脚本处理，CLI 侧修复只影响本地显示与后续上行。

## 平台侧已落（对照面）

- `backend/app/modules/change/title_norm.py` `condense_title`：10-30 必须带 + 8~10 兜底带 + 硬截省略号，实证坏样本全量单测。
- `_ensure_change_row` 两入口（既有行收养/占位建行）对 >30 字上行标题先提炼再入库。
- `backend/scripts/backfill_change_titles.py` 存量回填（dry-run 缺省/--apply/--yes 门），从 description 提炼回填兜底或超长 title 行。
