import React, { useEffect, useContext, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Checkbox, Form, Input, Popconfirm, Spin } from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";

import * as lib from "@clusterio/lib";

import { useRole } from "../model/roles";
import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { notifyErrorHandler } from "../util/notify";

export default function RoleViewPage() {
	let params = useParams();
	let roleId = Number(params.id);

	let navigate = useNavigate();

	let account = useAccount();
	let control = useContext(ControlContext);
	const [role, synced] = useRole(roleId);
	let [edited, setEdited] = useState(false);


	let nav = [{ name: "Roles", path: "/roles" }, { name: role?.name ?? String(roleId) }];
	if (!role) {
		if (!synced) {
			return <PageLayout nav={nav}>
				<PageHeader title={String(roleId)} />
				<Spin size="large" />
			</PageLayout>;
		}

		return <PageLayout nav={nav}>
			<PageHeader title="Role not found" />
			<p>Role with id {roleId} was not found on the controller.</p>
		</PageLayout>;
	}

	// TODO: Update displayed perms when role perms change and have not been edited locally
	let initialValues = {
		name: role["name"],
		description: role["description"],
		permissions: {
			...Object.fromEntries([...lib.permissions.values()].map(perm => [
				perm.name, [...role.permissions].includes(perm.name),
			])),
		},
	};

	let canUpdate = account.hasPermission("core.role.update");
	return <PageLayout nav={nav}>
		<Form
			initialValues={initialValues}
			onValuesChange={() => { setEdited(true); }}
			onFinish={values => {
				let newPermissions = [];
				for (let [name, value] of Object.entries(values.permissions)) {
					if (value) { newPermissions.push(name); }
				}

				control.send(
					new lib.RoleUpdateRequest(roleId, values.name || "", values.description || "", newPermissions)
				).then(() => {
					setEdited(false);
				}).catch(notifyErrorHandler("Error applying changes"));
			}}
		>
			<PageHeader
				title={role.name}
				extra={<>
					{canUpdate && <Button type={edited ? "primary" : "default"} htmlType="submit">Apply</Button>}
					{account.hasPermission("core.role.delete") && <Popconfirm
						title="Delete role?"
						placement="bottomRight"
						okText="Delete"
						okButtonProps={{ danger: true }}
						onConfirm={() => {
							control.send(
								new lib.RoleDeleteRequest(roleId)
							).then(() => {
								navigate("/roles");
							}).catch(notifyErrorHandler("Error deleting role"));
						}}
					>
						<Button danger >
							<DeleteOutlined />
						</Button>
					</Popconfirm>}
				</>}
			/>
			<Form.Item name="name" label="Name">
				<Input disabled={!canUpdate}/>
			</Form.Item>
			<Form.Item name="description" label="Description">
				<Input disabled={!canUpdate}/>
			</Form.Item>
			<h3>Permissions</h3>
			{[...lib.permissions.values()].map(({name, title, description}) => (
				<Form.Item
					name={["permissions", name]}
					key={name}
					label={title}
					tooltip={description}
					valuePropName="checked"
					labelCol={{ sm: { span: 22, push: 2 }}}
					wrapperCol={{ sm: { span: 2, pull: 22 }}}
					labelAlign="left"
					colon={false}
				>
					<Checkbox disabled={!canUpdate} />
				</Form.Item>
			))}
		</Form>
		<PluginExtra component="RoleViewPage" role={role} />
	</PageLayout>;
}
