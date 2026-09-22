---
id: task-11
title: '文档同步（onboarding 手册 §5.4 cursor 案例锚 + 实测记录归档）'
title_zh: '文档同步（onboarding 手册 §5.4 cursor 案例锚 + 实测记录归档）'
author: 'qinyi'
created_at: 2026-09-08 13:00:34
priority: P1
depends_on: ['task-10']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - docs/agent-provider-onboarding.md
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  文档收尾（FR-06）：docs/agent-provider-onboarding.md 追加 §5.4 cursor 档C
  案例锚（对照 §5.3 PI 案例格式——12 步勾选回填 + 实测要点/坑记录），task-01/02
  spike 实测记录归档为素材；顺检修正 §6 caps 维护规范过时表述。
implementation:
  - 素材整理：变更目录 task-01/02 spike 实测记录（真实帧形状结论 / resume 连续性验证 / 非 force 权限行为探针）提炼为 §5.4 案例锚素材
  - §5.4 追加：对照 §5.3 结构（12 步勾选回填 + 实测要点 + 坑记录）；本变更特色四项——respawn-per-turn 模式首例（pi 直 spawn 先例对照）、坏 ps1 版本目录绕过复用（resolveWindowsCmdShim + powershell -ExecutionPolicy Bypass 包装边缘）、D-003 权限实测结论（@v2 落定的启动参数与 permission_dialog 取值）、interrupt 规范通道（error_during_execution 收敛 → interactive_interrupted，区别 pi 报 success 偏差）
  - §6 顺检：能力矩阵维护规范如有过时表述（caps 守护测试"自动覆盖"类——EXPECTED_PROVIDERS 硬编码须手动同步，D-004@v1）一并修正
  - 锚点纪律：文中 file:line 引用逐一实读核对后落笔（锚点过期是文档债，§6.1 规则 1 口径）
acceptance:
  - §5.4 落盘且结构对照 §5.3（12 步勾选 + 实测要点 + 坑记录），四项本变更特色均有记录
  - 文内代码锚点（file:line）实读核对准确，无失效引用
  - §6 过时表述已修正或确认无过时（核对结论可查）
  - task-01/02 spike 实测结论在案例锚中归档可查（不随 spike 记录沉没）
verify:
  - 文档 review：§5.4 逐项对照 design.md Wave 3 文档要求与 §5.3 格式锚（人工审读）
  - 锚点实读核对：§5.4 与 §6 修正处引用的 file:line 逐一打开验证行号与关键词命中
constraints:
  - 只追加/修正 docs/agent-provider-onboarding.md，不动其它 docs 文件与源码
  - 中文行文（必要专业术语除外——CLAUDE.md 规则 12）
  - 不虚构实测结论——未验证项如实记 false/未验证（§6.2 先实现后翻纪律），素材以 spike 实测记录为准
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
