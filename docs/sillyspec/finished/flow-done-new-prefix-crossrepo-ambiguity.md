# flow done：`NEW:` 新建声明被误判为跨仓声明（2026-10-23 实证）

- 发现变更：`2026-10-23-session-network-context`（brainstorm 收编 → flow 轻量道 → flow done）
- 状态：**活跃**（待工具修复；当前为 advisory 不阻断收口，但会让「声明面自证」全错、归档 patch 归属对不上）

## 现象

design.md 文件变更清单里用门禁要求的 `NEW:` 前缀声明新建文件：

```
| 新增 | NEW:backend/app/core/client_ip.py | ... |
| 新增 | NEW:backend/app/modules/daemon/session/network_context.py | ... |
| 新增 | NEW:sillyhub-daemon/src/network-info.ts | ... |
```

`flow done` 收口输出两类矛盾告警：

1. `⚠️ 疑似跨仓声明未按规范标注（7 条已按主仓路径对账）：NEW:backend/app/core/client_ip.py（主仓不存在）…`
   → 建议改用 `## <注册key> 仓变更` 段头 / `cross-repo:<key>:<路径>` 前缀。
2. `⚠️ design 声明面自证：7 个声明文件不在冻结面（NEW:backend/app/core/client_ip.py…）——design 说了要改但交付里没有`
3. 同一批文件又被列进 `声明外（冻结面−声明清单，25 文件）`——因为它们没被声明清单认领。

即：**同一批文件既被判「声明了但没交付」，又被判「交付了但没声明」**。

## 根因推断

- 项目 `local.yaml` 注册了跨仓 `repos: sillyspec: C:/Users/qinyi/IdeaProjects/sillyspec`。
- 一旦存在 `repos` 注册，CLI 的声明清单解析进入「跨仓模式」，`NEW:` 前缀未被剥离/未被识别为「新建声明」，整串 `NEW:backend/...` 当路径去主仓查 → 不存在 → 落入「疑似跨仓」分支。
- 而 brainstorm 的设计门禁（`design_file_ref_invalid`）又**强制**要求新建文件必须带 `NEW:` 前缀。两条规则互斥。

## 当前绕过（本次采用）

1. 迁移文件名里的 `<rev>` 占位符改为真实 rev（占位符必然解析失败，这条与工具无关，属设计期写法问题——设计阶段应写真实文件名或不用路径形态声明）。
2. 补齐实际交付但设计漏列的 4 个文件（`agent/model.py`、`router/session_crud.py`、`daemon/service.py`、第二个迁移）。
3. 其余告警按 advisory 放行，收口唯一硬阻断是「独立评审」子步。

## 建议修复方向

- 解析声明清单时先剥离 `NEW:` / `cross-repo:<key>:` 前缀再判存在性；`NEW:` 只做「基线不存在 + HEAD 存在」校验，不参与跨仓归属判定。
- 或在存在 `repos` 注册且变更 base 在主仓时，明确主仓段语义（无段头区域=main），避免把所有路径往跨仓格式上靠。

## 关联

- 同批次观察：`commands.lint: "unavailable"` 是 local.yaml 显式配置（第 342 行），flow done 报 `lint: skipped` 属预期，**不是缺陷**。
- 姊妹条：`2026-10-23-flow-done-shared-repo-multi-session-frictions.md`（共享主仓多会话三摩擦）。

## 处置记录（2026-10-24 定时收口：已修，关闭归档）

- **已修**（sillyspec 仓 src/flow.js 三处裸比点剥 `NEW:` 前缀，scope-audit.js:1263 既有
  「比对语义剥前缀」同款口径）：①跨仓嫌疑判定（`_declared` 归一化行）——剥后按真实路径
  查主仓存在性（NEW 文件已提交即在盘 → 非嫌疑，不再落「疑似跨仓」误报）；②design 声明面
  自证（declared vs 冻结面）——剥后路径命中冻结面，不再同批文件既「声明未交付」又「交付未声明」
  双误报；③评审归属装配（buildFreezeAttribution 的 declaredFiles）——NEW 声明正确参与归属。
  未在解析层（parseFileChangeListDetailed）统一剥除：design-facts 模块域的 `NEW:` 前缀豁免
  语义（计划新建豁免/新模块标注）依赖原文前缀，解析层动刀爆炸半径过大。
- **测试**：test/thin-empty-face-crosscheck.test.mjs 新增 e2e（repos 注册在场 + design 清单
  `NEW:src/newmod/helper.js` 已提交 → flow done 收口通过 + 零「疑似跨仓」+ 零「声明面自证」
  三断言）；既有防呆告警面（FR-02 非空面 libx 命中带 key）零回归。全套件 13/13 绿。
- 处置结论：三处消费点修复+e2e 钉住，本文件移入 finished/。
