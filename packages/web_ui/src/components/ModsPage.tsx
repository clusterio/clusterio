import React, { Fragment, useState, useContext, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
	Button, Form, Input, Modal, Popconfirm, Space, Table, Typography, Upload, Alert, Select, Tooltip, notification,
} from "antd";
import {
	ImportOutlined, PlusOutlined, SearchOutlined, DownloadOutlined,
} from "@ant-design/icons";
import { Static } from "@sinclair/typebox";

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

// Define the allowed Factorio versions based on the lib schema
type FactorioVersion = Static<(typeof lib.ModPortalGetAllRequest)["allowedVersions"][number]>;

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

// Define a basic type for the mod data we expect back from the new backend request
// This should ideally match the structure returned by the backend.
// We reuse the ModPortalMod structure name for convenience, but it's fetched via backend.
interface ModPortalMod {
	name: string;
	title: string;
	owner: string;
	summary: string;
	downloads_count: number;
	category: string;
	score?: number;
	latest_release?: {
		download_url: string;
		file_name: string;
		info_json: { factorio_version: string; };
		released_at: string;
		version: string;
		sha1: string;
	};
}

function SearchModsButton() {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [open, setOpen] = useState(false);
	const [form] = Form.useForm();
	const [searchText, setSearchText] = useState("");
	const [factorioVersion, setFactorioVersion] = useState<FactorioVersion>("2.0");

	// State for all mods fetched from backend
	const [allMods, setAllMods] = useState<ModPortalMod[]>([]);
	const [loading, setLoading] = useState<boolean>(false);
	const [error, setError] = useState<Error | null>(null);

	// State for client-side pagination and sorting
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(10);
	const [sort, setSort] = useState<string>("name");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

	// Function to handle download from Mod Portal to Controller
	const handleControllerDownload = (
		modName: string,
		modTitle: string | undefined,
		modVersion: string | undefined,
		portalFactorioVersion: FactorioVersion,
	) => {
		if (modVersion) {
			control.send(
				new lib.ModPortalDownloadRequest(
					modName,
					modVersion,
					portalFactorioVersion
				)
			).then(() => {
				notification.success({
					message: "Download started",
					description: `${modTitle || modName} v${
						modVersion
					} is being downloaded to the controller.`,
				});
			}).catch(
				notifyErrorHandler("Error starting mod download")
			);
		}
	};

	// Fetch all mods from backend when modal opens or version changes
	useEffect(() => {
		if (!open || !factorioVersion) {
			setAllMods([]); // Clear mods if modal closed or no version
			return;
		}

		setLoading(true);
		setError(null);
		let canceled = false;

		// Use the hypothetical new backend request
		control.send(
			// Factorio version state now matches the required type
			new lib.ModPortalGetAllRequest(factorioVersion)
		).then((response: any) => {
			if (canceled) { return; }
			// *** Backend Change Needed: Ensure the response has a 'mods' array ***
			setAllMods(response?.mods || []); // Added optional chaining
			setLoading(false);
		}).catch(err => {
			if (canceled) { return; }
			notifyErrorHandler("Error fetching mods from portal")(err);
			setError(err);
			setAllMods([]);
			setLoading(false);
		});

		// eslint-disable-next-line consistent-return
		return () => {
			canceled = true;
		};
		// Re-fetch when modal opens or factorio version changes
	}, [open, factorioVersion, control]);


	// Memoize the filtered, sorted, and paginated mods (logic remains the same)
	const displayedMods = useMemo(() => {
		let filtered = allMods;

		// Apply search filter (case-insensitive)
		if (searchText) {
			const lowerSearchText = searchText.toLowerCase();
			filtered = filtered.filter(mod => mod.name.toLowerCase().includes(lowerSearchText)
				|| mod.title.toLowerCase().includes(lowerSearchText)
			);
		}

		// Apply sorting
		if (sort && sortOrder) {
			filtered = [...filtered].sort((a, b) => {
				let aValue: any = a[sort as keyof ModPortalMod] ?? "";
				let bValue: any = b[sort as keyof ModPortalMod] ?? "";

				// Handle specific types if necessary (e.g., numbers, dates)
				if (sort === "downloads_count") {
					aValue = a.downloads_count ?? 0;
					bValue = b.downloads_count ?? 0;
					return sortOrder === "asc" ? aValue - bValue : bValue - aValue;
				}

				// Default string comparison
				const comparison = strcmp(String(aValue), String(bValue));
				return sortOrder === "asc" ? comparison : -comparison;
			});
		}

		// Apply pagination
		const startIndex = (page - 1) * pageSize;
		return filtered.slice(startIndex, startIndex + pageSize);

	}, [allMods, searchText, sort, sortOrder, page, pageSize]);

	// Calculate total results based on the filtered list *before* pagination (logic remains the same)
	const totalResults = useMemo(() => {
		let filtered = allMods;
		if (searchText) {
			const lowerSearchText = searchText.toLowerCase();
			filtered = filtered.filter(mod => mod.name.toLowerCase().includes(lowerSearchText)
				|| mod.title.toLowerCase().includes(lowerSearchText)
			);
		}
		return filtered.length;
	}, [allMods, searchText]);

	// Update search text and factorio version from form
	const handleSearch = (changedValues: any, allValues: any) => {
		const nameValue = allValues.name;
		const versionValue = allValues.factorioVersion as FactorioVersion | undefined;

		// Only trigger state updates if values actually changed
		if (nameValue !== searchText) {
			setSearchText(nameValue || "");
		}
		if (versionValue && versionValue !== factorioVersion) {
			setFactorioVersion(versionValue);
			setAllMods([]); // Clear mods when version changes, useEffect will fetch new ones
			setLoading(true); // Show loading indicator immediately
		}
		// Reset page only if search text or version changed
		if (nameValue !== searchText || (versionValue && versionValue !== factorioVersion)) {
			setPage(1);
		}
	};

	// Update pagination and sorting state when table changes (logic remains the same)
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
			setPage(1); // Reset to first page if page size changes
		}

		// Update sort state if sorter exists and has changed
		if (sorter.field && (sorter.field !== sort || sorter.order !== (sortOrder === "asc" ? "ascend" : "descend"))) {
			setSort(sorter.field);
			setSortOrder(sorter.order === "ascend" ? "asc" : "desc");
			setPage(1); // Reset to first page on sort change
		} else if (!sorter.field && sort !== "name") { // Reset only if not already default
			// Clear sort if column header clicked without order - default to name ascending
			setSort("name");
			setSortOrder("asc");
			setPage(1);
		}
	};

	// Helper to get antd sort order format (logic remains the same)
	const getColumnSortOrder = (columnKey: string): "ascend" | "descend" | undefined => {
		if (sort === columnKey) {
			return sortOrder === "asc" ? "ascend" : "descend";
		}
		return undefined;
	};

	return <>
		<Button icon={<SearchOutlined />} onClick={() => { setOpen(true); }}>Search</Button>
		<Modal
			title="Search Mod Portal"
			open={open}
			onCancel={() => { setOpen(false); }}
			width={1000}
			footer={[
				<Button key="close" onClick={() => { setOpen(false); }}>
					Close
				</Button>,
				// Remove explicit search button as form updates trigger search/filter
			]}
		>
			<Form
				form={form}
				layout="horizontal"
				labelCol={{ span: 6 }}
				wrapperCol={{ span: 18 }}
				onValuesChange={handleSearch}
				initialValues={{ factorioVersion: factorioVersion, name: searchText }}
			>
				<Form.Item name="name" label="Filter by Name or Title">
					<Input placeholder="Start typing to filter..." />
				</Form.Item>
				<Form.Item
					name="factorioVersion"
					label="Factorio Version"
				>
					<Select>
						{/* Map allowed versions to Select Options */}
						<Select.Option value="2.0">2.0</Select.Option>
						<Select.Option value="1.1">1.1</Select.Option>
						<Select.Option value="1.0">1.0</Select.Option>
						<Select.Option value="0.18">0.18</Select.Option>
						<Select.Option value="0.17">0.17</Select.Option>
						<Select.Option value="0.16">0.16</Select.Option>
						<Select.Option value="0.15">0.15</Select.Option>
						<Select.Option value="0.14">0.14</Select.Option>
						<Select.Option value="0.13">0.13</Select.Option>
					</Select>
				</Form.Item>
			</Form>

			{/* Display error message if fetching failed */}
			{error && <Alert
				message="Error Fetching Mods"
				description={error.message}
				type="error"
				showIcon
				style={{ marginBottom: 16 }}
			/>}

			<Table
				dataSource={displayedMods}
				rowKey={record => record.name}
				loading={loading}
				onChange={handleTableChange}
				pagination={{
					current: page,
					pageSize: pageSize,
					total: totalResults,
					showSizeChanger: true,
					pageSizeOptions: ["10", "20", "50", "100"],
				}}
				expandable={{
					expandedRowRender: record => (
						<div>
							<p><strong>Summary:</strong> {record.summary ?? "N/A"}</p>
							<p><strong>Downloads:</strong> {record.downloads_count?.toLocaleString() ?? "N/A"}</p>
							<p><strong>Latest Release:</strong></p>
							{record.latest_release ? (
								<ul>
									<li>Version: {record.latest_release.version ?? "N/A"}</li>
									<li>
										Factorio Version: {
											record.latest_release.info_json?.factorio_version ?? "N/A"
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
							{/* Download button logic remains the same, assuming backend handles downloads */}
							{account.hasPermission("core.mod.download") && record.latest_release && (
								<Button
									onClick={() => {
										handleControllerDownload(
											record.name,
											record.title,
											record.latest_release?.version,
											factorioVersion
										);
									}}
									disabled={!record.latest_release?.version}
								>
									Download Latest Version
								</Button>
							)}
						</div>
					),
				}}
				columns={[
					// Columns remain largely the same
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
						title: "Downloads",
						dataIndex: "downloads_count",
						key: "downloads_count",
						sorter: true,
						sortOrder: getColumnSortOrder("downloads_count"),
						align: "right",
						render: (count) => count?.toLocaleString() ?? "N/A",
					},
					{
						title: "Latest Version",
						key: "version",
						render: (_, record) => record.latest_release?.version ?? "N/A",
					},
					{
						title: "Actions",
						key: "actions",
						align: "center",
						render: (_, record) => (
							<Space>
								<Tooltip title="Open in Factorio Mod Portal">
									<Typography.Link
										href={`https://mods.factorio.com/mod/${record.name}`}
										target="_blank"
										rel="noopener noreferrer"
									>
										<img
											src="https://mods.factorio.com/static/favicon.ico"
											alt="Factorio Mod Portal"
											style={{ height: "1em", verticalAlign: "middle" }}
										/>
									</Typography.Link>
								</Tooltip>
								{account.hasPermission("core.mod.download") && record.latest_release && (
									<Tooltip title="Download to Controller">
										<Button
											type="text"
											icon={<DownloadOutlined />}
											disabled={!record.latest_release?.version}
											onClick={() => {
												handleControllerDownload(
													record.name,
													record.title,
													record.latest_release?.version,
													factorioVersion
												);
											}}
										/>
									</Tooltip>
								)}
							</Space>
						),
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
