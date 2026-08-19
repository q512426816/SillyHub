---
id: task-03
title: normalize-parser-component-type-and-description
title_zh: parser 组件目录归一——type 映射与 description 透传
author: qinyi
created_at: 2026-08-18 23:11:29
priority: P0
depends_on: [task-01]
blocks: [task-08]
requirement_ids: [FR-07]
decision_ids: [D-003@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/workspace/parser.py
  - backend/app/modules/workspace/component_catalog_service.py
  - backend/app/modules/workspace/tests/test_parser.py
  - backend/tests/modules/workspace/test_component_catalog.py
provides:
  - contract: ParsedWorkspace/ComponentRead
    fields: [type, description]
expects_from:
  task-01:
    - contract: WORKSPACE_TYPE 词表常量
      needs: [YAML_TYPE_NORMALIZE_MAP]
goal: >
  parser 解析 projects/*.yaml 时 type 经 YAML_TYPE_NORMALIZE_MAP 归一（仅明确映射保留原值兜底）、description 透传进 ParsedWorkspace 与 ComponentRead，归一只到组件目录只读展示层绝不落 Workspace 表（design §5.3/D-004@v1）。
implementation:
  - parser.py KNOWN_COMPONENT_KEYS（30-43 行）加 description 键——避免该字段落进 extra dict
  - ParsedWorkspace dataclass（56-72 行）加 description 字段（str None 无默认，保持 slots 构造位置在 role 之后对齐字段序）
  - _parse_workspace（236-286 行）——type_ 归一为 YAML_TYPE_NORMALIZE_MAP.get(type_, type_)（注意仅非 None 时查表，None 保持 None），新增 description _opt_str 透传（raw.get），构造处补两字段赋值
  - component_catalog_service.py——ComponentRead（21-31 行）补 description str None 默认；_to_component（40-50 行）构造补 description=pw.description；service 消费链零其它改动（parser 产物直读）
  - 修齐既有断言漂移——app 模块 test_parser.py 78 行 assert backend.type == service 归一后应为 backend-code（归一语义变化的如实改写，非为通过而改测试）；56 行用例 yaml 同步加 description 断言
  - backend/tests/modules/workspace/test_component_catalog.py 补归一与透传覆盖——写 type frontend 断言目录出 frontend-code、写未知值断言原样、写 description 断言 ComponentRead 透传（平台组件 type component 不在 map 内保留原值，恰好验证未知值兜底）
acceptance:
  - yaml 写 type frontend 时 parser 产物与组件目录为 frontend-code；未知值原样不崩（AC-04 前半）
  - ParsedWorkspace 与 ComponentRead 均含 description 透传值；description 不再出现在 extra
  - 归一不触碰 Workspace 表——test_service 与 test_daemon_client_scan 相关断言无漂移（D-004@v1 不落库边界）
verify:
  - cd backend && uv run pytest app/modules/workspace/tests tests/modules/workspace -q
constraints:
  - 归一只在 parser 与展示层动态做，禁止任何写 Workspace 表路径引入 parser 产物（D-004@v1，readonly-split 后已解耦不得倒退）
  - YAML_TYPE_NORMALIZE_MAP 从 constants 导入，不得在 parser 内复制一份映射表
  - _opt_str 复用现函数，不新写归一 helper——单行 map.get 即可，避免抽象
related_tests:
  - path: backend/app/modules/workspace/tests/test_parser.py
    reason: 78 行断言 type 为 service，归一后应为 backend-code，需按新语义改写断言并补 description 断言
---
