import React, { useEffect, useContext, useRef, useState } from "react";
import { useHistory, useParams } from "react-router-dom";
import {
	notification, Button, Card, Checkbox, Col, Descriptions, Dropdown, Form, Input, InputNumber, Modal,
	Popconfirm, Row, Select, Space, Spin, Tree, Typography,
} from "antd";
import DeleteOutlined from "@ant-design/icons/DeleteOutlined";

import libLink from "@clusterio/lib/link";
import libConfig from "@clusterio/lib/config";

import ControlContext from "./ControlContext";
import PageLayout from "./PageLayout";
import { notifyErrorHandler } from "../util/notify";

const { Title, Paragraph } = Typography;


function useInstance(id) {
	let control = useContext(ControlContext);
	let [instance, setInstance] = useState({ loading: true });

	function updateInstance() {
		if (!Number.isInteger(id)) {
			setInstance({ missing: true });
			return;
		}

		// XXX optimize by requesting only the instance in question
		libLink.messages.listInstances.send(control).then(result => {
			let match = result.list.find(i => i.id === id);
			if (!match) {
				setInstance({ missing: true });
			} else {
				setInstance({ ...match, present: true });
			}
		});
	}

	useEffect(() => {
		updateInstance();
	}, [id]);

	return [instance, updateInstance];
}

function useSlave(id) {
	let control = useContext(ControlContext);
	let [slave, setSlave] = useState({ loading: true });

	function updateSlave() {
		if (!Number.isInteger(id)) {
			setSlave({ missing: true });
			return;
		}

		// XXX optimize by requesting only the slave in question
		libLink.messages.listSlaves.send(control).then(result => {
			let match = result.list.find(i => i.id === id);
			if (!match) {
				setSlave({ missing: true });
			} else {
				setSlave({ ...match, present: true });
			}
		});
	}

	useEffect(() => {
		updateSlave();
	}, [id]);

	return [slave, updateSlave];
}

function formatParsedOutput(parsed, key) {
	let time = "";
	if (parsed.format === "seconds") {
		time = <span className="factorio-time">{parsed.time.padStart(8)} </span>;
	} else if (parsed.format === "date") {
		time = <span className="factorio-time">{parsed.time} </span>;
	}

	let info = "";
	if (parsed.type === "log") {
		let level = parsed.level;
		if (level === "Script") {
			level = <span className="factorio-script">{level}</span>;
		} else if (level === "Verbose") {
			level = <span className="factorio-verbose">{level}</span>;
		} else if (level === "Info") {
			level = <span className="factorio-info">{level}</span>;
		} else if (parsed.level === "Warning") {
			level = <span className="factorio-warning">{level}</span>;
		} else if (parsed.level === "Error") {
			level = <span className="factorio-error">{level}</span>;
		}

		info = <>{level} <span className="factorio-filename">{parsed.file}: </span></>;

	} else if (parsed.type === "action") {
		info = <>[<span className="factorio-action">{parsed.action}</span>] </>;
	}

	return <span key={key}>{time}{info}{parsed.message}<br/></span>;
}

function formatLog(info, key) {
	if (info.level === "server" && info.parsed) {
		return formatParsedOutput(info.parsed, key);
	}
	let level = <span className={`log-${info.level}`}>{info.level}</span>;
	return <span key={key}>[{level}] {info.message}<br/></span>;
}

function InstanceConsole(props) {
	let control = useContext(ControlContext);
	let anchor = useRef();
	let [pastLines, setPastLines] = useState([<span key={0}>{"Loading past entries..."}<br/></span>]);
	let [lines, setLines] = useState([]);

	useEffect(() => {
		// Scroll view to the anchor so it sticks to the bottom
		let parent = anchor.current.parentElement;
		parent.scrollTop = parent.scrollHeight - parent.clientHeight;

		libLink.messages.queryLog.send(control, {
			all: false,
			master: false,
			slave_ids: [],
			instance_ids: [props.id],
			max_level: null,
		}).then(result => {
			setPastLines(result.log.slice(-400).map((info, index) => formatLog(info, index)));
		}).catch(err => {
			setPastLines([<span key={0}>{`Error loading log: ${err.message}`}<br/></span>]);
		});

		function logHandler(info) {
			setLines(currentLines => currentLines.concat(
				[formatLog(info, currentLines.length)]
			));
		}

		control.onInstanceLog(props.id, logHandler);
		return () => {
			control.offInstanceLog(props.id, logHandler);
		};
	}, [props.id]);

	return <>
		<Paragraph code className="instance-console">
			{pastLines}
			{lines}
			<div className="scroll-anchor" ref={anchor} />
		</Paragraph>
	</>;
}

