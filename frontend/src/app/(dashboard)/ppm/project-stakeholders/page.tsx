"use client";

/**
 * 项目干系人页面 /ppm/project-stakeholders
 *
 * 走 lib/ppm/project.ts 的 listProjectStakeholders/createProjectStakeholder/...。
 * 关联项目下拉 + 干系人角色枚举 Select。
 *
 * 依据:tasks/task-10.md
 * 参照源:vue views/ppm/projectstakeholder/{index,ProjectStakeholderForm}.vue
 */
import { PpmResourceTable, type PpmFieldDef, type PpmFieldOption } from "@/components/ppm-resource-table";
import {
  createProjectStakeholder,
  deleteProjectStakeholder,
  listProjectStakeholders,
  listSimpleProjects,
  updateProjectStakeholder,
} from "@/lib/ppm/project";
import type {
  ProjectStakeholder,
  ProjectStakeholderCreate,
  ProjectStakeholderPageReq,
  ProjectStakeholderUpdate,
} from "@/lib/ppm/types";

// 干系人角色枚举(参照源 vue 字典 pm_stakeholder_role)
const STAKEHOLDER_ROLE_OPTIONS: PpmFieldOption[] = [
  { label: "决策者", value: "decision_maker" },
  { label: "赞助者", value: "sponsor" },
  { label: "执行者", value: "executor" },
  { label: "影响者", value: "influencer" },
  { label: "使用者", value: "user" },
];

type Entity = ProjectStakeholder;
type FieldName = keyof Entity & string;

const fields: PpmFieldDef<Entity>[] = [
  {
    name: "pm_project_id" as FieldName,
    label: "所属项目",
    type: "select",
    required: true,
    loadOptions: async () => {
      const list = await listSimpleProjects();
      return list.map((p) => ({
        label: p.project_name ?? p.id,
        value: p.id,
      }));
    },
  },
  { name: "stakeholder" as FieldName, label: "干系人名称", required: true },
  {
    name: "stakeholder_role" as FieldName,
    label: "干系人角色",
    type: "select",
    options: STAKEHOLDER_ROLE_OPTIONS,
  },
  { name: "phone" as FieldName, label: "联系方式" },
  { name: "create_name" as FieldName, label: "创建人" },
];

export default function PpmProjectStakeholdersPage() {
  return (
    <PpmResourceTable<
      Entity,
      ProjectStakeholderCreate,
      ProjectStakeholderUpdate,
      ProjectStakeholderPageReq
    >
      title="项目干系人"
      subtitle="项目干系人主数据"
      entityLabel="干系人"
      fields={fields}
      searchFieldNames={[
        "pm_project_id" as FieldName,
        "stakeholder" as FieldName,
      ]}
      getRowLabel={(row) => row.stakeholder ?? row.id}
      list={(params) => listProjectStakeholders(params)}
      create={(body) => createProjectStakeholder(body)}
      update={(id, body) => updateProjectStakeholder(id, body)}
      remove={(id) => deleteProjectStakeholder(id)}
      buildCreateBody={(form) =>
        stripForm(form) as unknown as ProjectStakeholderCreate
      }
      buildUpdateBody={(form) =>
        stripForm(form) as unknown as ProjectStakeholderUpdate
      }
      buildQuery={(form) =>
        stripQuery(form) as unknown as ProjectStakeholderPageReq
      }
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
