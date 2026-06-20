---
id: task-01
title: ppm 模块骨架 + common helper + openpyxl 依赖
priority: P0
estimated_hours: 8
depends_on: []
blocks: [task-03, task-04, task-05, task-06]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-003@v1]
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
搭建 ppm 模块目录骨架与 common 公共 helper(crud 分页排序 / export openpyxl / fsm 状态机基类 / perms PPM_* 常量),为 W1–W4 子域四件套提供复用基础。

## 文件
- 新增 backend/app/modules/ppm/__init__.py
- 新增 backend/app/modules/ppm/common/__init__.py
- 新增 backend/app/modules/ppm/common/crud.py(分页 PageReq/Resp、apply_sort、apply_filters 泛型)
- 新增 backend/app/modules/ppm/common/export.py(openpyxl 通用导出,配置驱动列定义)
- 新增 backend/app/modules/ppm/common/fsm.py(StateMachine 基类:can_transition/next_states/do_transition)
- 新增 backend/app/modules/ppm/common/perms.py(PPM_* 字符串常量占位,实际枚举在 task-02)
- 修改 backend/pyproject.toml(+openpyxl 依赖)
- 新增 backend/app/modules/ppm/common/tests/test_*.py(crud/export/fsm 单测)

## 实现要点(参照源)
- crud.py:参照 backend/app/modules/change/service.py 或 admin 已有分页模式;PageReq(page/page_size/order_by/order),apply_sort 白名单字段防注入。
- export.py:`build_workbook(rows, columns: list[ColumnDef]) -> StreamingResponse`,端点侧建议同步 `def` 或 `anyio.to_thread.run_sync`(X-002);ColumnDef = {field, header, width, formatter}。
- fsm.py:抽象参照 backend/app/modules/change/model.py 的 StageEnum + TRANSITIONS(dict[state, set[state]]);提供 `transition(current, action) -> new_state` 抛 IllegalTransitionError。
- openpyxl:pyproject.toml dependencies 加 `openpyxl>=3.1`,锁定到 dependency group。

## 验收
- [ ] backend 启动无 import 错误,ppm 子包可被 main include(占位)
- [ ] crud.apply_sort 对白名单/非白名单字段行为正确(单测)
- [ ] export.build_workbook 输出合法 .xlsx(单测:读回单元格)
- [ ] fsm.StateMachine 对非法迁移抛 IllegalTransitionError(单测)
- [ ] `uv sync` 后 openpyxl 可 import