function InstanceRcon(props) {
	let control = useContext(ControlContext);
	let [output, setOutput] = useState(null);
	let [running, setRunning] = useState(false);

	async function sendCommand(command) {
		if (!command) {
			setOutput(null);
			return;
		}

		setRunning(true);
		try {
			let result = await libLink.messages.sendRcon.send(control, {
				instance_id: props.id,
				command: command,
			});
			setOutput(result.result);
		} finally {
			setRunning(false);
		}
	}

	return <>
		{output && <>
			<Title level={5}>Rcon result</Title>
			<Paragraph code className="rcon-result">{output}</Paragraph>
		</>}
		<Input.Search
			disabled={props.disabled}
			placeholder="Send RCON Command"
			enterButton="Send"
			onSearch={(command) => sendCommand(command).catch(notifyErrorHandler("Error sending command"))}
			loading={running}
		/>
	</>;
}

function AssignInstanceModal(props) {
	let [visible, setVisible] = useState(false);
	let [slaves, setSlaves] = useState([]);
	let [loading, setLoading] = useState(true);
	let [applying, setApplying] = useState(false);
	let [form] = Form.useForm();
	let control = useContext(ControlContext);

	function open() {
		setVisible(true);
		libLink.messages.listSlaves.send(control).then((result) => {
			setSlaves(result.list);
			setLoading(false);
		});
	}

	function handleAssign() {
		let slaveId = form.getFieldValue("slave");
		if (slaveId === undefined) {
			setVisible(false);
			return;
		}

		setApplying(true);
		libLink.messages.assignInstanceCommand.send(control, {
			instance_id: props.id,
			slave_id: slaveId,
		}).then(() => {
			setVisible(false);
			if (props.onFinish) {
				props.onFinish();
			}
		}).catch(
			notifyErrorHandler("Error assigning instance")
		).finally(
			() => setApplying(false)
		);
	}

	function handleCancel() {
		setVisible(false);
	}

	return <>
		<Button {...props.buttonProps} onClick={open}>
			{props.buttonContent || "Assign"}
		</Button>
		<Modal
			title="Assign Instance"
			okText="Assign"
			visible={visible}
			confirmLoading={applying}
			onOk={handleAssign}
			onCancel={handleCancel}
			destroyOnClose
		>
			<Paragraph style={{ maxWidth: "30em" }}>
				Select a Slave to assign this instance to.  Assignment
				creates the necessary files on the slave to start up
				the instance.  Note that reassigning an instance from
				one slave to another will not move the server save over.
			</Paragraph>
			<Form form={form} initialValues={{ slave: props.slaveId }}>
				<Form.Item name="slave" label="Slave">
					<Select loading={loading}>
						{slaves.map((slave) => <Select.Option
							key={slave["id"]}
							value={slave["id"]}
							disabled={!slave["connected"]}
						>
							{slave["name"]}
							{!slave["connected"] && " (offline)"}
						</Select.Option>)}
					</Select>
				</Form.Item>
			</Form>
		</Modal>
	</>;
}

function StartStopInstanceButton(props) {
	let control = useContext(ControlContext);
	let [switching, setSwitching] = useState(false);

	function onClick() {
		setSwitching(true);
		let action;
		if (props.instance["status"] === "stopped") {
			action = libLink.messages.startInstance.send(
				control, { instance_id: props.instance["id"], save: null }
			).catch(
				notifyErrorHandler("Error starting instance")
			);

		} else if (["starting", "running"].includes(props.instance["status"])) {
			action = libLink.messages.stopInstance.send(
				control, { instance_id: props.instance["id"] }
			).catch(
				notifyErrorHandler("Error stopping instance")
			);

		} else {
			setSwitching(false);
			return;
		}

		action.finally(() => {
			setSwitching(false);
			if (props.onFinish) {
				props.onFinish();
			}
		});
	}

	return <Button
		{...(props.buttonProps || {})}
		loading={switching}
		type="primary"
		disabled={!["starting", "running", "stopped"].includes(props.instance["status"])}
		onClick={onClick}
	>
		{props.instance["status"] === "stopped" ? "Start" : "Stop"}
	</Button>;
}


