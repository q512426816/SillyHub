"""问题清单 Excel 导入纯解析模块 —— 按表头文字定位列，产出扁平 ParsedProblemRow。

设计依据：``design.md`` §5 Wave1 step2（本模块条目）、§7（``ParsedProblemRow`` 18
字段定义 + ``parse_problem_workbook`` 签名）、§11 决策 D-001（后端解析 + 两步式
范式）/ D-003（全 17 业务字段）/ D-007（系统字段不导入、status/created_by 由 service
赋；此层只产原值）；表头容错 (R-02)、合并单元格向下填充 (R-04)、Excel 日期序列号
转换 (R-08)、同步解析交由 anyio.to_thread (R-03) 等范式对照
``ppm/plan/importer.py``（完整复用，不改该文件）。

纯解析、无副作用：不读写 DB、不做 project/module/duty/audit 反查（反查在 service
层 task-05），不 import ORM / Pydantic DTO —— 本模块用 dataclass 表达中间结构，
service 层负责把 ``ParsedProblemRow`` 转成导入 DTO。

性能与事件循环 (R-03，对齐 plan)：``parse_problem_workbook`` 是同步 ``def``，
openpyxl 是纯 CPU 同步库会阻塞事件循环；service 层应用
``anyio.to_thread.run_sync`` 包裹调用。

差异点（对照 plan/importer.py）：问题清单模板是「单 Sheet + 单层表头」，无 plan
那种「两行主/子表头 + 多 Sheet 类型探测」，故不需要 plan 的 ``_find_header_row``
（双行扫描）/``_detect_plan_type``/``ParsedSheet``，直接产扁平
``ParsedProblemRow`` 列表。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from io import BytesIO

from openpyxl import load_workbook
from openpyxl.utils.datetime import from_excel
from openpyxl.worksheet.worksheet import Worksheet


@dataclass(slots=True)
class ParsedProblemRow:
    """单条解析后的问题行（中间结构，非 DTO）。

    17 个业务字段 + ``row_index``（1-based 原始 Excel 行号，供预览/错误定位引用
    原始行）。``is_urgent``/``is_delay_plan`` 在本层已规范化为 "1"/"0"/None；
    3 个日期字段（``find_time``/``plan_start_time``/``plan_end_time``）在本层转
    为 ``date``（``date``→``datetime`` 转换由 service 层完成，D-010）。
    ``module_name`` 原文保留；``module_name``→ORM ``model_name`` 映射是 service
    层的事（D-012）。``pro_type``（bug/change/其他）原样保留。
    """

    project_name: str | None
    module_name: str | None
    pro_desc: str | None
    pro_type: str | None
    is_urgent: str | None
    func_name: str | None
    duty_user_name: str | None
    find_by: str | None
    find_time: date | None
    plan_start_time: date | None
    plan_end_time: date | None
    audit_user_name: str | None
    work_load: str | None
    work_type: str | None
    pro_answer: str | None
    is_delay_plan: str | None
    remarks: str | None
    row_index: int


# 表头查找窗口：模板表头一般在第 1 行，留一点容错余量（允许前面有标题/说明行）。
_MAX_HEADER_SCAN_ROWS = 5

# 关键表头文字（normalize 后比较；normalize 去掉空白与换行，故 "发现\\n时间" ->
# "发现时间"）。每个字段给「主名 + 别名」在 _FIELD_ALIASES 里声明，主名优先、别名
# 兜底，兼容模板排版差异。
_H_PROJECT_NAME = "项目名称"
_H_MODULE = "模块"
_H_PRO_DESC = "问题描述"
_H_PRO_TYPE = "问题类型"
_H_IS_URGENT = "是否紧急"
_H_FUNC_NAME = "功能名称"
_H_DUTY = "责任人"
_H_FIND_BY = "发现人"
_H_FIND_TIME = "发现时间"
_H_PLAN_START = "计划开始时间"
_H_PLAN_END = "计划结束时间"
_H_AUDIT = "验证人"
_H_WORK_LOAD = "工作量"
_H_WORK_TYPE = "工作类型"
_H_PRO_ANSWER = "解决方案"
_H_IS_DELAY = "是否延期"
_H_REMARKS = "备注"

# 字段 → 候选表头文字元组（normalize 后比较）。元组内前者优先；主名匹配不到才用别名。
# 别名只在模板该列表头「正好等于此别名文字」时命中（不会与主名列冲突），故安全。
_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "project_name": (_H_PROJECT_NAME, "项目"),
    "module_name": (_H_MODULE, "模块名称"),
    "pro_desc": (_H_PRO_DESC,),
    "pro_type": (_H_PRO_TYPE, "类型"),
    "is_urgent": (_H_IS_URGENT, "紧急", "是否加急"),
    "func_name": (_H_FUNC_NAME, "功能"),
    "duty_user_name": (_H_DUTY,),
    "find_by": (_H_FIND_BY,),
    "find_time": (_H_FIND_TIME,),
    "plan_start_time": (_H_PLAN_START, "计划开始", "计划开始日期"),
    "plan_end_time": (_H_PLAN_END, "计划结束", "计划结束日期"),
    "audit_user_name": (_H_AUDIT,),
    "work_load": (_H_WORK_LOAD, "工作量(人天)"),
    "work_type": (_H_WORK_TYPE,),
    "pro_answer": (_H_PRO_ANSWER, "问题答案", "处理方案", "答案", "问题答复"),
    "is_delay_plan": (_H_IS_DELAY, "是否延期计划", "延期"),
    "remarks": (_H_REMARKS, "备注说明"),
}

# 枚举字段「是/否」规范化的合法取值（小写比较）。中文「是/否」为主，兼容 1/0、
# 英文 yes/no、true/false，覆盖用户可能的手填变体；其它非预期值 → None（不污染 DB）。
_YES_VALUES = frozenset({"是", "1", "true", "yes", "y"})
_NO_VALUES = frozenset({"否", "0", "false", "no", "n"})


def _normalize_header(value: object) -> str:
    """表头标准化：转 str、去换行、去所有空白字符（含全角空格）、strip。

    依据 R-02：模板表头可能含 ``\\n``（如换行排版）或前后空格，必须按「去掉
    空白/换行后的文字」匹配，对列顺序/排版变化鲁棒。
    """
    if value is None:
        return ""
    text = str(value)
    # 去换行、制表符；再去掉所有空白（含全角空格 　）。
    text = text.replace("\r", "").replace("\n", "").replace("\t", "")
    text = re.sub(r"[\s　]", "", text)
    return text


def _normalize_cell(value: object) -> str | None:
    """数据单元格文本标准化：转 str 并 strip，空值/纯空白 → ``None``。"""
    if value is None:
        return None
    text = str(value).strip()
    if text == "":
        return None
    return text


def _to_date(value: object) -> date | None:
    """把单元格值转成 ``date``：兼容 Excel 序列号、datetime、date、文本日期。

    依据 R-08：Excel 日期常以序列号存储（如 46149），用
    ``openpyxl.utils.datetime.from_excel`` 转换；同时兼容 ``YYYY-MM-DD`` /
    ``YYYY/M/D`` 文本日期与原生 ``datetime`` / ``date``。
    """
    if value is None or value == "":
        return None
    # 原生 datetime / date（data_only 模式下 openpyxl 对日期格式的单元格
    # 通常直接返回 datetime）。
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    # 数值（含 Excel 序列号如 46149；也兼容 46149.0）。
    if isinstance(value, (int, float)):
        try:
            converted = from_excel(value)
        except (ValueError, OSError, OverflowError):
            return None
        if isinstance(converted, datetime):
            return converted.date()
        if isinstance(converted, date):
            return converted
        return None
    # 文本日期。
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d"):
            try:
                return datetime.strptime(text, fmt).date()
            except ValueError:
                continue
        return None
    return None


def _build_merged_index(ws: Worksheet) -> dict[tuple[int, int], str]:
    """读 ``ws.merged_cells.ranges``，构造 {(row, col): 左上角值} 索引。

    合并单元格只有左上角单元格有值（其余为 None）；依据 R-04，需对「项目名称」
    这类向下合并的区域做 forward-fill。本函数返回每个被合并覆盖的单元格 → 左上角
    原始值的映射，读取时优先用该映射即可完成填充。

    值统一转 ``str``（合并区左上角可能是数字等），空字符串左上角不填充（避免把
    空合并区扩散成 "None" 字符串）。
    """
    fill: dict[tuple[int, int], str] = {}
    for rng in ws.merged_cells.ranges:
        min_row, min_col, max_row, max_col = rng.min_row, rng.min_col, rng.max_row, rng.max_col
        anchor = ws.cell(row=min_row, column=min_col).value
        if anchor is None:
            continue
        anchor_text = str(anchor).strip()
        if anchor_text == "":
            continue
        for r in range(min_row, max_row + 1):
            for c in range(min_col, max_col + 1):
                fill[(r, c)] = anchor_text
    return fill


def _cell_text(ws: Worksheet, row: int, col: int, merged: dict[tuple[int, int], str]) -> str | None:
    """读取单元格文本：合并单元格优先用 merged 索引（完成 forward-fill）。"""
    if (row, col) in merged:
        return merged[(row, col)]
    return _normalize_cell(ws.cell(row=row, column=col).value)


def _find_header_row(ws: Worksheet) -> int:
    """单层表头定位：在前 ``_MAX_HEADER_SCAN_ROWS`` 行里找含「项目名称」的行。

    问题清单模板是单层表头（无 plan 的两行主/子表头），但允许前面有标题/说明行。
    找不到含「项目名称」的行时兜底返回第 1 行（由调用方再据 ``_build_column_map``
    是否命中 project_name 决定是否跳过该 Sheet）。
    """
    upper = min(_MAX_HEADER_SCAN_ROWS, ws.max_row)
    for r in range(1, upper + 1):
        for c in range(1, ws.max_column + 1):
            if _normalize_header(ws.cell(row=r, column=c).value) == _H_PROJECT_NAME:
                return r
    return 1


def _build_column_map(ws: Worksheet, header_row: int) -> dict[str, int]:
    """构造「字段名 → 列号」映射。

    先扫表头行建立「normalize 文字 → 列号」（同一文字多列命中取首个），再按
    ``_FIELD_ALIASES`` 每个字段的候选别名顺序匹配，主名优先、先到先得。
    依据 R-02：列顺序/排版变化时仍能按表头文字定位到正确列。
    """
    text_to_col: dict[str, int] = {}
    for c in range(1, ws.max_column + 1):
        label = _normalize_header(ws.cell(row=header_row, column=c).value)
        if label and label not in text_to_col:
            text_to_col[label] = c

    colmap: dict[str, int] = {}
    for field, aliases in _FIELD_ALIASES.items():
        for alias in aliases:
            col = text_to_col.get(alias)
            if col is not None:
                colmap[field] = col
                break
    return colmap


def _normalize_yes_no(value: object) -> str | None:
    """枚举规范化：是/1/true/yes/y → ``"1"``；否/0/false/no/n → ``"0"``；空/其它 → ``None``。

    依据 D-001 / task-02：``is_urgent``/``is_delay_plan``「是」→``"1"``、「否」→
    ``"0"``、空→``None``。非预期值（如「也许」）→ ``None``，避免脏值污染 DB。
    """
    text = _normalize_cell(value)
    if text is None:
        return None
    lowered = text.lower()
    # _YES_VALUES / _NO_VALUES 已含中文「是」「否」(Chinese lower() 为恒等,直接比较即可)。
    if lowered in _YES_VALUES:
        return "1"
    if lowered in _NO_VALUES:
        return "0"
    return None


def _parse_sheet(ws: Worksheet) -> list[ParsedProblemRow]:
    """解析单个 Sheet → ``ParsedProblemRow`` 列表。

    无「项目名称」列表头时视为非数据 Sheet，返回空列表（跳过）。
    """
    header_row = _find_header_row(ws)
    colmap = _build_column_map(ws, header_row)
    # 无项目名列表头 → 非数据 Sheet，跳过（容错：忽略说明页/周历页等）。
    if "project_name" not in colmap:
        return []

    merged = _build_merged_index(ws)

    col_project = colmap["project_name"]
    col_module = colmap.get("module_name")
    col_desc = colmap.get("pro_desc")
    col_type = colmap.get("pro_type")
    col_urgent = colmap.get("is_urgent")
    col_func = colmap.get("func_name")
    col_duty = colmap.get("duty_user_name")
    col_find_by = colmap.get("find_by")
    col_find_time = colmap.get("find_time")
    col_plan_start = colmap.get("plan_start_time")
    col_plan_end = colmap.get("plan_end_time")
    col_audit = colmap.get("audit_user_name")
    col_work_load = colmap.get("work_load")
    col_work_type = colmap.get("work_type")
    col_pro_answer = colmap.get("pro_answer")
    col_is_delay = colmap.get("is_delay_plan")
    col_remarks = colmap.get("remarks")

    rows: list[ParsedProblemRow] = []
    # 数据从表头行的下一行开始。
    for r in range(header_row + 1, ws.max_row + 1):
        project_name = _cell_text(ws, r, col_project, merged)
        module_name = _cell_text(ws, r, col_module, merged) if col_module else None
        pro_desc = _cell_text(ws, r, col_desc, merged) if col_desc else None
        pro_type = _cell_text(ws, r, col_type, merged) if col_type else None
        is_urgent = _normalize_yes_no(_cell_text(ws, r, col_urgent, merged)) if col_urgent else None
        func_name = _cell_text(ws, r, col_func, merged) if col_func else None
        duty_user_name = _cell_text(ws, r, col_duty, merged) if col_duty else None
        find_by = _cell_text(ws, r, col_find_by, merged) if col_find_by else None
        # 日期列读原始单元格值（Excel 序列号/datetime 由 _to_date 处理），不走
        # 合并填充（日期为单行属性，不预期合并）。
        find_time = _to_date(ws.cell(row=r, column=col_find_time).value) if col_find_time else None
        plan_start_time = (
            _to_date(ws.cell(row=r, column=col_plan_start).value) if col_plan_start else None
        )
        plan_end_time = (
            _to_date(ws.cell(row=r, column=col_plan_end).value) if col_plan_end else None
        )
        audit_user_name = _cell_text(ws, r, col_audit, merged) if col_audit else None
        work_load = _cell_text(ws, r, col_work_load, merged) if col_work_load else None
        work_type = _cell_text(ws, r, col_work_type, merged) if col_work_type else None
        pro_answer = _cell_text(ws, r, col_pro_answer, merged) if col_pro_answer else None
        is_delay_plan = (
            _normalize_yes_no(_cell_text(ws, r, col_is_delay, merged)) if col_is_delay else None
        )
        remarks = _cell_text(ws, r, col_remarks, merged) if col_remarks else None

        # 跳过全空行（17 业务字段全 None）。
        if not any(
            [
                project_name,
                module_name,
                pro_desc,
                pro_type,
                is_urgent,
                func_name,
                duty_user_name,
                find_by,
                find_time,
                plan_start_time,
                plan_end_time,
                audit_user_name,
                work_load,
                work_type,
                pro_answer,
                is_delay_plan,
                remarks,
            ]
        ):
            continue

        rows.append(
            ParsedProblemRow(
                project_name=project_name,
                module_name=module_name,
                pro_desc=pro_desc,
                pro_type=pro_type,
                is_urgent=is_urgent,
                func_name=func_name,
                duty_user_name=duty_user_name,
                find_by=find_by,
                find_time=find_time,
                plan_start_time=plan_start_time,
                plan_end_time=plan_end_time,
                audit_user_name=audit_user_name,
                work_load=work_load,
                work_type=work_type,
                pro_answer=pro_answer,
                is_delay_plan=is_delay_plan,
                remarks=remarks,
                row_index=r,
            )
        )

    return rows


def parse_problem_workbook(file_bytes: bytes) -> list[ParsedProblemRow]:
    """解析 ``.xlsx`` 字节流，返回扁平的 ``ParsedProblemRow`` 列表（枚举已规范化）。

    同步函数（R-03）：调用方需用 ``anyio.to_thread.run_sync`` 包裹。按表头文字
    定位列（R-02 容错列顺序/排版）、合并单元格向下填充（R-04）、Excel 日期序列号
    → ``date``（R-08）、跳过全空行；``is_urgent``/``is_delay_plan``「是/否」→
    ``"1"``/``"0"``（空/非预期 → ``None``），``pro_type`` 原样保留。

    多 Sheet 工作簿：逐 Sheet 解析，跳过无「项目名称」表头的 Sheet（如说明页），
    结果按工作簿中 Sheet 出现顺序拼接。

    Args:
        file_bytes: ``.xlsx`` 文件字节内容。

    Returns:
        解析成功的 ``ParsedProblemRow`` 列表；无数据 Sheet 时返回空列表。
    """
    wb = load_workbook(BytesIO(file_bytes), data_only=True)
    rows: list[ParsedProblemRow] = []
    try:
        for ws in wb.worksheets:
            rows.extend(_parse_sheet(ws))
    finally:
        wb.close()
    return rows


__all__ = [
    "ParsedProblemRow",
    "parse_problem_workbook",
]
