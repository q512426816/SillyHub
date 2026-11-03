---
author: flow-machine-draft
created_at: 2026-11-03T03:04:22.286Z
---
# 需求规格（Requirements）— 2026-11-03-distill-prompt-fix

## 功能需求

### FR-01: 模板 propose 命令改单引号 body 并带 --from 来源标记，附单引号转义与 category 枚举（known-issues 连字符）指引

- build_distill_prompt 生成的 propose 命令模板必须以单引号包裹 body 占位（形如 `--body '<Markdown 正文>'`）并携带 `--from "session-distill"` 来源标记；模板必须附「--body 一律单引号包裹（单引号内反引号、$、双引号为字面量）、正文内 ASCII 单引号须转义或避开、禁止双引号包裹」与「--category 仅限四枚举值、known-issues 用连字符、笔误静默入库」的指引文样；禁止出现双引号包裹 --body 的指引形态。

#### 场景：主路径

Given 任意 source_type（session fresh/resume、change、quick）与任意 spec_dir 取值（含 None），When 生成 prompt，Then 命令模板含 `--body '<Markdown 正文>'` 与 `--from "session-distill"`，且正文含单引号转义指引、known-issues 连字符规则与「笔误静默入库」警示。

### FR-02: spec_dir 段改写为「落盘前 ls 核验；悬空回落当前工作目录 .sillyspec 并留痕偏差；禁止落自建孤儿目录」，删除「自动上行无需手动同步」表述

- spec_dir 非空时，prompt 的落盘指引必须改为「落盘前 ls 核验该路径真实存在；不存在（悬空引用）则改落当前工作目录 .sillyspec 并在汇报中留痕偏差；禁止写进自建的新目录」，且必须删除「会话结束自动上行回流平台知识库」与「无需你手动同步」两句失实表述（二者禁止再出现于任何生成形态）。

#### 场景：主路径

Given spec_dir 非空，When 生成 prompt，Then 含 ls 核验、悬空回落与孤儿树警示文样，且「自动上行」「无需你手动同步」零命中。

### FR-03: 新增回流确认段：propose 后显式 sillyspec platform sync（不带 --change）并按回执留痕，未连接平台则汇报未回流

- 全来源全模式（session fresh/resume、change、quick，含 spec_dir=None 的直调形态）生成的 prompt 必须包含回流确认段：propose 全部完成后必须显式执行 sillyspec platform sync（不带 --change），已连接平台时必须按回执留痕回流结果，未连接平台时必须在汇报中留痕「未回流」。

#### 场景：主路径

Given 四种生成形态，When 生成 prompt，Then 每份均含 `sillyspec platform sync` 调用指引与「未回流」留痕要求。

### FR-04: 新增查重（search --query）/同题幂等/宁缺毋滥 2-5 条指引；resume 式补上下文摘要兜底句

- prompt 必须包含产出纪律指引：查重必须给出 `sillyspec knowledge search --query "<关键词>"` 的精确用法（必须用 --query 传参）；必须说明同题重提为幂等更新、不产生重复条目；必须含「宁缺毋滥、通常 2～5 条、无候选直接汇报」的产出数量指引。for_resume 式 prompt 必须含上下文摘要兜底句（上下文被摘要压缩时基于可得内容提炼、不臆测丢失细节）。

#### 场景：主路径

Given resume 式生成，When 生成 prompt，Then 含 --query 查重指引、同题幂等说明、「宁缺毋滥」数量指引与摘要兜底句四要素。

### FR-05: test_distill.py 既有 prompt 断言同步更新，backend 知识蒸馏测试全绿

- test_distill.py 中断言 prompt 文样的既有用例必须同步更新为新文样（含对 FR-02 两句失实表述的反断言、legacy 形态公共段断言），backend 知识蒸馏测试套件（test_distill.py）必须全绿。

#### 场景：主路径

Given 更新后的断言，When 运行 backend 知识蒸馏测试，Then 全部通过且无跳过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/knowledge/tests/test_distill.py「test_build_distill_prompt_spec_dir_propose_guidance」
FR-02: backend/app/modules/knowledge/tests/test_distill.py「test_build_distill_prompt_spec_dir_propose_guidance」
FR-03: backend/app/modules/knowledge/tests/test_distill.py「test_build_distill_prompt_spec_dir_propose_guidance」
FR-04: backend/app/modules/knowledge/tests/test_distill.py「test_build_distill_prompt_spec_dir_propose_guidance」「test_build_distill_prompt_resume_variant」
FR-05: backend/app/modules/knowledge/tests/test_distill.py（全量用例）
