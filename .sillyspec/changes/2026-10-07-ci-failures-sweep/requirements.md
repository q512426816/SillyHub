---
author: flow-machine-draft
created_at: 2026-10-07T15:08:47.462Z
---
# 需求规格（Requirements）— 2026-10-07-ci-failures-sweep

## 功能需求

### FR-01: backend/tests/test_align_platform_change_events_migration.py 链尾锚更新为当前唯一 head 20261006200000 且该文件全绿

- 链尾锚断言必须等于当前主线唯一 head 20261006200000（2026-10-06-provider-model-list 迁移），注释随锚前移记录接续链。

#### 场景：主路径

Given versions 目录含 20261006120000→20261006200000 两新迁移 / When test_file_exists_and_single_head_chain 执行 / Then heads 长度 1 且等于 20261006200000，文件全绿。

### FR-02: test_files_router.py fixture 确定性选取活跃 change（不依赖排序巧合），test_list_files 全绿

- workspace_with_changes fixture 必须从列表响应中显式过滤 location=="active" 的行返回，禁止依赖 updated_at desc 排序碰巧排首。

#### 场景：主路径

Given fixtures 含归档 change（changes/archive/ 子树）/ When 列表排序把归档行排首（CI Linux 同刻 mtime 实况）/ Then fixture 仍返回活跃 change，test_list_files 写读 watcher-events.jsonl 成功。

### FR-03: test_attachment_pipeline.py 两个 group 装配用例 member 夹具补 config_snapshot 并断言 D-003 模型透传，全绿

- member 夹具必须带 config_snapshot 属性：dict 形态断言 gate 收到 model_name=快照 model（D-003 透传），None 形态断言 model_name=None（主模型条目兜底）。

#### 场景：主路径

Given member.config_snapshot={"model": "glm-4.7"} / When 群装配执行 / Then resolve_session_gate 收到 model_name="glm-4.7"；Given config_snapshot=None / Then model_name 为 None。

### FR-04: test_archived_write_guard.py 懒激活退役用例改断言 TOOL_REPORT_TAKEOVER_INVALID（归档写入口兜底由 create 链既有守卫用例覆盖），全绿

- 未激活 tool_report 会话在归档区注入必须断言 409 HTTP_409_TOOL_REPORT_TAKEOVER_INVALID（懒激活退役后的现行契约），docstring 必须注明写入口兜底链（takeover→create→ensure_writable，已由 test_session_create_on_archived_returns_409 覆盖）。

#### 场景：主路径

Given 归档工作区 + pending tool_report 会话 / When POST inject / Then 409 code=HTTP_409_TOOL_REPORT_TAKEOVER_INVALID。

### FR-05: precipitate-dialog.test.tsx 载荷断言回归 model 单串契约，全绿

- dispatchDistill 载荷断言必须为 model: 单字符串形态（后端 DistillDispatchIn.model 契约），禁止断言 models 列表形态（b8afd807c 坏合并残留）。

#### 场景：主路径

Given 选定供应商+选定模型 glm-4.7 / When 提交派发 / Then 载荷含 llm_provider_id + model: "glm-4.7"，无 models 键。

### FR-06: pre-session-picker.test.tsx 两处 caps 期望对象恢复 multimodal 键，全绿

- cursor 与 unknown-engine 两处全对象 toEqual 必须包含 multimodal 键（查表实态 16 键；cursor=false / 未知回退=false），与 provider-caps.ts 单源一致。

#### 场景：主路径

Given provider-caps.ts 查表含 multimodal / When 全对象断言执行 / Then 两处期望对象 16 键全量相等。

### FR-07: sessions page.test.tsx 供应商 mock 补 agent_kinds 必填字段，whoLine 用例全绿

- listProviders mock 行必须携带 LlmProviderRead 必填键 agent_kinds（["claude"]），禁止缺键导致 SessionConfigBar 过滤崩渲染。

#### 场景：主路径

Given mock 供应商含 agent_kinds / When 渲染会话面板 / When attach 拉 run 快照 / Then 轮次配置快照 whoLine 正常渲染三段对照。

### FR-08: 本地仅跑上述相关测试文件全绿（全量留给 CI），四 workflow 推送后全绿

- 本地必须只跑本次触达的相关测试文件（后端 4 文件 56 用例 + 前端 3 文件 93 用例）且全绿，全量回归必须留给 CI；推送后 backend-ci/frontend-ci/e2e-ci/scan-drift 必须 全绿。

#### 场景：主路径

Given 上述修复落地 / When 本地跑相关文件 / Then 全绿；When push 到 main / When GitHub Actions 四 workflow 完成 / Then 全部 success。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/test_align_platform_change_events_migration.py「TestMigrationStructure::test_file_exists_and_single_head_chain」
FR-02: backend/app/modules/change/tests/test_files_router.py「test_list_files」（fixture workspace_with_changes 全文件消费）
FR-03: backend/app/modules/daemon/tests/test_attachment_pipeline.py「TestGroupWrapperEquivalence::test_group_assembly_gate_basis_owner_and_member / test_group_assembly_member_provider_fallback_claude」
FR-04: backend/app/modules/workspace/tests/test_archived_write_guard.py「test_tool_report_activation_on_archived_returns_409」（写入口兜底同文件「test_session_create_on_archived_returns_409」）
FR-05: frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx「选定供应商 → 「获取模型」拉列表填充 select；选定后 llm_provider_id/model 随载荷透传」
FR-06: frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx「十六键与 daemon 单源一致；未知 provider 默认拒绝（boolean 全 false + dialog/sessionFork none）不抛错」
FR-07: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx「历史轮 whoLine 按 run 快照渲染（档案快照名 / 会话 agent_name / 供应商名对照）」
FR-08: 不适用：流程约束本身（本地相关文件绿已实证 56+93；四 workflow 全绿以推送后 GitHub Actions 实跑结果为准）
