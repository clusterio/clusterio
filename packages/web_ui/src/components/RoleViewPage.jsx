import React, { useEffect, useContext, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import { Button, Checkbox, Form, Input, PageHeader, Popconfirm, Spin } from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";

import { libLink, libUsers } from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { notifyErrorHandler } from "../util/notify";


function useRole(id) {
	let control = useContext(ControlContext);
	let [role, setRole] = useState({ loading: true });

	function updateRole() {
		// XXX optimize by requesting only the role in question
		libLink.messages.listRoles.send(control).then(result => {
			let match = result.list.find(u => u.id === id);
			if (!match) {
				setRole({ missing: true });
			} else {
				setRole({
					...match,
					present: true,
				});
			}
		});
	}

	useEffect(() => {
		updateRole();
	}, [id]);

	return [role, updateRole];
}

export default function RoleViewPage() {
	let params = useParams();
	let roleId = Number(params.id);

	let history = useHistory();

	let account = useAccount();
	let control = useContext(ControlContext);
	let [role, updateRole] = useRole(roleId);
	let [edited, setEdited] = useState(false);


	let nav = [{ name: "Roles", path: "/roles" }, { name: role["name"] || roleId }];
	if (role.loading) {
		return <PageLayout nav={nav}>
			<PageHeader
				className="site-page-header"
				title={roleId}
			/>
			<Spin size="large" />
		</PageLayout>;
	}

	if (role.missing) {
		return <PageLayout nav={nav}>
			<PageHeader
				className="site-page-header"
				title="Role not found"
			/>
			<p>Role with id {roleId} was not found on the controller.</p>
		</PageLayout>;
	}

	let initialValues = {
		name: role["name"],
		description: role["description"],
		permissions: {
			...Object.fromEntries([...libUsers.permissions.values()].map(perm => [
				perm.name, role["permissions"].includes(perm.name),
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

				libLink.messages.updateRole.send(control, {
					id: roleId,
					name: values.name || "",
					description: values.description || "",
					permissions: newPermissions,
				}).then(() => {
					setEdited(false);
					updateRole();
				}).catch(notifyErrorHandler("Error applying changes"));
			}}
		>
			<PageHeader
				className="site-page-header"
				title={role["name"]}
				extra={<>
					{canUpdate && <Button type={edited ? "primary" : "default"} htmlType="submit">Apply</Button>}
					{account.hasPermission("core.role.delete") && <Popconfirm
						title="Delete role?"
						placement="bottomRight"
						okText="Delete"
						okButtonProps={{ danger: true }}
						onConfirm={() => {
							libLink.messages.deleteRole.send(
								control, { id: roleId }
							).then(() => {
								history.push("/roles");
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
			{[...libUsers.permissions.values()].map(({name, title, description}) => (
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
