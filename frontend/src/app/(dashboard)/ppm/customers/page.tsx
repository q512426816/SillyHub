"use client";

/**
 * 客户维护页面 /ppm/customers
 *
 * 走 lib/ppm/project.ts 的 listCustomers/createCustomer/.../exportCustomers。
 *
 * 依据:tasks/task-10.md
 * 参照源:vue views/ppm/customermaintenance/index.vue
 */
import { PpmResourceTable, type PpmFieldDef } from "@/components/ppm-resource-table";
import {
  createCustomer,
  deleteCustomer,
  exportCustomers,
  pageCustomers,
  updateCustomer,
} from "@/lib/ppm/project";
import type {
  CustomerMaintenance,
  CustomerMaintenanceCreate,
  CustomerMaintenancePageReq,
  CustomerMaintenanceUpdate,
} from "@/lib/ppm/types";

const LEVEL_OPTIONS = [
  { label: "战略客户", value: "strategic", color: "red" },
  { label: "重要客户", value: "important", color: "orange" },
  { label: "普通客户", value: "normal", color: "blue" },
];

type Entity = CustomerMaintenance;
type FieldName = keyof Entity & string;

const fields: PpmFieldDef<Entity>[] = [
  { name: "company_name" as FieldName, label: "公司名称", required: true },
  { name: "contact" as FieldName, label: "联系人" },
  {
    name: "phone_no" as FieldName,
    label: "手机号",
    placeholder: "11 位手机号",
    pattern: /^1\d{10}$/,
    patternMessage: "请输入 11 位手机号(以 1 开头)",
  },
  { name: "dept_name" as FieldName, label: "部门" },
  {
    name: "level" as FieldName,
    label: "级别",
    type: "select",
    options: LEVEL_OPTIONS,
  },
  { name: "create_name" as FieldName, label: "创建人", hideInForm: true },
];

export default function PpmCustomersPage() {
  return (
    <PpmResourceTable<
      Entity,
      CustomerMaintenanceCreate,
      CustomerMaintenanceUpdate,
      CustomerMaintenancePageReq
    >
      title="客户维护"
      subtitle="客户主数据,被项目维护关联"
      entityLabel="客户"
      exportFilename="customer_maintenance.xlsx"
      fields={fields}
      searchFieldNames={[
        "company_name" as FieldName,
        "contact" as FieldName,
      ]}
      getRowLabel={(row) => row.company_name ?? row.contact ?? row.id}
      list={(params) => pageCustomers(params)}
      create={(body) => createCustomer(body)}
      update={(id, body) => updateCustomer(id, body)}
      remove={(id) => deleteCustomer(id)}
      exportFn={(params) => exportCustomers(params)}
      buildCreateBody={(form) => stripForm(form) as unknown as CustomerMaintenanceCreate}
      buildUpdateBody={(form) => stripForm(form) as unknown as CustomerMaintenanceUpdate}
      buildQuery={(form) => stripQuery(form) as unknown as CustomerMaintenancePageReq}
    />
  );
}

function stripForm(form: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v === "" || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function stripQuery(form: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v) out[k] = v;
  }
  return out;
}
