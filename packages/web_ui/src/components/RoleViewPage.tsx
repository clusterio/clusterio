import React, { useEffect, useContext, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Checkbox, Form, Input, Popconfirm, Spin } from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import { notifyErrorHandler } from "../util/notify";


export type RawRoleState = Partial<lib.Role> & {
	loading?: boolean;
	missing?: boolean;
	present?: boolean;
};
function useRole(id: number): [RawRoleState, () => void] {
	let control = useContext(ControlContext);
	let [role, setRole] = useState<RawRoleState>({ loading: true });

	function updateRole() {
		// XXX optimize by requesting only the role in question
		control.send(new lib.RoleListRequest()).then(roles => {
			let match = roles.find(u => u.id === id);
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

	let navigate = useNavigate();

	let account = useAccount();
	let control = useContext(ControlContext);
	let [role, updateRole] = useRole(roleId);
	let [edited, setEdited] = useState(false);


	let nav = [{ name: "Roles", path: "/roles" }, { name: role.name || String(roleId) }];
	if (role.loading) {
		return <PageLayout nav={nav}>
			<PageHeader title={String(roleId)} />
			<Spin size="large" />
		</PageLayout>;
	}

	if (role.missing) {
		return <PageLayout nav={nav}>
			<PageHeader title="Role not found" />
			<p>Role with id {roleId} was not found on the controller.</p>
		</PageLayout>;
	}

	let initialValues = {
		name: role["name"],
		description: role["description"],
		permissions: {
			...Object.fromEntries([...lib.permissions.values()].map(perm => [
				perm.name, [...role.permissions!].includes(perm.name),
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
					updateRole();
				}).catch(notifyErrorHandler("Error applying changes"));
			}}
		>
			<PageHeader
				title={role.name!}
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
