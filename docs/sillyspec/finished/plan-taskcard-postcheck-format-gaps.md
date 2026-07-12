---
author: qinyi
created_at: 2026-07-12 01:26:15
stage: plan
severity: 流程摩擦（postcheck 阻断，需手动修 TaskCard 格式）
---

# plan Step 3 TaskCard 子代理生成格式与 postcheck 期望不一致

## 现象（2026-07-11-daemon-client-container-overreach 实测）

plan Step 3 "生成 TaskCard（子代理并行）" 用 11 个子代理并行生成 task-01~11.md，全部生成成功后 plan Step 4 postcheck（蓝图一致性校验）失败，报 18 处错误：

```
❌ 蓝图一致性校验失败：
   - task-01: 缺少「验收标准」章节
   - task-02: 缺少「验收标准」章节
   - task-03: 缺少 allowed_paths + 缺少「验收标准」章节
   - task-04: 缺少 allowed_paths + 缺少「验收标准」章节
   ...（11 个卡片共 18 处：缺验收标准章节 × 11 + 缺 allowed_paths × 7）
```

## 根因（子代理输出 vs postcheck 期望的 3 类不一致）

### 不一致 1：验收章节标题大小写
- 子代理写的：`## acceptance`（英文小写）
- postcheck 正则（`plan-postcheck.js:83`）：`/##\s*验收标准/` 或 `/##\s*Acceptance/`（**大写 A**）
- 小写 `## acceptance` 两个正则都不匹配 → "缺少验收标准章节"

### 不一致 2：frontmatter allowed_paths
- 子代理写的：7 个卡片（task-03/04/05/06/08/09/10）frontmatter **没有** `allowed_paths` 字段；task-11 写了 `allowed_paths: []`（空数组）
- postcheck（`plan-postcheck.js:233`）：要求 fm 有 `allowed_paths` 且解析后非空（空数组视为缺）
- → "缺少 allowed_paths"

### 不一致 3：frontmatter author/created_at 缺失
- 子代理写的：7 个卡片（task-03/04/05/06/08/09/10）frontmatter **缺** `author` + `created_at`
- 规则要求：文档头部必须有 author + created_at（精确到秒）
- postcheck 警告（非阻断，但 CLAUDE.md 规则要求）

### 附带：子代理格式偏差
- task-04 加了冗余 `status: pending` + `change:` + `wave:` 字段（frontmatter 不该有 status）
- task-03/09 用中英混合标题 `## 验收（acceptance）` / `## 目标（goal）`（sed 批量中文化时 `^## acceptance$` 不匹配）

## 根因总结

plan Step 3 的子代理 prompt 模板（`plan.md` Step 3 给的 task-01 例子）用 **YAML 字段格式**（`goal:`/`implementation:`/`acceptance:`/`verify:`/`constraints:` 作为 fm 字段），但：
1. 模板示例的 body 章节名是英文小写（`## acceptance`），postcheck 却要中文 `## 验收标准` 或大写 `## Acceptance`——**模板与 postcheck 不一致**。
2. 模板没强制子代理每张卡片都填 `allowed_paths`（非空）+ `author` + `created_at`。
3. 子代理自由发挥时格式飘移（中英混合标题、加 status 字段）。

## 绕过（本次采用）

1. **sed 批量中文化章节标题**：`sed -i 's/^## goal$/## 目标/; s/^## implementation$/## 实现要点/; s/^## acceptance$/## 验收标准/; s/^## constraints$/## 约束/' task-*.md`（11 文件机械替换）。
2. **task-03/09 中英混合标题**单独 sed（`## 验收（acceptance）` → `## 验收标准`）。
3. **Edit 补 allowed_paths**：7 个缺的卡片在 frontmatter `decision_ids` 后插 `allowed_paths:\n  - <源文件>`（每卡片基于 plan 任务表填真实源文件路径）。task-11（回归验证无源码改动）填 `backend/app/main.py` 占位（postcheck 要求非空）。
4. **Edit 补 author/created_at**：7 个缺的卡片在 `title_zh` 后插 `author: qinyi\ncreated_at: <时间>`。
5. **删冗余字段**：task-04 的 `status: pending`（顺带删）。

修后 postcheck 通过。

## 改进建议（sillyspec 工具）

1. **统一模板与 postcheck**：plan Step 3 子代理 prompt 模板的 body 章节名改成中文（`## 目标` / `## 实现要点` / `## 验收标准` / `## verify` / `## 约束`），与 postcheck 正则 + 归档变更的 TaskCard 格式（参照 `archive/2026-07-10-2026-07-11-gate-cwd-specdir-fix/tasks/task-01.md`）一致。
2. **模板强制 fm 字段**：子代理 prompt 明确 frontmatter 必填 `allowed_paths`（非空，列出本 task 改的真实源文件）+ `author` + `created_at`，且回归类 task（无源码改动）的 allowed_paths 给出示例（如填被验证的关键入口文件）。
3. **postcheck 错误信息精确化**：报"缺少验收标准章节"时附期望的正则（`## 验收标准` 或 `## Acceptance` 大写）+ 当前找到的标题，让用户直接知道改大小写还是改中文。
4. **子代理 postcheck 预检**：plan Step 3 子代理写完 TaskCard 后，先自检格式（章节名/fm 字段）再返回，避免到 Step 4 postcheck 才批量暴露。

## 关联

- 记忆 `sillyspec-platform-archive-apply-pitfalls`（已提"TaskCard frontmatter + ##验收标准 body 双格式 postcheck"——本次是该坑的子代理生成侧实证）
- [`plan-blueprint-frontmatter-missing-metadata.md`](plan-blueprint-frontmatter-missing-metadata.md)（同类 frontmatter 元数据缺失）
- [`platform-mode-archive-loses-changedir.md`](platform-mode-archive-loses-changedir.md)
