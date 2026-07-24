"use client";

/**
 * PpmDictSelect — ppm 字典下拉(项目类型/状态/干系人角色等)。
 *
 * 对照源 dept_project_front `getStrDictOptions('pm_project_type' | 'pm_project_status' | ...)`,
 * 本仓 ppm 后端未提供独立 dict 接口,按 ppm 业务约定硬编码中文选项。
 *
 * 能力:
 *  - 按 `type` 渲染对应字典选项(本地数据,AntD Select 内置过滤)
 *  - 受控 value + onChange
 *  - 支持自定义 `options` 覆盖内置(未来对接 dict API 时无需改调用方)
 *  - 支持多选
 *
 * 字典值参照源 ppm 页面语义:
 *  - project_type     项目类型(软件/硬件/服务/咨询…)
 *  - project_status   项目状态(立项/进行中/已完成/已暂停/已取消)
 *  - stakeholder_role 干系人角色(甲方/乙方/监理/供应商)
 *  - priority         优先级(高/中/低)
 *  - approval_status  审批状态(草稿/审核中/已通过/已驳回)
 *
 * 设计依据:.sillyspec/changes/2026-06-21-ppm-frontend-alignment/design.md §7(W0)
 *           .sillyspec/changes/2026-06-21-ppm-frontend-alignment/tasks/task-01.md
 */
import { useMemo } from "react";
import { Select, Tag } from "antd";
import type { DefaultOptionType } from "antd/es/select";

// ── 字典类型 ──────────────────────────────────────────────────────────────

export type PpmDictType =
  | "project_type"
  | "project_status"
  | "stakeholder_role"
  | "priority"
  | "approval_status";

export interface PpmDictOption {
  label: string;
  value: string;
  /** AntD Tag 颜色(可选,渲染时给当前选中项/选项着色)。 */
  color?: string;
}

// ── 内置字典数据(参照源 ppm 语义,中文 label) ────────────────────────────

const DICT_DATA: Record<PpmDictType, PpmDictOption[]> = {
  project_type: [
    { label: "软件项目", value: "软件项目" },
    { label: "硬件项目", value: "硬件项目" },
    { label: "服务项目", value: "服务项目" },
    { label: "咨询项目", value: "咨询项目" },
    { label: "集成项目", value: "集成项目" },
    { label: "研发项目", value: "研发项目" },
  ],
  project_status: [
    { label: "立项", value: "立项", color: "default" },
    { label: "进行中", value: "进行中", color: "processing" },
    { label: "已完成", value: "已完成", color: "success" },
    { label: "已暂停", value: "已暂停", color: "warning" },
    { label: "已取消", value: "已取消", color: "error" },
  ],
  stakeholder_role: [
    { label: "甲方", value: "甲方" },
    { label: "乙方", value: "乙方" },
    { label: "监理", value: "监理" },
    { label: "供应商", value: "供应商" },
    { label: "分包商", value: "分包商" },
  ],
  priority: [
    { label: "高", value: "高", color: "error" },
    { label: "中", value: "中", color: "warning" },
    { label: "低", value: "低", color: "default" },
  ],
  approval_status: [
    { label: "草稿", value: "草稿", color: "default" },
    { label: "审核中", value: "审核中", color: "processing" },
    { label: "已通过", value: "已通过", color: "success" },
    { label: "已驳回", value: "已驳回", color: "error" },
  ],
};

/** 按 type+value 反查 label(供只读展示,与 PpmText 互补)。 */
export function getPpmDictLabel(
  type: PpmDictType,
  value?: string | null,
): string | null {
  if (value == null || value === "") return null;
  const found = (DICT_DATA[type] ?? []).find((o) => o.value === value);
  return found ? found.label : null;
}

// ── 组件 ──────────────────────────────────────────────────────────────────

export interface PpmDictSelectProps {
  /** 字典类型。 */
  type: PpmDictType;
  /** 受控值(单选标量 / 多选数组)。 */
  value?: string | string[] | null;
  onChange?: (value: string | string[] | null) => void;
  /** 自定义选项(覆盖内置,未来对接 dict API 时用)。 */
  options?: PpmDictOption[];
  /** 多选。 */
  mode?: "multiple" | "tags";
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  style?: React.CSSProperties;
}

export function PpmDictSelect(props: PpmDictSelectProps) {
  const {
    type,
    value,
    onChange,
    options,
    mode,
    placeholder,
    disabled,
    allowClear = true,
    style,
  } = props;

  const isMultiple = mode === "multiple" || mode === "tags";

  const resolved = useMemo<PpmDictOption[]>(
    () => options ?? DICT_DATA[type] ?? [],
    [options, type],
  );

  const antOptions: DefaultOptionType[] = useMemo(
    () => resolved.map((o) => ({ value: o.value, label: o.label })),
    [resolved],
  );

  // 多选时用 Tag 渲染带颜色的选中项。
  const valueColorMap = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const o of resolved) m.set(o.value, o.color);
    return m;
  }, [resolved]);

  const handleChange = (next: unknown) => {
    if (isMultiple) {
      onChange?.(Array.isArray(next) ? (next as string[]) : []);
    } else {
      onChange?.((next as string | undefined) ?? null);
    }
  };

  const tagRender =
    mode === "multiple" || mode === "tags"
      ? (tagProps: {
          value: string;
          label: React.ReactNode;
          onClose: () => void;
        }) => {
          const color = valueColorMap.get(tagProps.value);
          return (
            <Tag
              color={color}
              closable={!disabled}
              onClose={tagProps.onClose}
              style={{ marginInlineEnd: 4 }}
            >
              {tagProps.label}
            </Tag>
          );
        }
      : undefined;

  return (
    <Select<string | string[]>
      mode={mode}
      value={value as string | string[] | undefined}
      onChange={handleChange}
      placeholder={placeholder ?? "请选择"}
      disabled={disabled}
      allowClear={allowClear}
      style={{ width: "100%", ...style }}
      options={antOptions}
      showSearch
      optionFilterProp="label"
      tagRender={tagRender}
    />
  );
}

export default PpmDictSelect;
