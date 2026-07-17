"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Checkbox, Form, Input, Modal, Select, TreeSelect } from "antd";
import type { TreeDataNode } from "antd";

import { Button } from "@/components/ui/button";
import type {
  OrganizationRead,
  RoleRead,
  UserCreateRequest,
  UserRead,
  UserUpdateRequest,
} from "@/lib/admin";

interface AdminUserDrawerProps {
  open: boolean;
  mode: "create" | "edit";
  user?: UserRead;
  onClose: () => void;
  onSubmit: (_body: UserCreateRequest | UserUpdateRequest) => Promise<void>;
  organizations: OrganizationRead[];
  roles: RoleRead[];
  canWrite: boolean;
  canLoginManage: boolean;
  currentUserId: string;
  /** create 模式默认选中的组织 id（来自父组件当前组织树筛选）。
   *  undefined / 未传 → create 模式默认空选中（与现状一致）。
   *  edit 模式忽略此 prop（始终用 user.organizations）。 */
  defaultOrganizationIds?: string[];
}

type OrgTreeNode = {
  title: string;
  value: string;
  children: OrgTreeNode[];
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 平铺 OrganizationRead[]（带 parent_id）→ antd TreeSelect treeData 树。 */
function buildOrgTreeData(orgs: OrganizationRead[]): OrgTreeNode[] {
  const byId = new Map<string, OrgTreeNode>();
  for (const o of orgs) {
    byId.set(o.id, { title: o.name, value: o.id, children: [] });
  }
  const roots: OrgTreeNode[] = [];
  for (const o of orgs) {
    const node = byId.get(o.id)!;
    if (o.parent_id && byId.has(o.parent_id)) {
      byId.get(o.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function AdminUserDrawer({
  open,
  mode,
  user,
  onClose,
  onSubmit,
  organizations,
  roles,
  canWrite,
  canLoginManage,
  currentUserId,
  defaultOrganizationIds,
}: AdminUserDrawerProps) {
  const [form] = Form.useForm();
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const orgTreeData = useMemo(() => buildOrgTreeData(organizations), [organizations]);

  // 实时校验状态(保存按钮 disabled 用);submit 仍走 form.validateFields 双保险。
  const watchUsername = Form.useWatch("username", form);
  const watchEmail = Form.useWatch("email", form);
  const usernameValid = (watchUsername ?? "").trim().length >= 3;
  const emailValid =
    (watchEmail ?? "").trim() === "" ||
    EMAIL_PATTERN.test((watchEmail ?? "").trim());
  const formValid = usernameValid && emailValid;

  const isSelf = !!user && user.id === currentUserId;

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (mode === "edit" && user) {
      form.setFieldsValue({
        username: user.username ?? "",
        email: user.email ?? "",
        display_name: user.display_name ?? "",
        is_platform_admin: user.is_platform_admin,
        login_enabled: user.login_enabled,
        organization_ids: user.organizations.map((o) => o.id),
        role_ids: user.roles.map((r) => r.id),
      });
    } else {
      form.setFieldsValue({
        username: "",
        email: "",
        display_name: "",
        is_platform_admin: false,
        login_enabled: true,
        organization_ids: defaultOrganizationIds ?? [],
        role_ids: [],
      });
    }
  }, [open, mode, user, defaultOrganizationIds, form]);

  const submit = async () => {
    if (!canWrite || saving) return;
    setSaving(true);
    setError(null);
    try {
      const values = await form.validateFields();
      const username = String(values.username ?? "").trim();
      const email = String(values.email ?? "").trim();
      const displayName = String(values.display_name ?? "").trim();
      const isPlatformAdmin = !!values.is_platform_admin;
      const loginEnabled = !!values.login_enabled;
      const organizationIds: string[] = values.organization_ids ?? [];
      const roleIds: string[] = values.role_ids ?? [];

      if (mode === "create") {
        const body: UserCreateRequest = {
          username,
          email: email || null,
          is_platform_admin: isPlatformAdmin,
          login_enabled: loginEnabled,
        };
        if (displayName) body.display_name = displayName;
        if (organizationIds.length) body.organization_ids = organizationIds;
        if (roleIds.length) body.role_ids = roleIds;
        await onSubmit(body);
      } else if (user) {
        const body: UserUpdateRequest = {
          username: username !== user.username ? username : undefined,
          email: email !== (user.email ?? "") ? email || null : undefined,
          display_name: displayName || undefined,
          is_platform_admin: isPlatformAdmin,
          login_enabled: loginEnabled,
          organization_ids: organizationIds,
          role_ids: roleIds,
        };
        await onSubmit(body);
      }
    } catch (err) {
      // antd Form 校验失败（errorFields）已由各 Form.Item 内联提示，不再写顶部 banner。
      if (err && typeof err === "object" && "errorFields" in err) return;
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <span className="text-sm font-medium">
          {mode === "create" ? "新建用户" : `编辑用户 ${user?.username ?? ""}`}
          {isSelf && (
            <span className="ml-2 text-[11px] text-amber-600">
              （您正在编辑自己，部分操作受限）
            </span>
          )}
        </span>
      }
      width={560}
      maskClosable={false}
      destroyOnClose
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={!canWrite || !formValid || saving}
            onClick={() => void submit()}
          >
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" preserve={false} className="pt-2">
        <Form.Item
          name="username"
          label="登录名"
          rules={[
            { required: true, message: "登录名为必填项" },
            { min: 3, message: "登录名至少 3 位" },
          ]}
        >
          <Input
            disabled={!canWrite}
            placeholder="请输入登录名"
            aria-label="登录名"
          />
        </Form.Item>

        <Form.Item
          name="email"
          label="邮箱（可选）"
          rules={[{ type: "email", message: "邮箱格式不合法" }]}
        >
          <Input
            disabled={!canWrite}
            placeholder="请输入邮箱"
            aria-label="邮箱"
          />
        </Form.Item>

        {mode === "create" && (
          <Alert
            type="info"
            showIcon
            className="mb-4"
            message={
              <span className="text-xs leading-relaxed">
                初始密码为系统默认密码
                <span className="mx-1 font-mono font-semibold">
                  SillyHub@123
                </span>
                ，无需手动设置。新建成功后请告知用户使用该密码登录，并尽快修改密码。
              </span>
            }
          />
        )}

        <Form.Item name="display_name" label="显示名（可选）">
          <Input
            disabled={!canWrite}
            maxLength={100}
            placeholder="请输入显示名"
          />
        </Form.Item>

        <div className="flex items-center gap-6">
          <Form.Item name="is_platform_admin" valuePropName="checked" noStyle>
            <Checkbox
              disabled={!canWrite || (isSelf && !!user?.is_platform_admin)}
            >
              平台超级管理员
            </Checkbox>
          </Form.Item>
          <Form.Item name="login_enabled" valuePropName="checked" noStyle>
            <Checkbox
              disabled={
                !canLoginManage ||
                (isSelf && user ? !user.login_enabled : false)
              }
            >
              允许登录
            </Checkbox>
          </Form.Item>
        </div>

        {isSelf && (
          <Alert
            type="warning"
            showIcon
            className="mt-3 mb-1"
            message={
              <span className="text-xs">
                您正在编辑自己：不能取消自己的超管权限或禁用自己的登录。
              </span>
            }
          />
        )}

        <Form.Item
          name="organization_ids"
          label="组织（多选）"
          className="mt-4"
        >
          <TreeSelect
            multiple
            treeData={orgTreeData as unknown as TreeDataNode[]}
            showSearch
            allowClear
            treeDefaultExpandAll
            treeNodeFilterProp="title"
            placeholder="请选择组织"
            disabled={!canWrite}
            style={{ width: "100%" }}
          />
        </Form.Item>

        <Form.Item name="role_ids" label="角色（多选）">
          <Select
            mode="multiple"
            options={roles.map((r) => ({ label: r.name, value: r.id }))}
            showSearch
            allowClear
            optionFilterProp="label"
            placeholder="请选择角色"
            disabled={!canWrite}
          />
        </Form.Item>

        {error && <p className="text-[11px] text-destructive">{error}</p>}
      </Form>
    </Modal>
  );
}
