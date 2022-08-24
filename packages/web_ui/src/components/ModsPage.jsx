import React, { Fragment, useContext } from "react";
import { Button, Descriptions, Grid, PageHeader, Popconfirm, Space, Table, Typography, Upload } from "antd";
import UploadOutlined from "@ant-design/icons/UploadOutlined";

import { libHelpers, libLink } from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useModList } from "../model/mods";
import { notifyErrorHandler } from "../util/notify";
import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";

const { useBreakpoint } = Grid;
const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;


export default function ModsPage() {
	let account = useAccount();
	let control = useContext(ControlContext);
	let [modList] = useModList();
	let screens = useBreakpoint();

	function actions(mod) {
		return <Space>
			{account.hasPermission("core.mod.download")
				&& <Typography.Link
					onClick={() => {
						libLink.messages.downloadMod.send(
							control, { name: mod.name, version: mod.version }
						).then(response => {
							let url = new URL(webRoot, document.location);
							url.pathname += `api/stream/${response.stream_id}`;
							document.location = url;
						}).catch(
							notifyErrorHandler("Error downloading save")
						);
					}}
				>download</Typography.Link>
			}
			{account.hasPermission("core.mod.delete")
				&& <Popconfirm
					title="Are you sure you want to delete this mod?"
					onConfirm={event => {
						libLink.messages.deleteMod.send(
							control, { name: mod.name, version: mod.version }
						).catch(notifyErrorHandler("Error deleting mod"));
					}}
					okText="Delete"
					okButtonProps={{ danger: true }}
				>
					<Typography.Link type="danger">delete</Typography.Link>
				</Popconfirm>
			}
		</Space>;
	}

	let uploadButton;
	if (account.hasPermission("core.mod.upload")) {
		uploadButton = <Upload
			name="file"
			accept=".zip"
			multiple
			headers={{
				"X-Access-Token": control.connector.token,
			}}
			action={`${webRoot}api/upload-mod`}
		>
			<Button icon={<UploadOutlined/>}>Upload</Button>
		</Upload>;
	}

	return <PageLayout nav={[{ name: "Mods" }]}>
		<PageHeader
			className="site-page-header"
			title="Mods"
			extra={uploadButton}
		/>
		<Table
			columns={[
				{
					title: "Name",
					dataIndex: "title",
					defaultSortOrder: "ascend",
					sorter: (a, b) => (
						strcmp(a.name, b.name) || a.integerVersion - b.integerVersion
					),
				},
				{
					title: "Version",
					key: "version",
					align: "right",
					render: mod => <>
						{`${mod.version} `}
						<Typography.Text type="secondary">{`/ ${mod.factorioVersion}`}</Typography.Text>
					</>,
				},
				{
					title: "Filename",
					dataIndex: "filename",
					responsive: ["xl"],
					sorter: (a, b) => strcmp(a.filename, b.filename),
				},
				{
					title: "Size",
					key: "size",
					responsive: ["lg"],
					render: mod => libHelpers.formatBytes(mod.size),
					align: "right",
					sorter: (a, b) => a.size - b.size,
				},
				{
					title: "Action",
					key: "action",
					responsive: ["lg"],
					render: mod => actions(mod),
				},
			]}
			expandable={{
				expandedRowRender: mod => <>
					<Descriptions className="borderless" bordered size="small" column={{ xs: 1, sm: 1, md: 1, lg: 2 }}>
						{!screens.lg
							&& <Descriptions.Item label="Action">{actions(mod)}</Descriptions.Item>
						}
						<Descriptions.Item label="Title">{mod.title}</Descriptions.Item>
						<Descriptions.Item label="Version">{mod.version}</Descriptions.Item>
						{mod.description
							&& <Descriptions.Item label="Description" span={2}>{mod.description}</Descriptions.Item>
						}
						<Descriptions.Item label="Author" span={2}>{mod.author}</Descriptions.Item>
						<Descriptions.Item label="Mod&nbsp;Portal" span={2}>
							<Typography.Link href={`https://mods.factorio.com/mod/${mod.name}`}>
								{`https://mods.factorio.com/mod/${mod.name}`}
							</Typography.Link>
						</Descriptions.Item>
						{mod.contact
							&& <Descriptions.Item label="Contact" span={2}>{mod.contact}</Descriptions.Item>
						}
						{mod.homepage
							&& <Descriptions.Item label="Homepage" span={2}>{mod.homepage}</Descriptions.Item>
						}
						<Descriptions.Item label="Internal&nbsp;Name">{mod.name}</Descriptions.Item>
						<Descriptions.Item label="Factorio&nbsp;Version">{mod.factorioVersion}</Descriptions.Item>
						<Descriptions.Item label="Filename">{mod.filename}</Descriptions.Item>
						<Descriptions.Item label="Size">{libHelpers.formatBytes(mod.size)}</Descriptions.Item>
						<Descriptions.Item label="Hash" span={2}>{mod.hash}</Descriptions.Item>
						{mod.dependencies.length
							&& <Descriptions.Item label="Dependencies" span={2}>
								{mod.dependencies
									.filter(e => !e.startsWith("(?)"))
									.map((e, i) => <Fragment key={i}>{e}<br/></Fragment>)
								}
							</Descriptions.Item>
						}
					</Descriptions>
				</>,
				expandedRowClassName: () => "no-expanded-padding",
			}}
			dataSource={modList}
			pagination={false}
			rowKey={mod => `${mod.name}_${mod.version}`}
		/>
		<PluginExtra component="ModsPage" />
	</PageLayout>;
}
