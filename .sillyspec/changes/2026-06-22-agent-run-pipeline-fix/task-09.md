---
id: task-09
title: "[B2][sillyspec] sanitizeProjectName 字母校验 + 长度≥2 + 编号正则收紧"
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-004@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\sillyspec\src\run.js
author: qinyi
created_at: 2026-06-22T21:19:09
---
# task-09: [B2][sillyspec] sanitizeProjectName 字母校验 + 长度≥2 + 编号正则收紧

## 修改文件
- `C:\Users\qinyi\IdeaProjects\sillyspec\src\run.js`
  - 第 2154-2156 行：`sanitizeProjectName` 函数，目前 `clean = name.replace(/[^a-zA-Z0-9_\-.]/g, '').trim()` 后 `return clean || null`，**不**校验字母、**不**校验长度
  - 第 2160 行：`const numbered = outputText.match(/^\s*\d+\.\s+(\S+)/gm)` 正则过宽，匹配整个 outputText（含步骤说明、非列表段的编号），`(\S+)` 捕获任意非空白 token（包括纯数字 "0"、"7"）
  - 第 2162 行：`raw.map(sanitizeProjectName).filter(Boolean)` 清洗入口
  - 第 2167-2183 行：匹配方式 2（括号枚举）/ 匹配方式 3（YAML block），同样调 sanitizeProjectName——共用清洗逻辑，sanitize 收紧后自动受益

## 覆盖来源 (design.md §5.1 / requirements.md FR-05)
- design.md §5.1 B2 scan-projects 脏数据：
  - 修复 1：`run.js:2154-2156` `sanitizeProjectName` 加字母校验 `if (!/[a-zA-Z]/.test(clean)) return null`（纯数字 "0"/"7" 被拒）；同时最小长度 `clean.length < 2` 返回 null。
  - 修复 2：`run.js:2160` 正则收紧——先用段分隔正则截取"扫描项目列表"段，段内再匹配；或要求 token 以字母开头 `/^\s*\d+\.\s+([a-zA-Z][\w\-.]*)/gm`。
- requirements.md FR-05：scan-projects.json 仅含合法项目名（含字母、长度≥2），无 "0"/"7"。

## 实现要求 (编号步骤)
1. **sanitizeProjectName 加字母校验 + 长度校验**：第 2154-2156 行改为
   ```js
   const sanitizeProjectName = (name) => {
     const clean = name.replace(/[^a-zA-Z0-9_\-.]/g, '').trim()
     if (!clean) return null
     if (!/[a-zA-Z]/.test(clean)) return null    // 纯数字/符号拒绝（"0"/"7"/"07"）
     if (clean.length < 2) return null           // 单字符拒绝（"a"/"0"）
     return clean
   }
   ```
2. **正则收紧方案**（二选一，**推荐方案 A**）：
   - **方案 A（token 以字母开头）**：第 2160 行改为
     ```js
     const numbered = outputText.match(/^\s*\d+\.\s+([a-zA-Z][\w\-.]*)/gm)
     ```
     捕获组从 `(\S+)` 改为 `([a-zA-Z][\w\-.]*)`——第 1 字符必须是字母，后续允许字母/数字/下划线/横线/点。raw 提取同步调整：`.replace(/^\s*\d+\.\s+/, '')` 保留。
   - **方案 B（段分隔后匹配）**：先用
     ```js
     const sectionMatch = outputText.match(/扫描项目列表[：:]\s*\n([\s\S]*?)(?:\n\n|\n###|$)/)
     const sectionText = sectionMatch ? sectionMatch[1] : outputText
     const numbered = sectionText.match(/^\s*\d+\.\s+(\S+)/gm)
     ```
     截取"扫描项目列表"段后再匹配。
   - 选 A：改动最小，且与 sanitizeProjectName 字母校验双保险。若 execute 阶段发现 A 仍有误匹配（如步骤说明里有"1. frontend"），再补 B。
