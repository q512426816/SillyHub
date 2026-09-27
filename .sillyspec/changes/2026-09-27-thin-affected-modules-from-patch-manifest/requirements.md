---
author: flow-machine-draft
created_at: 2026-09-27T14:11:35.878Z
---
# 需求规格（Requirements）— 2026-09-27-thin-affected-modules-from-patch-manifest

## 功能需求（GWT 骨架已机器预填——可编辑覆盖；FR 进知识索引）

<!--AGENT:FR区 agent 填写功能需求（GWT 骨架已预填——覆盖/修改/保留均可） -->
### FR-01: _infer_affected_components 在 module-impact.md 与 ta
Given 系统就绪
When _infer_affected_components 在 module-impact.md 与 tasks 路径两来源之外增加 change-patch.jso
Then 行为符合本条标准描述

### FR-02: files 中 .sillyspec/changes/ 前缀的变更治理件不参与匹配（不产生伪命中），
Given 系统就绪
When files 中 .sillyspec/changes/ 前缀的变更治理件不参与匹配（不产生伪命中），其余代码路径直接参与前缀匹配
Then 行为符合本条标准描述

### FR-03: change-patch.json 缺失/JSON 损坏/files 非 list 时静默跳过不抛错
Given 系统就绪
When change-patch.json 缺失/JSON 损坏/files 非 list 时静默跳过不抛错，module-impact.md 优先级与既有两来源行为零
Then 行为符合本条标准描述

### FR-04: 新增 pytest 用例覆盖：files 推断命中、治理件滤除、畸形件防御、module-impac
Given 系统就绪
When 新增 pytest 用例覆盖：files 推断命中、治理件滤除、畸形件防御、module-impact.md 优先回归，全部通过
Then 行为符合本条标准描述

### FR-05: 既有 change 模块测试（test_parser.py 全量）零回归
Given 测试 相关模块就绪
When 既有 change 模块测试（test_parser.py 全量）零回归
Then 行为符合本条标准描述

## 测试绑定（每条 FR 至少一行——空槽将在 flow done 时自动从测试结果补全）

<!--AGENT:测试绑定FR-01 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-02 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-03 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-04 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->

<!--AGENT:测试绑定FR-05 哪个测试文件/用例覆盖这条 FR（项目相对全路径＋用例名；空槽将在 flow done 自动从测试结果补全——预填可加速）——例外裁决书写面（机器段之外合法） -->
