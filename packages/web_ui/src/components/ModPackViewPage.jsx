import React, { Fragment, memo, useCallback, useEffect, useContext, useRef, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import {
	Button, Card, Checkbox, Col, ConfigProvider, Descriptions, Form, Input, Pagination,
	Popconfirm, Row, Table, Tag, Typography, Select, Skeleton, Space, Spin, Switch, Modal, Tooltip,
} from "antd";
import InfoCircleOutlined from "@ant-design/icons/InfoCircleOutlined";
import ExportOutlined from "@ant-design/icons/ExportOutlined";
import FileUnknownOutlined from "@ant-design/icons/FileUnknownOutlined";
import FileExclamationOutlined from "@ant-design/icons/FileExclamationOutlined";
import CloseOutlined from "@ant-design/icons/CloseOutlined";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";
import PlusOutlined from "@ant-design/icons/PlusOutlined";
import UploadOutlined from "@ant-design/icons/UploadOutlined";

import { libData, libLogging } from "@clusterio/lib";
import ControlContext from "./ControlContext";
import { useAccount } from "../model/account";
import { useModPack } from "../model/mod_pack";
import { useModList } from "../model/mods";
import { useClipboard } from "../util/clipboard";
import notify, { notifyErrorHandler } from "../util/notify";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import SectionHeader from "./SectionHeader";
import ModDetails from "./ModDetails";

const { logger } = libLogging;
const { Paragraph, Text } = Typography;
const strcmp = new Intl.Collator(undefined, { numerice: "true", sensitivity: "base" }).compare;

function SearchModsTable(props) {
	const control = useContext(ControlContext);
	const [searchText, setSearchText] = useState("");
	const [modResultSort, setModResultSort] = useState("title");
	const [modResultSortOrder, setModResultSortOrder] = useState("asc");
	const [modResults, setModResults] = useState([]);
	const [modResultPage, setModResultPage] = useState(1);
	const [modResultPageSize, setModResultPageSize] = useState(10);
	const [modResultCount, setModResultCount] = useState(2);
	const [modResultSelectedVersion, setModResultSelectedVersion] = useState(new Map());

	const factorioVersion = props.modPack.factorioVersion.split(".").slice(0, 2).join(".");

	useEffect(() => {
		let canceled = false;
		control.send(new libData.ModSearchRequest(
			searchText,
			factorioVersion,
			modResultPage,
			modResultPageSize,
			modResultSort,
			modResultSortOrder,
		)).then(response => {
			if (canceled) {
				return;
			}
			// In React < v18 this causes 3 renders and a partial state necessitating the use
			// of || 0 on modResultSelectedVersion.get() calls. Remove when updating React.
			setModResults(response.results);
			setModResultSelectedVersion(new Map(response.results.map(({ name, versions }) => [name, 0])));
			setModResultCount(response.result_count);
		});

		return () => {
			canceled = true;
		};
	}, [searchText, factorioVersion, modResultPageSize, modResultPage, modResultSort, modResultSortOrder]);

	function modResultPageChanged(page, pageSize) {
		setModResultPage(page);
		setModResultPageSize(pageSize);
	}

	function modResultsTableChanged(pagination, filters, sorters, extra) {
		if (extra.action === "sort") {
			if (sorters.order) {
				const mapping = {
					ascend: "asc",
					descend: "desc",
				};
				setModResultSort(sorters.columnKey);
				setModResultSortOrder(mapping[sorters.order]);
			} else {
				setModResultSort(undefined);
				setModResultSortOrder(undefined);
			}
		}
	}

	function actions(mod) {
		return <Space>
			{(!props.modPack.mods.has(mod.name) || props.modPack.mods.get(mod.name).version !== mod.version)
				&& <Typography.Link
					onClick={() => {
						props.onChange({
							type: "mods.set",
							name: mod.name,
							value: { name: mod.name, enabled: true, version: mod.version, sha1: mod.sha1 },
						});
					}}
				>{props.modPack.mods.has(mod.name) ? "change" : "add"}</Typography.Link>
			}
			{props.modPack.mods.has(mod.name)
				&& <Typography.Link
					type="danger"
					onClick={() => {
						props.onChange({
							type: "mods.delete",
							name: mod.name,
							value: { name: mod.name, version: mod.version, sha1: mod.sha1 },
						});
					}}
				>remove</Typography.Link>
			}
		</Space>;
	}

	return <>
		<Input
			placeholder="Search Mods"
			style={{ marginBottom: 8 }}
			onChange={(event) => {
				let search = event.target.value.trim();
				setSearchText(search);
				setModResultPage(1);
			}}
		/>
		<SectionHeader
			title="Stored Mods"
			extra={<Pagination
				current={modResultPage}
				onChange={modResultPageChanged}
				total={modResultCount}
				showTotal={total => `${total} results`}
				showSizeChanger={true}
				size="small"
			/>}
		/>
		<ConfigProvider renderEmpty={() => "No results"}>
			<Table
				size="small"
				columns={[
					{
						title: "Title",
						key: "title",
						render: results => results.versions[0].title,
						defaultSortOrder: "ascend",
						sorter: true,
					},
					{
						title: "Author",
						key: "author",
						render: results => results.versions[0].author,
						responsive: ["lg"],
						sorter: true,
					},
					{
						title: "Version",
						key: "version",
						align: "right",
						render: result => <Select
							size="small"
							bordered={false}
							value={modResultSelectedVersion.get(result.name) || 0}
							onChange={index => {
								const newVersions = new Map(modResultSelectedVersion);
								newVersions.set(result.name, index);
								setModResultSelectedVersion(newVersions);
							}}
							options={result.versions.map((mod, index) => ({ label: mod.version, value: index }))}
						/>,
					},
					{
						title: "Action",
						key: "action",
						responsive: ["lg"],
						render: result => actions(result.versions[modResultSelectedVersion.get(result.name) || 0]),
					},
				]}
				expandable={{
					expandedRowRender: result => <ModDetails
						mod={result.versions[modResultSelectedVersion.get(result.name) || 0]}
						actions={actions}
					/>,
					expandedRowClassName: () => "no-expanded-padding",
				}}
				onChange={modResultsTableChanged}
				dataSource={modResults}
				pagination={false}
				rowKey="name"
			/>
		</ConfigProvider>
	</>;
}

function ModsTable(props) {
	const [showAddMods, setShowAddMods] = useState(false);
	const [modList] = useModList();

	const deletedMods = new Map();
	const changedMods = new Map();
	for (let change of props.changes) {
		if (props.modPack.mods.has(change.name)) {
			if (change.type === "mods.set") {
				changedMods.set(change.name, change.value);
			}
		} else if (change.type === "mods.delete") {
			deletedMods.set(change.name, change.value);
		}
	}

	const modListMap = new Map(modList.map(mod => [`${mod.name}_${mod.version}`, mod]));
	const mods = [...props.modPack.mods.values(), ...deletedMods.values()].map(
		mod => {
			const candidate = modListMap.get(`${mod.name}_${mod.version}`);
			if (!candidate) {
				return {
					...mod,
					error: "missing",
				};
			} else if (mod.sha1 && candidate.sha1 !== mod.sha1) {
				return {
					...mod,
					error: "bad_checksum",
				};
			}
			return candidate;
		}
	);

	function actions(mod) {
		return <Space>
			{!deletedMods.has(mod.name) && <Typography.Link
				type="danger"
				onClick={() => {
					props.onChange({
						type: "mods.delete",
						name: mod.name,
						value: mod,
					});
				}}
			>remove</Typography.Link>}
			{(deletedMods.has(mod.name) || changedMods.has(mod.name)) && <Typography.Link
				onClick={() => {
					props.onRevert({
						type: deletedMods.has(mod.name) ? "mods.delete" : "mods.set",
						name: mod.name,
						value: mod,
					});
				}}
			>revert</Typography.Link>}
		</Space>;
	}

	return <>
		<SectionHeader
			title="Mods"
			extra={<Space>
				<Button icon={<PlusOutlined />} onClick={() => setShowAddMods(true)}>Add</Button>
			</Space>}
		/>
		{showAddMods && <Card
			title="Add mods"
			size="small"
			extra={<Button type="text" icon={<CloseOutlined />} onClick={() => setShowAddMods(false)} />}
			style={{ marginBottom: 8 }}
		>
			<SearchModsTable modPack={props.modPack} changes={props.changes} onChange={props.onChange} />
		</Card>}
		<Table
			size="small"
			rowSelection={{
				type: "checkbox",
				selectedRowKeys: [...props.modPack.mods.values()].filter(mod => mod.enabled).map(mod => mod.name),
				getCheckboxProps(mod) {
					return { disabled: deletedMods.has(mod.name) };
				},
				onChange(selectedRowKeys, selectedRows) {
					function setEnabled(modNames, enabled) {
						for (let name of modNames) {
							props.onChange({
								type: "mods.set",
								name,
								value: { ...props.modPack.mods.get(name), enabled },
							});
						}
					}
					const added = selectedRowKeys.filter(key => !props.modPack.mods.get(key).enabled);
					const removed = [...props.modPack.mods.values()].filter(
						mod => mod.enabled && selectedRowKeys.indexOf(mod.name) === -1
					).map(mod => mod.name);
					setEnabled(added, true);
					setEnabled(removed, false);
				},
			}}
			columns={[
				{
					title: "Name",
					key: "name",
					render: mod => <>
						{mod.error === "missing" && <Tooltip title="Mod is missing from storage.">
							<FileUnknownOutlined style={{ color: "#a61d24" }} />{" "}
						</Tooltip>}
						{mod.error === "bad_checksum" && <Tooltip title="Mod checksum missmatch.">
							<FileExclamationOutlined style={{ color: "#a61d24" }} />{" "}
						</Tooltip>}
						{mod.title || mod.name}
					</>,
					defaultSortOrder: "ascend",
					sorter: (a, b) => strcmp(a.name, b.name),
				},
				{
					title: "Version",
					dataIndex: "version",
					sorter: (a, b) => strcmp(a.version, b.version),
				},
				{
					title: "Action",
					key: "action",
					responsive: ["lg"],
					render: mod => actions(mod),
				},
			]}
			expandable={{
				expandedRowRender: mod => <ModDetails mod={mod} actions={actions} />,
				expandedRowClassName: () => "no-expanded-padding",
			}}
			dataSource={mods}
			pagination={false}
			rowKey="name"
			rowClassName={mod => {
				if (deletedMods.has(mod.name)) {
					return "deleted";
				}
				if (changedMods.has(mod.name)) {
					return "changed";
				}
				return "";
			}}
		/>
	</>;
}

// Returns true if a change record with the given fields exist
function hasChange(changes, field) {
	return changes.some(change => Object.entries(field).every(([key, value]) => change[key] === value));
}

// picks out the value property from settings.
function pickValue(map) {
	return [...map].map(([name, value]) => [name, value.value]);
}

function groupToMap(array, fn) {
	const map = new Map();
	for (let index = 0; index < array.length; index++) {
		let key = fn(array[index], index, array);
		if (!map.has(key)) {
			map.set(key, []);
		}
		map.get(key).push(array[index]);
	}
	return map;
}

const SettingsTableField = memo((props) => {
	const name = props.name;
	const isBoolean = props.type === "bool-setting";
	const isNumber = ["int-setting", "double-setting"].includes(props.type);
	const isSelect = Boolean(props.allowedValues);
	let input;
	if (isBoolean) {
		input = <Checkbox />;
	} else if (isSelect) {
		const options = Object.values(props.allowedValues).map(value => ({
			value,
			label: props.locale.get(`string-mod-setting.${name}-${value}`) || value,
		}));
		input = <Select options={options} />;
	} else {
		input = <Input />;
	}

	return <Form.Item
		name={[props.scope, name]}
		label={props.locale.get(`mod-setting-name.${name}`) || name}
		tooltip={props.locale.get(`mod-setting-description.${name}`)}
		labelCol={{ span: 8 }}
		wrapperCol={{ span: 16 }}
		valuePropName={isBoolean ? "checked" : "value"}
		rules={[...isNumber ? [{
			validator(rule, value) {
				if (Number.isNaN(Number(value))) {
					return Promise.reject(new Error("Must be a number"));
				}
				return Promise.resolve();
			},
		}] : []]}
		className={ props.changed && "changed" }
	>
		{input}
	</Form.Item>;
});

function SettingsTable(props) {
	const [modList] = useModList();
	const modsInPack = new Set([...props.modPack.mods.values()].map(mod => `${mod.name}_${mod.version}`));
	const modTitles = new Map(modList
		.filter(mod => modsInPack.has(`${mod.name}_${mod.version}`))
		.map(mod => [`${mod.name}`, mod.title])
	);

	const types = ["bool-setting", "int-setting", "double-setting", "string-setting"];
	let prototypes = Object.entries(props.prototypes)
		.filter(([type, _]) => types.includes(type))
		.flatMap(([_, settingPrototypes]) => Object.values(settingPrototypes))
	;

	function controls(scope, storedFields) {
		let fields = new Map(prototypes
			.filter(p => p.setting_type === scope)
			.sort((a, b) => strcmp(a.mod, b.mod) || strcmp(a.order || "", b.order || "") || strcmp(a.name, b.name))
			.map(p => [p.name, p])
		);
		for (let [name, value] of storedFields) {
			if (!fields.has(name)) {
				let type;
				if (typeof value === "boolean") {
					type = "bool-setting";
				} else if (typeof value === "number") {
					type = "double-setting";
				} else if (typeof value === "string") {
					type = "string-setting";
				} else {
					throw Error(`Unhandled setting type ${typeof value}`);
				}
				fields.set(name, { mod: "Unknown Fields", name, setting_type: scope, type });
			}
		}
		let fieldsByMod = groupToMap([...fields.values()], prototype => prototype.mod);
		return [...fieldsByMod].map(([mod, fieldsForMod]) => <Fragment key={mod}>
			<Typography.Title level={5}>
				{props.locale.get(`mod-name.${mod}`) || modTitles.get(mod) || mod}
			</Typography.Title>
			{[...fieldsForMod].map(
				prototype => <SettingsTableField
					key={`${scope} ${prototype.name}`}
					name={prototype.name}
					type={prototype.type}
					scope={scope}
					allowedValues={prototype.allowed_values}
					locale={props.locale}
					changed={hasChange(props.changes, { type: "settings.set", scope, name: prototype.name })}
				/>
			)}
		</Fragment>);
	}

	return <>
		<SectionHeader
			title="Mod Settings"
		/>
		<Typography.Paragraph>Run export data on an instance to update available fields.</Typography.Paragraph>
		<Typography.Title level={4}>Startup</Typography.Title>
		{controls("startup", pickValue(props.modPack.settings["startup"]))}

		<Typography.Title level={4}>Map</Typography.Title>
		<Typography.Paragraph>These only apply for new saves.</Typography.Paragraph>
		{controls("runtime-global", pickValue(props.modPack.settings["runtime-global"]))}

		<Typography.Title level={4}>Per Player</Typography.Title>
		<Typography.Paragraph>Default settings for new players, these only apply for new saves.</Typography.Paragraph>
		{controls("runtime-per-user", pickValue(props.modPack.settings["runtime-per-user"]))}
	</>;
}

function CopyButton(props) {
	let clipboard = useClipboard();
	let [copiedVisible, setCopiedVisible] = useState(false);
	let copiedTimeout = useRef();

	useEffect(() => () => {
		clearTimeout(copiedTimeout.current);
		setCopiedVisible(false);
	}, []);

	let denied = clipboard.readPermissionState === "denied";
	return <Tooltip title={denied ? clipboard.deniedReason : "Copied!"} open={denied ? undefined : copiedVisible}>
		<Button disabled={denied} onClick={() => {
			try {
				clipboard.writeText(props.content);
				clearTimeout(copiedTimeout.current);
				setCopiedVisible(undefined);
				copiedTimeout.current = setTimeout(() => {
					setCopiedVisible(false);
				}, 3000);
			} catch (err) {
				logger.error(`Writing to clipboard failed:\n${err.stack}`);
				notify("Unable to copy to clipboard", "error", "Use ordinary select and copy instead.");
			}
		}}>Copy</Button>
	</Tooltip>;
}

function ExportButton(props) {
	let [open, setOpen] = useState(false);
	function close() {
		setOpen(false);
	}

	let exportString;
	if (open) { exportString = props.modPack.toModPackString(); }

	return <>
		<Button icon={<ExportOutlined />} onClick={() => { setOpen(true); }}>Export to string</Button>
		<Modal
			title="Mod Pack String"
			open={open}
			onOk={close}
			onCancel={close}
			destroyOnClose
			footer={<Space>
				<CopyButton content={exportString} />
				<Button onClick={close}>Close</Button>
			</Space>}
		>
			<Text code className="code">
				{exportString}
			</Text>
		</Modal>
	</>;
}

function useExportedAsset(modPack, asset) {
	let [assetData, setAssetData] = useState(asset === "locale" ? new Map() : {});
	let assetFilename;
	if (modPack instanceof libData.ModPack && modPack.exportManifest && modPack.exportManifest.assets[asset]) {
		assetFilename = modPack.exportManifest.assets[asset];
	}
	useEffect(() => {
		async function load() {
			if (!assetFilename) {
				return;
			}

			let response = await fetch(`${staticRoot}static/${assetFilename}`);
			if (response.ok) {
				let data = await response.json();
				setAssetData(asset === "locale" ? new Map(data) : data);
			} else {
				logger.error(`Error loading mod pack asset "${asset}" (${response.status}): ${await response.text()}`);
			}
		}

		load().catch(notifyErrorHandler(`Loading mod pack asset "${asset}" failed`));
	}, [assetFilename]);

	return assetData;
}

function applyModPackChanges(modPack, changes) {
	let modifiedModPack = modPack.shallowClone();
	for (let change of changes) {
		// Only modify fields that change to reduce re-renders
		if (["mods.set", "mods.delete"].includes(change.type) && modifiedModPack.mods === modPack.mods) {
			modifiedModPack.mods = new Map(modifiedModPack.mods);
		}
		if (
			["settings.set", "settings.delete"].includes(change.type)
			&& modifiedModPack.settings[change.scope] === modPack.settings[change.scope]
		) {
			if (modifiedModPack.settings === modPack.settings) {
				modifiedModPack.settings = { ...modPack.settings };
			}
			modifiedModPack.settings[change.scope] = new Map(modifiedModPack.settings[change.scope]);
		}

		if (change.type === "name") {
			modifiedModPack.name = change.value;
		} else if (change.type === "description") {
			modifiedModPack.description = change.value;
		} else if (change.type === "factorioVersion") {
			modifiedModPack.factorioVersion = change.value;
		} else if (change.type === "mods.set") {
			modifiedModPack.mods.set(change.name, change.value);
		} else if (change.type === "mods.delete") {
			modifiedModPack.mods.delete(change.name);
		} else if (change.type === "settings.set") {
			modifiedModPack.settings[change.scope].set(change.name, change.value);
		} else if (change.type === "settings.delete") {
			modifiedModPack.settings[change.scope].delete(change.name);
		} else {
			throw new Error(`Unknown change type ${change.type}`);
		}
	}
	return modifiedModPack;
}

export default function ModPackViewPage() {
	let account = useAccount();
	let history = useHistory();
	let control = useContext(ControlContext);
	let params = useParams();
	let modPackId = Number(params.id);

	const [form] = Form.useForm();
	let [modPack] = useModPack(modPackId);
	let prototypes = useExportedAsset(modPack, "settings");
	let locale = useExportedAsset(modPack, "locale");
	let [changes, setChanges] = useState([]);
	let syncTimeout = useRef();

	let modifiedModPack;
	if (!(modPack instanceof libData.ModPack)) {
		// Loading or invalid id
		modifiedModPack = modPack;

	} else {
		modifiedModPack = applyModPackChanges(modPack, changes);
	}

	useEffect(() => () => { clearTimeout(syncTimeout.current); });

	const pushChange = useCallback((change) => {
		setChanges(oldChanges => {
			const newChanges = [...oldChanges];
			if (
				newChanges.length
				&& newChanges.slice(-1)[0].type === change.type
				&& newChanges.slice(-1)[0].name === change.name
				&& newChanges.slice(-1)[0].scope === change.scope
			) {
				newChanges.splice(-1, 1, change);
			} else {
				newChanges.push(change);
			}
			return newChanges;
		});
	}, []);

	const revertChange = useCallback((change) => {
		setChanges(oldChanges => {
			const newChanges = [...oldChanges];
			const index = newChanges.findLastIndex(reference => (
				change.type === reference.type && change.name === reference.name
			));
			if (index === -1) {
				logger.error(`Unable to revert ${change.type} ${change.name}: change not found`);
				return oldChanges;
			}
			newChanges.splice(index, 1);
			return newChanges;
		});
	}, []);

	function syncPack(fields) {
		for (let field of fields) {
			if (!field.touched || field.validating || field.errors.length) {
				continue;
			}
			if (["name", "description", "factorioVersion"].includes(field.name[0])) {
				if (modifiedModPack[field.name[0]] !== field.value) {
					pushChange({ type: field.name[0], value: field.value });
				}

			} else if (["startup", "runtime-global", "runtime-per-user"].includes(field.name[0])) {
				let [scope, settingName] = field.name;
				let value = field.value;
				if (typeof modPack.settings[scope].get(settingName).value === "number") {
					value = Number(value);
					if (Number.isNaN(value)) {
						continue;
					}
				}
				if (modifiedModPack.settings[scope].get(settingName).value !== value) {
					pushChange({ type: "settings.set", scope, name: settingName, value: { value }});
				}
			}
		}
	}

	let nav = [{ name: "Mods", path: "/mods" }, { name: "Mod Packs" }, { name: modPack.name || modPackId }];
	if (modifiedModPack.loading) {
		return <PageLayout nav={nav}>
			<PageHeader title={modPackId} />
			<Spin size="large" />
		</PageLayout>;
	}

	if (modifiedModPack.missing) {
		return <PageLayout nav={nav}>
			<PageHeader title="Mod Pack Not Found" />
			<p>Mod pack with id {modPackId} was not found on the controller.</p>
		</PageLayout>;
	}

	return <PageLayout nav={nav}>
		<PageHeader
			title={modPack.name}
			extra={<Space>
				<ExportButton modPack={modifiedModPack}/>
				{account.hasPermission("core.mod-pack.delete") && <Popconfirm
					title="Delete mod pack and all of its settings?"
					placement="bottomRight"
					okText="Delete"
					okButtonProps={{ danger: true }}
					onConfirm={() => {
						control.send(
							new libData.ModPackDeleteRequest(modPack.id)
						).then(() => {
							history.push("/mods");
						}).catch(notifyErrorHandler("Error deleting mod pack"));
					}}
				>
					<Button danger icon={<DeleteOutlined />}>Delete</Button>
				</Popconfirm>}
			</Space>}
		/>
		<Form
			form={form}
			onFieldsChange={(changedFields, allFields) => {
				clearTimeout(syncTimeout.current);
				if (typeof changedFields[0].value === "boolean") {
					syncPack(allFields);
				} else {
					// Defer sync if this is not a checkbox to make the UI responsive.
					syncTimeout.current = setTimeout(syncPack.bind(undefined, allFields), 500);
				}
			}}
			initialValues={{
				name: modPack.name,
				description: modPack.description,
				factorioVersion: modPack.factorioVersion,
				"startup": Object.fromEntries(pickValue(modPack.settings["startup"])),
				"runtime-global": Object.fromEntries(pickValue(modPack.settings["runtime-global"])),
				"runtime-per-user": Object.fromEntries(pickValue(modPack.settings["runtime-per-user"])),
			}}
		>
			<Descriptions size="small" bordered column={{ xs: 1, sm: 2, lg: 3 }}>
				<Descriptions.Item span={3} label="Name">
					<Form.Item noStyle name="name">
						<Input
							className={hasChange(changes, { type: "name" }) && "changed"}
						/>
					</Form.Item>
				</Descriptions.Item>
				<Descriptions.Item span={3} label="Description">
					<Form.Item noStyle name="description">
						<Input.TextArea
							autoSize={{ minRows: 2 }}
							className={hasChange(changes, { type: "description" }) && "changed"}
						/>
					</Form.Item>
				</Descriptions.Item>
				<Descriptions.Item label="Mods">
					{modifiedModPack.mods.size}
				</Descriptions.Item>
				<Descriptions.Item label="Factorio Version">
					<Form.Item
						name="factorioVersion"
						style={{ marginBottom: 0 }}
						rules={[{
							pattern: /^\d+\.\d+\.\d+?$/,
							message: "Must be an a.b.c version number.",
						}]}
					>
						<Input
							className={hasChange(changes, { type: "factorioVersion" }) && "changed"}
						/>
					</Form.Item>
				</Descriptions.Item>
			</Descriptions>
			<ModsTable modPack={modifiedModPack} changes={changes} onChange={pushChange} onRevert={revertChange} />
			<SettingsTable
				modPack={modifiedModPack}
				changes={changes}
				onChange={pushChange}
				onRevert={revertChange}
				prototypes={prototypes}
				locale={locale}
			/>
		</Form>

		<div
			className="ant-notification ant-notification-bottom"
			style={{
				visibility: changes.length ? "visible" : "hidden",
				inset: "auto auto 24px auto",
				position: "sticky",
				marginTop: 16,
			}}
		>
			<div className="ant-notification-notice" style={{ width: "auto", maxWidth: 384, marginBottom: 0 }}>
				<Row style={{ alignItems: "center", rowGap: 12 }}>
					<Col flex="auto">You have unsaved changes</Col>
					<Col flex="0 0 auto" style={{ marginLeft: "auto" }}>
						<Space>
							<Button
								onClick={() => {
									form.resetFields();
									setChanges([]);
								}}
							>Revert</Button>
							<Button
								type="primary"
								onClick={() => {
									control.send(
										new libData.ModPackUpdateRequest(modifiedModPack)
									).then(() => {
										form.resetFields();
										setChanges([]);
									}).catch(notifyErrorHandler("Error deleting mod pack"));
								}}
							>Apply</Button>
						</Space>
					</Col>
				</Row>
			</div>
		</div>
	</PageLayout>;

}