3. **filter(Boolean) 保留**：第 2163 行 `.filter(Boolean)` 不变——sanitize 返回 null 时 filter 自动剔除。
4. **匹配方式 2/3 共用 sanitize**：第 2171、2180 行已调 `.map(sanitizeProjectName).filter(Boolean)`，sanitize 收紧后这两路自动拒绝纯数字。
5. **兜底分支不影响**：第 2185-2198 行 `if (projectNames.length === 0)` 回退读取 projects/*.yaml 或默认 `['sillyspec']`——sanitize 收紧后如三种匹配全 fail，走兜底，不会产生脏数据。
6. **scanMeta.projectListParsed 标志**：第 2164/2172/2181 行 `stageData.scanMeta.projectListParsed = true` 仅在解析出非空列表时设 true——sanitize 收紧后若列表为空（被全 filter），标志保持 false（第 2188 行兜底分支设 false），符合语义。

## 接口定义 (函数签名/DTO)
- sanitizeProjectName 签名（保持）：
  ```ts
  function sanitizeProjectName(name: string): string | null
  ```
- 返回值契约变更：
  - 输入 `"frontend"` → `"frontend"`（通过）
  - 输入 `"0"` → `null`（纯数字）
  - 输入 `"7"` → `null`（纯数字）
  - 输入 `"0/7"` → 清洗后 `"07"` → `null`（无字母）
  - 输入 `"a"` → `null`（长度 < 2）
  - 输入 `"fe"` → `"fe"`（通过）
  - 输入 `"order-service"` → `"order-service"`（通过）
  - 输入 `"前端项目"` → 清洗后 `""` → `null`（全中文被过滤）
- 正则（方案 A）：`/^\s*\d+\.\s+([a-zA-Z][\w\-.]*)/gm`，捕获组 1 为合法项目名候选。

## 边界处理 (≥5条)
1. **纯数字 "0"/"7" → null**：`/[a-zA-Z]/.test("0")` 为 false，拒绝。这是本任务核心目标（日志中 scan-projects.json 含 `["frontend","0","7"]` 的脏数据来源）。
2. **"0/7" 清洗 "07" 无字母 → null**：`replace(/[^a-zA-Z0-9_\-.]/g,'')` 去掉 `/` 后得 `"07"`，无字母 → null。避免组合数字误入。
3. **含字母 "frontend" 通过**：清洗后仍是 `"frontend"`，含字母且长度≥2 → 通过。
4. **长度 1 "a" → null**：单字符即使含字母也拒绝（项目名至少 2 字符，避免无意义单字母项目）。
5. **列表段外编号行不误匹配（方案 A）**：步骤说明里如"1. 执行 init"——`([a-zA-Z][\w\-.]*)` 匹配 "执行" 失败（第 1 字符是中文非字母），正则不匹配该行；如"1. 启动 scan"中"启动"同样不匹配。对英文步骤"1. Run scan"会匹配到"Run"——但 sanitize 后含字母通过，仍可能误入，此时需方案 B（段分隔）。execute 时若发现此边界，补方案 B。
6. **匹配方式 2/3 共用同 sanitize**：括号枚举（"子项目frontend/order-service"）和 YAML block（`- id: name`）都调 sanitizeProjectName——字母校验对这两路同样生效，无需重复实现。
7. **兜底分支不被污染**：第 2189-2194 行读取 projects/*.yaml 的回退，文件名经 `.replace(/\.yaml$/, '')` 后未走 sanitize——这些是已注册项目（之前合法），保留原值。如担心历史脏数据，可补 `.map(sanitizeProjectName).filter(Boolean)`，但属额外加固（非本任务必需）。
8. **空 outputText**：第 2158 行 `if (outputText)` 守卫，outputText 为空时跳过三种匹配，走兜底——sanitize 不会被调用，无影响。

## 非目标
- 不重构三种匹配方式的控制流（保留 if/else 链）。
- 不改 scanMeta 字段结构（projectListParsed/manifestWritten 保持）。
- 不改 projects/*.yaml 自动注册逻辑（第 2200-2219 行，已注册项目不再覆盖）。
- 不清理已存在的脏数据文件（`projects/0.yaml`、`projects/7.yaml`）——属一次性运维清理，用户手动删或 reset。
- 不改 scan-projects.json 的 schema（仍 `{projects:[...]}`）。
- 不改下游 post-check 的项目名消费逻辑（task-05 负责 change.project 统一）。

## TDD 步骤
1. **Red**：新增 `sillyspec/test/run-sanitize-project-name.test.js`：
   ```js
   assert.equal(sanitizeProjectName('frontend'), 'frontend')
   assert.equal(sanitizeProjectName('order-service'), 'order-service')
   assert.equal(sanitizeProjectName('0'), null)
   assert.equal(sanitizeProjectName('7'), null)
   assert.equal(sanitizeProjectName('0/7'), null)
   assert.equal(sanitizeProjectName('a'), null)
   assert.equal(sanitizeProjectName('fe'), 'fe')
   assert.equal(sanitizeProjectName('前端项目'), null)
   assert.equal(sanitizeProjectName(''), null)
   ```
   - 注意：sanitizeProjectName 当前是 run.js 内部局部箭头函数（第 2154 行），**未导出**。需 refactor 提取到模块级并 `export function sanitizeProjectName(...)`，或通过集成测试间接验证（跑 runStage 后检查 projectNames）。推荐提取导出（改动小、可测性好）。
2. **Green**：按"实现要求"步骤 1 修改 sanitizeProjectName；如需导出，将函数从 runStage 内部提到模块顶层 + `export`。
3. **Red**：集成测试 `sillyspec/test/run-scan-project-parse.test.js`，构造 outputText 含
   ```
   扫描项目列表：
   1. frontend
   2. 0
   3. 7
   4. order-service
   ```
   调 runStage parse 逻辑（或提取的 parseProjectList 函数），断言 `projectNames === ['frontend','order-service']`（"0"/"7" 被拒）。
4. **Green**：按"实现要求"步骤 2 改第 2160 行正则。
5. **Red**：负向用例 outputText 含英文步骤"1. Run scan first"——验证方案 A 是否误匹配"Run"。若误匹配，切方案 B（段分隔）。
6. **Green**：方案 A 通过（或切 B）。
7. **回归**：跑 `sillyspec/test/` 全套 scan 测试，确认 happy path（合法项目名列表）不受影响。
8. **手动验证**：对 myaaa 跑 scan，检查 `<specRoot>/projects/` 目录——仅 `frontend.yaml`、`backend.yaml` 等合法名，**无** `0.yaml` / `7.yaml`。

## 验收标准 (表格)
| 验收点 | 期望 | 验证方式 |
|---|---|---|
| scan-projects.json 仅含合法项目名（含字母长度≥2） | `projects: ["frontend","backend",...]`，无 "0"/"7" | 读 specRoot 下 scan-projects.json |
| 不建 projects/0.yaml | `<specRoot>/projects/` 目录无 0.yaml / 7.yaml | ls 检查 |
| 纯数字 "0"/"7" 被拒 | sanitizeProjectName('0') === null | 单测 |
| "0/7" 清洗后无字母被拒 | sanitizeProjectName('0/7') === null | 单测 |
| 长度 1 "a" 被拒 | sanitizeProjectName('a') === null | 单测 |
| 含字母 "frontend" 通过 | sanitizeProjectName('frontend') === 'frontend' | 单测 |
| 匹配方式 2/3 共用同 sanitize（一致拒绝纯数字） | 括号枚举/YAML block 输入纯数字返回 null | 单测：parseProjectList 三种输入 |
| 列表段外编号行不误匹配 | 步骤说明"1. 执行 init"不进 projectNames | 集成测试（方案 A 验证） |
| happy path 不回归 | 合法项目名列表正确解析 | 现有 scan 测试通过 |
| 兜底分支不被污染 | projectNames 为空时回退 projects/*.yaml 或 ['sillyspec']，不含脏数据 | 单测：outputText 为空 |
