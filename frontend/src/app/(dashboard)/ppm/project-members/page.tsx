"use client";

/**
 * 项目成员页面 /ppm/project-members
 *
 * 走 lib/ppm/project.ts 的 listProjectMembers/createProjectMember/...。
 * 特点:关联项目下拉(走 listSimpleProjects)+ 用户下拉(走 admin listUsers),
 * 按 projectId 过滤(默认全量)。
 *
 * 依据:tasks/task-10.md,D-004@v1 角色字段(开发 / 项目经理 / 部门经理 / 成员)
 * 参照源:vue views/ppm/projectmember/{index,ProjectMemberForm}.vue
 */
import { PpmResourceTable, type PpmFieldDef, type PpmFieldOption } from "@/components/ppm-resource-table";
import {
  createProjectMember,
  deleteProjectMember,
  listProjectMembers,
  listSimpleProjects,
  updateProjectMember,
} from "@/lib/ppm/project";
import { listUsers } from "@/lib/admin";
import type {
  ProjectMember,
  ProjectMemberCreate,
  ProjectMemberPageReq,
  ProjectMemberUpdate,
} from "@/lib/ppm/types";

// D-004@v1 角色枚举
const ROLE_OPTIONS: PpmFieldOption[] = [
  { label: "开发", value: "dev" },
  { label: "项目经理", value: "pm" },
  { label: "部门经理", value: "dept_manager" },
  { label: "成员", value: "member" },
];

type Entity = ProjectMember;
type FieldName = keyof Entity & string;

const fields: PpmFieldDef<Entity>[] = [
  {
    name: "pm_project_id" as FieldName,
    label: "所属项目",
    type: "select",
    required: true,
    hideInTable: false,
    loadOptions: async () => {
      const list = await listSimpleProjects();
      return list.map((p) => ({
        label: p.project_name ?? p.id,
        value: p.id,
      }));
    },
  },
  {
    name: "user_id" as FieldName,
    label: "成员",
    type: "select",
    required: true,
    loadOptions: async () => {
      const resp = await listUsers({ limit: 200 });
      return resp.items.map((u) => ({
        label: u.display_name ?? u.email,
        value: u.id,
      }));
    },
  },
  { name: "user_name" as FieldName, label: "成员姓名" },
  { name: "phone" as FieldName, label: "联系方式" },
  { name: "depart_name" as FieldName, label: "部门" },
  {
    name: "role_id" as FieldName,
    label: "承担角色",
    type: "select",
    options: ROLE_OPTIONS,
    hideInTable: true,
  },
];

export default function PpmProjectMembersPage() {
  return (
    <PpmResourceTable<
      Entity,
      ProjectMemberCreate,
      ProjectMemberUpdate,
      ProjectMemberPageReq
    >
      title="项目成员"
      subtitle="项目成员主数据,被审批流 / 看板依赖"
      entityLabel="成员"
      fields={fields}
      searchFieldNames={["pm_project_id" as FieldName]}
      getRowLabel={(row) => row.user_name ?? row.user_id}
      list={(params) => listProjectMembers(params)}
      create={(body) => createProjectMember(body)}
      update={(id, body) => updateProjectMember(id, body)}
      remove={(id) => deleteProjectMember(id)}
      buildCreateBody={(form) => {
        const body = stripForm(form);
        return body as unknown as ProjectMemberCreate;
      }}
      buildUpdateBody={(form) =>
        stripForm(form) as unknown as ProjectMemberUpdate
      }
      buildQuery={(form) =>
        stripQuery(form) as unknown as ProjectMemberPageReq
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
