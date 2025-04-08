import React, { Fragment, useState, useContext, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, Input, Modal, Popconfirm, Space, Table, Typography, Upload } from "antd";
import ImportOutlined from "@ant-design/icons/ImportOutlined";
import PlusOutlined from "@ant-design/icons/PlusOutlined";
import SearchOutlined from "@ant-design/icons/SearchOutlined";

import * as lib from "@clusterio/lib";

import { useAccount } from "../model/account";
import { useMods } from "../model/mods";
import { useModPacks } from "../model/mod_pack";
import { notifyErrorHandler } from "../util/notify";
import ControlContext from "./ControlContext";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import PluginExtra from "./PluginExtra";
import SectionHeader from "./SectionHeader";
import ModDetails from "./ModDetails";
import { Dropzone } from "./Dropzone";
import UploadButton from "./UploadButton";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

function ImportModPackButton() {
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();
	function close() {
		setOpen(false);
	}
	return <>
		<Button icon={<ImportOutlined />} onClick={() => { setOpen(true); }}>Import string</Button>
		<Modal
			title="Import Mod Pack String"
			open={open}
			okText="Import"
			cancelText="Cancel"
			onCancel={() => { setOpen(false); }}
			onOk={() => {
				(async () => {
					let values;
					try {
						values = await form.validateFields();
					} catch {
						return; // Validation failed
					}
					const modPack = lib.ModPack.fromModPackString(values.string);
					await control.send(new lib.ModPackCreateRequest(modPack));
					navigate(`/mods/mod-packs/${modPack.id}/view`);
				})().catch(notifyErrorHandler("Error creating mod pack"));
			}}
		>
			<Form form={form} layout="vertical">
				<Form.Item
					name="string"
					rules={[
						{ required: true },
						{
							async validator(rule, value) {
								if (value) {
									lib.ModPack.fromModPackString(value);
								}
							},
						},
					]}
				>
					<Input.TextArea autoSize={{ minRows: 6, maxRows: 6 }} />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

function CreateModPackButton() {
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [open, setOpen] = useState(false);
	let [form] = Form.useForm();
	function close() {
		setOpen(false);
	}
	return <>
		<Button type="primary" icon={<PlusOutlined />} onClick={() => { setOpen(true); }}>Create</Button>
		<Modal
			title="Create Mod Pack"
			open={open}
			okText="Create"
			cancelText="Cancel"
			onCancel={() => { setOpen(false); }}
			onOk={() => {
				(async () => {
					let values;
					try {
						values = await form.validateFields();
					} catch {
						return; // Validation failed
					}
					const modPack = lib.ModPack.fromJSON({
						name: values.name,
						description: values.description,
						factorio_version: values.factorioVersion,
					} as any);
					await control.send(new lib.ModPackCreateRequest(modPack));
					navigate(`/mods/mod-packs/${modPack.id}/view`);
				})().catch(notifyErrorHandler("Error creating mod pack"));
			}}
		>
			<Form form={form} layout="vertical" requiredMark="optional">
				<Form.Item name="name" label="Name" rules={[{ required: true }]}>
					<Input />
				</Form.Item>
				<Form.Item name="description" label="Description">
					<Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
				</Form.Item>
				<Form.Item
					name="factorioVersion"
					label="Factorio Version"
					rules={[{
						required: true,
						pattern: /^\d+\.\d+(\.\d+)?$/,
						message: "Must be an a.b or a.b.c version number.",
					}]}
				>
					<Input />
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

function SearchModsButton() {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [open, setOpen] = useState(false);
	const [form] = Form.useForm();
	const [searchText, setSearchText] = useState("");
	const [factorioVersion, setFactorioVersion] = useState("1.1");
	const [modResults, setModResults] = useState<any[]>([]);
	const [loading, setLoading] = useState(false);
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(10);
	const [totalResults, setTotalResults] = useState(0);
	const [totalPages, setTotalPages] = useState(0);
	const [sort, setSort] = useState<string>("name");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

	// Search mods when search parameters change
	useEffect(() => {
		if (!open) { return; }

		setLoading(true);
		let canceled = false;

		control.send(new lib.ModPortalSearchRequest(
			searchText,
			factorioVersion,
			page,
			pageSize,
			sort,
			sortOrder
		)).then(response => {
			if (canceled) { return; }

			setModResults(response.results);
			setTotalResults(response.resultCount);
			setTotalPages(response.pageCount);
			setLoading(false);
		}).catch(error => {
			if (canceled) { return; }
			setLoading(false);
		});

		// eslint-disable-next-line consistent-return
		return () => {
			canceled = true;
		};
	}, [open, searchText, factorioVersion, page, pageSize, sort, sortOrder, control]);

	const handleSearch = () => {
		const values = form.getFieldsValue();
		setSearchText(values.name || "");
		setFactorioVersion(values.factorioVersion || "1.1");
		setPage(1); // Reset to first page on new search
	};

	const handleTableChange = (
		pagination: any,
		filters: any,
		sorter: any
	) => {
		if (pagination.current !== page) {
			setPage(pagination.current);
		}
		if (pagination.pageSize !== pageSize) {
			setPageSize(pagination.pageSize);
		}

		if (sorter.field && sorter.order) {
			setSort(sorter.field);
			setSortOrder(sorter.order === "ascend" ? "asc" : "desc");
		}
	};

	const getColumnSortOrder = (columnKey: string): "ascend" | "descend" | undefined => {
		if (sort === columnKey) {
			return sortOrder === "asc" ? "ascend" : "descend";
		}
		return undefined;
	};

	return <>
		<Button icon={<SearchOutlined />} onClick={() => { setOpen(true); }}>Search</Button>
		<Modal
			title="Search Mods"
			open={open}
			onCancel={() => { setOpen(false); }}
			width={800}
			footer={[
				<Button key="close" onClick={() => { setOpen(false); }}>
					Close
				</Button>,
				<Button key="search" type="primary" onClick={handleSearch}>
					Search
				</Button>,
			]}
		>
			<Form
				form={form}
				layout="vertical"
				onFinish={handleSearch}
				initialValues={{ factorioVersion: "2.0" }}
			>
				<Form.Item name="name" label="Name or Title">
					<Input placeholder="Enter mod name or title" />
				</Form.Item>
				<Form.Item name="factorioVersion" label="Factorio Version">
					<Input placeholder="e.g. 1.1" />
				</Form.Item>
			</Form>

			<Table
				dataSource={modResults}
				rowKey={record => record.name}
				loading={loading}
				onChange={handleTableChange}
				pagination={{
					current: page,
					pageSize: pageSize,
					total: totalResults,
					showSizeChanger: true,
					pageSizeOptions: ["10", "20", "50"],
				}}
				expandable={{
					expandedRowRender: record => (
						<div>
							<p><strong>Summary:</strong> {record.summary ?? "N/A"}</p>
							<p><strong>Downloads:</strong> {record.downloads_count ?? "N/A"}</p>
							<p><strong>Latest Release:</strong></p>
							{record.latest_release ? (
								<ul>
									<li>Version: {record.latest_release.version ?? "N/A"}</li>
									<li>
										Factorio Version: {
											record.latest_release.factorio_version ?? "N/A"
										}
									</li>
									<li>
										Released: {
											record.latest_release.released_at
												? new Date(record.latest_release.released_at).toLocaleString()
												: "N/A"
										}
									</li>
								</ul>
							) : <p>No release information available.</p>}
							{account.hasPermission("core.mod.download") && record.latest_release && (
								<Button
									onClick={() => {
										control.send(
											new lib.ModDownloadRequest(record.name, record.latest_release.version)
										).then((streamId: string) => {
											let url = new URL(webRoot, document.location.origin);
											url.pathname += `api/stream/${streamId}`;
											document.location = url.href;
										}).catch(
											notifyErrorHandler("Error downloading mod")
										);
									}}
									// Disable button if version is missing
									disabled={!record.latest_release.version}
								>
									Download Latest Version
								</Button>
							)}
						</div>
					),
				}}
				columns={[
					{
						title: "Name",
						dataIndex: "name",
						key: "name",
						sorter: true,
						sortOrder: getColumnSortOrder("name"),
					},
					{
						title: "Title",
						dataIndex: "title",
						key: "title",
						sorter: true,
						sortOrder: getColumnSortOrder("title"),
					},
					{
						title: "Author",
						dataIndex: "owner",
						key: "owner",
						sorter: true,
						sortOrder: getColumnSortOrder("owner"),
					},
					{
						title: "Latest Version",
						key: "version",
						render: (_, record) => record.latest_release?.version ?? "N/A",
					},
				]}
			/>
		</Modal>
	</>;
}

export default function ModsPage() {
	let account = useAccount();
	let control = useContext(ControlContext);
	let navigate = useNavigate();
	let [mods] = useMods();
	let [modPacks] = useModPacks();

	function actions(mod: lib.ModInfo) {
		return <Space>
			{account.hasPermission("core.mod.download")
				&& <Typography.Link
					onClick={() => {
						control.send(
							new lib.ModDownloadRequest(mod.name, mod.version)
						).then((streamId: string) => {
							let url = new URL(webRoot, document.location.origin);
							url.pathname += `api/stream/${streamId}`;
							document.location = url.href;
						}).catch(
							notifyErrorHandler("Error downloading save")
						);
					}}
				>download</Typography.Link>
			}
			{account.hasPermission("core.mod.delete")
				&& <Popconfirm
					title={`Delete ${mod.filename}?`}
					onConfirm={event => {
						control.send(
							new lib.ModDeleteRequest(mod.name, mod.version)
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
			showUploadList={false}
			headers={{
				"X-Access-Token": control.connector.token || "",
			}}
			action={`${webRoot}api/upload-mod`}
		>
			<UploadButton />
		</Upload>;
	}

	return <PageLayout nav={[{ name: "Mods" }]}>
		<PageHeader title="Mods" />
		<SectionHeader
			title="Mod Packs"
			extra={<Space>
				{account.hasPermission("core.mod_pack.create") && <ImportModPackButton />}
				{account.hasPermission("core.mod_pack.create") && <CreateModPackButton />}
			</Space>}
		/>
		<Table
			columns={[
				{
					title: "Name",
					dataIndex: "name",
					defaultSortOrder: "ascend",
					sorter: (a, b) => strcmp(a.name, b.name),
				},
				{
					title: "Factorio Version",
					dataIndex: "factorioVersion",
					sorter: (a, b) => a.integerFactorioVersion - b.integerFactorioVersion,
				},
				{
					title: "Mods",
					key: "mods",
					render: (_, modPack) => modPack.mods.size,
				},
			]}
			dataSource={[...modPacks.values()]}
			pagination={false}
			rowKey={modPack => Number(modPack.id)}
			onRow={(modPack, rowIndex) => ({
				onClick: event => {
					navigate(`/mods/mod-packs/${modPack.id}/view`);
				},
			})}
		/>
		<SectionHeader title="Stored Mods" extra={<Space>
			<SearchModsButton />
			{uploadButton}
		</Space>} />

		<Upload.Dragger
			className="save-list-dragger"
			openFileDialogOnClick={false}
			name="file"
			accept=".zip"
			multiple
			headers={{
				"X-Access-Token": control.connector.token || "",
			}}
			action={`${webRoot}api/upload-mod`}
			showUploadList={false}
		>
			<Dropzone />
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
						render: (_, mod) => <>
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
						render: (_, mod) => lib.formatBytes(mod.size),
						align: "right",
						sorter: (a, b) => a.size - b.size,
					},
					{
						title: "Action",
						key: "action",
						responsive: ["lg"],
						render: (_, mod) => actions(mod),
					},
				]}
				expandable={{
					expandedRowRender: (mod: lib.ModInfo) => <ModDetails mod={mod} actions={actions} />,
					expandedRowClassName: () => "no-expanded-padding",
				}}
				dataSource={[...mods.values()]}
				pagination={false}
				rowKey={mod => mod.id}
			/>
		</Upload.Dragger>
		<PluginExtra component="ModsPage" />
	</PageLayout>;
}