function InstanceConfigTree(props) {
	let control = useContext(ControlContext);
	let [config, setConfig] = useState(null);
	let [form] = Form.useForm();
	let [changedFields, setChangedFields] = useState(new Set());
	let [errorFields, setErrorFields] = useState(new Map());
	let [applying, setApplying] = useState(false);

	async function updateConfig() {
		let result = await libLink.messages.getInstanceConfig.send(control, {
			instance_id: props.id,
		});

		let newConfig = new libConfig.InstanceConfig();
		await newConfig.load(result.serialized_config);
		setConfig(newConfig);
	}

	useEffect(() => { updateConfig(); }, [props.id]);

	function renderInput(group, def) {
		if (def.type === "boolean") {
			return <Checkbox/>;
		}
		if (def.type === "string") {
			return <Input/>;
		}
		if (def.type === "number") {
			return <InputNumber/>;
		}

		return `Unknown type ${def.type}`;
	}

	if (config === null) {
		return <Spin/>;
	}

	let initialValues = {};
	let treeData = [];
	let propsMap = new Map();
	for (let [name, GroupClass] of libConfig.InstanceConfig.groups) {
		let group = config.group(name);
		let treeNode = {
			key: group.name,
			title: group.name,
			children: [],
		};

		for (let def of GroupClass.definitions.values()) {
			let value = group.get(def.name);
			let fieldName = `${group.name}.${def.name}`;
			let childNode = {
				key: fieldName,
				children: [],
			};

			if (def.type === "object") {
				childNode.title = <Form.Item label={def.title || def.name} tooltip={def.description} />;
				for (let prop of Object.keys(value)) {
					let propPath = `${group.name}.${def.name}.${prop}`;
					childNode.children.push({
						key: propPath,
						title: <Form.Item
							name={propPath}
							label={`"${prop}"`}
							rules={[{ validator: (_, fieldValue) => {
								try {
									JSON.parse(fieldValue);
								} catch (err) {
									return Promise.reject(new Error("Must be valid json"));
								}
								return Promise.resolve();
							}}]}
						>
							<Input className="json-input" />
						</Form.Item>,
					});

					initialValues[propPath] = JSON.stringify(value[prop]);
					propsMap.set(propPath, [fieldName, prop]);
				}

			} else {
				childNode.title = <Form.Item
					name={fieldName}
					label={def.title || def.name}
					validateStatus={errorFields.has(fieldName) ? "error" : undefined}
					help={errorFields.get(fieldName)}
					tooltip={def.description}
					valuePropName={def.type === "boolean" ? "checked" : "value"}
				>
					{renderInput(group, def)}
				</Form.Item>;
				initialValues[fieldName] = value;
			}

			treeNode.children.push(childNode);
		}

		treeData.push(treeNode);
	}

	function onValuesChange(changedValues) {
		let newChangedFields = new Set(changedFields);
		let changed = false;
		for (let [key, value] of Object.entries(changedValues)) {
			if (initialValues[key] === value) {
				changed = newChangedFields.delete(key) || changed;
			} else {
				changed = !newChangedFields.has(key) || changed;
				newChangedFields.add(key);
			}
		}

		if (changed) {
			setChangedFields(newChangedFields);
		}
	}

	return <>
		<Title level={5} style={{ marginTop: 16 }}>
			Config
			<Space style={{ float: "right" }}>
				<Button
					type="primary"
					size="small"
					loading={applying}
					onClick={async () => {
						setApplying(true);
						for (let field of changedFields) {
							let value = form.getFieldValue(field);
							let request;
							if (propsMap.has(field)) {
								let [fieldName, prop] = propsMap.get(field);
								try {
									value = JSON.parse(value);
								} catch (err) {
									continue;
								}

								request = libLink.messages.setInstanceConfigProp.send(control, {
									instance_id: props.id,
									field: fieldName,
									prop,
									value,
								});

							} else {
								request = libLink.messages.setInstanceConfigField.send(control, {
									instance_id: props.id,
									field,
									value: String(value),
								});
							}

							try {
								await request;
								setChangedFields(changed => {
									let newChanged = new Set(changed);
									newChanged.delete(field);
									return newChanged;
								});

							} catch (err) {
								setErrorFields(errors => {
									let newErrors = new Map(errors);
									newErrors.set(field, err.message);
									return newErrors;
								});
							}
						}

						await updateConfig();
						setApplying(false);

						if (props.onApply) {
							props.onApply();
						}
					}}
					disabled={changedFields.size === 0}
				>
					Apply
				</Button>
				<Button
					size="small"
					onClick={() => {
						form.resetFields();
						setChangedFields(new Set());
						setErrorFields(new Map());
					}}
				>
					Revert
				</Button>
			</Space>
		</Title>
		<Card size="small" className="config-container">
			<Form
				size="small"
				form={form}
				initialValues={initialValues}
				onValuesChange={onValuesChange}
			>
				<Tree
					treeData={treeData}
					selectable={false}
					defaultExpandAll={true}
					filterTreeNode={(node) => changedFields.has(node.key)}
				/>
			</Form>
		</Card>
	</>;
}

