"use client";

/**
 * 项目维护页面 /ppm/projects
 *
 * 走 lib/ppm/project.ts 的 listProjects/createProject/updateProject/
 * deleteProject/exportProjects。CRUD + 搜索 + 导出 由 PpmResourceTable 通用组件承担。
 *
 * 依据:.sillyspec/changes/2026-06-20-ppm-module-migration/tasks/task-10.md
 * 参照源:vue views/ppm/projectmaintenance/index.vue
 */
import { PpmResourceTable, type PpmFieldDef } from "@/components/ppm-resource-table";
import {
  createProject,
  deleteProject,
  exportProjects,
  listProjects,
  updateProject,
} from "@/lib/ppm/project";
import type {
  ProjectMaintenance,
  ProjectMaintenanceCreate,
  ProjectMaintenancePageReq,
  ProjectMaintenanceUpdate,
} from "@/lib/ppm/types";

// 项目类型 / 状态枚举(参照源 vue 字典 pm_project_type / pm_project_status)
const PROJECT_TYPE_OPTIONS = [
  { label: "研发项目", value: "research" },
  { label: "实施项目", value: "implementation" },
  { label: "运维项目", value: "maintenance" },
];
const PROJECT_STATUS_OPTIONS = [
  { label: "进行中", value: "ongoing" },
  { label: "已完成", value: "completed" },
  { label: "已暂停", value: "paused" },
];

type Entity = ProjectMaintenance;
type FieldName = keyof Entity & string;

const fields: PpmFieldDef<Entity>[] = [
  { name: "project_code" as FieldName, label: "项目编号", required: true, readOnlyOnEdit: true, placeholder: "项目唯一编号" },
  { name: "project_name" as FieldName, label: "项目名称", required: true },
  { name: "company_name" as FieldName, label: "公司名称" },
  { name: "create_name" as FieldName, label: "创建人", hideInTable: false },
  {
    name: "project_type" as FieldName,
    label: "项目类型",
    type: "select",
    options: PROJECT_TYPE_OPTIONS,
  },
  {
    name: "project_status" as FieldName,
    label: "项目状态",
    type: "select",
    options: PROJECT_STATUS_OPTIONS,
  },
  { name: "project_effective_start_time" as FieldName, label: "生效开始时间", type: "date" },
  { name: "project_effective_end_time" as FieldName, label: "生效结束时间", type: "date" },
  { name: "project_maintenance_end_time" as FieldName, label: "维保结束时间", type: "date" },
];

export default function PpmProjectsPage() {
  return (
    <PpmResourceTable<
      Entity,
      ProjectMaintenanceCreate,
      ProjectMaintenanceUpdate,
      ProjectMaintenancePageReq
    >
      title="项目维护"
      subtitle="项目主数据,被项目成员 / 干系人 / 计划 / 看板引用"
      entityLabel="项目"
      exportFilename="project_maintenance.xlsx"
      fields={fields}
      searchFieldNames={[
        "project_name" as FieldName,
        "project_code" as FieldName,
        "company_name" as FieldName,
      ]}
      getRowLabel={(row) =>
        row.project_name ?? row.project_code ?? row.id
      }
      list={(params) => listProjects(params)}
      create={(body) => createProject(body)}
      update={(id, body) => updateProject(id, body)}
      remove={(id) => deleteProject(id)}
      exportFn={(params) => exportProjects(params)}
      buildCreateBody={(form) => stripForm(form) as unknown as ProjectMaintenanceCreate}
      buildUpdateBody={(form) => stripForm(form) as unknown as ProjectMaintenanceUpdate}
      buildQuery={(form) => stripQuery(form) as unknown as ProjectMaintenancePageReq}
    />
  );
}

/** 把表单状态里的空串/未填字段去掉,避免覆盖后端默认值。 */
function stripForm(form: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v === "" || v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function stripQuery(
  form: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v) out[k] = v;
  }
  return out;
}