export default function InstanceViewPage(props) {
	let params = useParams();
	let instanceId = Number(params.id);

	let history = useHistory();

	let control = useContext(ControlContext);
	let [instance, updateInstance] = useInstance(instanceId);
	let [slave] = useSlave(Number(instance["assigned_slave"]));

	let [creatingSave, setCreatingSave] = useState(false);

	let nav = [{ name: "Instances", path: "/instances" }, { name: instance.name || "Unknown" }];
	if (instance.loading) {
		return <PageLayout nav={nav}><Spin size="large" /></PageLayout>;
	}

	if (instance.missing) {
		return <PageLayout nav={nav}>
			<h2>Instance not found</h2>
			<p>Instance with id {instanceId} was not found on the master server.</p>
		</PageLayout>;
	}

	let instanceButtons = <Space>
		<StartStopInstanceButton
			instance={instance}
			onFinish={updateInstance}
		/>
		{instance.status === "stopped" && <Button
			loading={creatingSave}
			onClick={() => {
				setCreatingSave(true);
				libLink.messages.createSave.send(
					control, { instance_id: instanceId }
				).catch(notifyErrorHandler("Error creating save")).finally(() => {
					updateInstance();
					setCreatingSave(false);
				});
			}}
		>
			Create save
		</Button>}
		<Popconfirm
			title="Permanently delete instance and server saves?"
			okText="Delete"
			placement="bottomRight"
			okButtonProps={{ danger: true }}
			onConfirm={() => {
				libLink.messages.deleteInstance.send(
					control, { instance_id: instanceId }
				).then(() => {
					history.push("/instances");
				}).catch(notifyErrorHandler("Error deleting instance"));
			}}
		>
			<Button
				danger
				disabled={!["unknown", "unassigned", "stopped"].includes(instance["status"])}
			>
				<DeleteOutlined />
			</Button>
		</Popconfirm>
	</Space>;

	let assigned = instance["assigned_slave"] !== null;
	return <PageLayout nav={nav}>
		<Descriptions
			bordered
			size="small"
			title={instance["name"]}
			extra={instanceButtons}
		>
			<Descriptions.Item label="Slave">
				{!assigned
					? <em>Unassigned</em>
					: slave["name"] || instance["assigned_slave"]
				}
				<AssignInstanceModal
					id={instanceId}
					slaveId={instance["assigned_slave"]}
					buttonProps={{
						size: "small",
						style: { float: "Right" },
						type: assigned ? "default" : "primary",
						disabled: !["unknown", "unassigned", "stopped"].includes(instance["status"]),
					}}
					buttonContent={assigned ? "Reassign" : "Assign"}
					onFinish={updateInstance}
				/>
			</Descriptions.Item>
			<Descriptions.Item label="Status">{instance["status"]}</Descriptions.Item>
		</Descriptions>

		<Title level={5} style={{ marginTop: 16 }}>Console</Title>
		<InstanceConsole id={instanceId} />
		<InstanceRcon id={instanceId} disabled={instance["status"] !== "running"} />

		<InstanceConfigTree id={instanceId} onApply={updateInstance} />
	</PageLayout>;
}
