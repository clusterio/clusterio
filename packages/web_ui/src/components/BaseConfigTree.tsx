import React, { useContext, useEffect, useState } from "react";
import {
	Button, Card, Checkbox, Form, FormInstance, Input, InputNumber, Space, Spin, Tooltip, Tree, Typography,
} from "antd";
import ReloadOutlined from "@ant-design/icons/ReloadOutlined";

import * as lib from "@clusterio/lib";

import ControlContext from "./ControlContext";
import { InputComponent, InputComponentProps } from "../BaseWebPlugin";
import type { Control } from "../util/websocket";

const { Title } = Typography;


function getInitialValues(config: lib.Config<any>, props: BaseConfigTreeProps) {
	let initialValues: any = {};
	for (let [name, def] of Object.entries(config.constructor.fieldDefinitions)) {
		if (!config.canAccess(name)) {
			continue;
		}

		let value = config.get(name) as any;
		if (def.type === "object") {
			for (let prop of Object.keys(value)) {
				initialValues[`${name}.${prop}`] = JSON.stringify(value[prop]);
			}
		} else {
			initialValues[name] = value;
		}
	}
	return initialValues;
}

function renderInput(inputComponents: Record<string, InputComponent>, def: lib.FieldDefinition) {
	if (def.inputComponent && Object.prototype.hasOwnProperty.call(inputComponents, def.inputComponent)) {
		// Field.Item will provide the value and onChange props to the component.
		type InputPartial = React.ComponentClass<Omit<InputComponentProps, "value" | "onChange">>;
		const CustomInput = inputComponents[def.inputComponent] as unknown as InputPartial;
		return <CustomInput fieldDefinition={def} />;
	}
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

type BaseConfigTreeProps = {
	ConfigClass: typeof lib.ControllerConfig | typeof lib.HostConfig | typeof lib.InstanceConfig;
	retrieveConfig: () => Promise<lib.ConfigSchema>;
	setField: (field:string, value:any) => Promise<void>;
	setProp: (field:string, prop:string, value:any) => Promise<void>;
	id?: number;
	onApply?: () => void;
	available?: boolean;
};
export default function BaseConfigTree(props: BaseConfigTreeProps) {
	let [config, setConfig] = useState<lib.Config<any>|null>(null);
	let [form] = Form.useForm();
	let [changedFields, setChangedFields] = useState<Set<string>>(new Set());
	let [errorFields, setErrorFields] = useState(new Map<string, string>());
	let [applying, setApplying] = useState(false);
	const available = props.available ?? true;
	const control = useContext(ControlContext);

	async function updateConfig() {
		let serializedConfig = await props.retrieveConfig();
		const newConfig = props.ConfigClass.fromJSON(serializedConfig, "control");
		setConfig(newConfig);
		return newConfig;
	}
	useEffect(() => {
		if (available) {
			updateConfig().then(updatedConfig => {
				form.setFieldsValue(getInitialValues(updatedConfig, props));
			});
		}
	}, [props.id, available]);

	if (!available) {
		return <>
			<Title level={5} style={{ marginTop: 16 }}>Config</Title>
			<Card size="small" className="config-container">
				Config is currently unavailable.
			</Card>
		</>;
	}

	if (config === null) {
		return <>
			<Title level={5} style={{ marginTop: 16 }}>Config</Title>
			<Card size="small" className="config-container">
				<Spin size="large" />;
			</Card>
		</>;
	}

	let initialValues: any = {};
	function onValuesChange(changedValues: object) {
		let newChangedFields = new Set(changedFields);
		let changed = false;
		for (let [key, value] of Object.entries(changedValues)) {
			if (key.endsWith(":add.name") || key.endsWith(":add.value")) {
				continue;
			}
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

	const [propsMap, treeData] = computeTreeData(
		control,
		form,
		initialValues,
		errorFields,
		config,
		setConfig,
		props.ConfigClass,
		onValuesChange,
	);

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
								request = props.setProp(fieldName, prop, value);

							} else {
								request = props.setField(field, value === null ? "" : String(value));
							}

							try {
								await request;
								setChangedFields(changed => {
									let newChanged = new Set(changed);
									newChanged.delete(field);
									return newChanged;
								});

							} catch (err: any) {
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

function computeTreeData(
	control: Control,
	form: FormInstance<any>,
	initialValues: any,
	errorFields: Map<string, string>,
	config: lib.Config<any>,
	setConfig: (newConfig: lib.Config<any>) => void,
	ConfigClass: BaseConfigTreeProps["ConfigClass"],
	onValuesChange: (changedValues: object) => void,
) {
	let restartTip = <Tooltip
		className="ant-form-item-tooltip"
		title="A restart is required for this setting to take effect"
	><ReloadOutlined/></Tooltip>;

	type ChildNode = {
		key: string;
		children: any[];
		title?: React.ReactElement;
	};
	type TreeNode = {
		key: string;
		title: string;
		children: ChildNode[];
	};

	let treeData = [];
	let propsMap = new Map();
	const groups = new Map<string, { [name: string]: lib.FieldDefinition }>();
	for (let [fieldName, def] of Object.entries(ConfigClass.fieldDefinitions)) {
		const [groupName, field] = lib.splitOn(".", fieldName);
		let group = groups.get(groupName);
		if (!group) {
			group = {};
			groups.set(groupName, group);
		}
		group[field] = def;
	}
	for (let [groupName, groupDefs] of groups) {
		let treeNode: TreeNode = {
			key: groupName,
			title: groupName,
			children: [],
		};

		for (let [field, def] of Object.entries(groupDefs)) {
			if (!config.canAccess(`${groupName}.${field}`)) {
				continue;
			}

			let fieldName = `${groupName}.${field}`;
			let value = config.get(fieldName) as any;
			let childNode: ChildNode = {
				key: fieldName,
				children: [],
			};

			if (def.type === "object") {
				let restartRequiredProps = new Set(def.restartRequiredProps || []);
				childNode.title = <Form.Item
					label={<>
						{def.title || field}
						{!def.restartRequiredProps && def.restartRequired && restartTip}
					</>}
					tooltip={def.description}
				/>;
				for (let prop of Object.keys(value)) {
					let propPath = `${groupName}.${field}.${prop}`;
					let restart = Boolean(
						def.restartRequiredProps && Number(def.restartRequired) ^ Number(restartRequiredProps.has(prop))
					);
					childNode.children.push({
						key: propPath,
						title: <Form.Item
							name={propPath}
							label={<>
								{`"${prop}"`}
								{restart && restartTip}
							</>}
							rules={[{ validator: (_, fieldValue) => {
								if (!fieldValue.length) {
									return Promise.reject(new Error("Will be removed"));
								}
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

				let newPropPath = `${groupName}.${field}:add`;
				childNode.children.push({
					key: newPropPath,
					title: <Space>
						<Form.Item
							name={`${newPropPath}.name`}
							noStyle={true}
						>
							<Input />
						</Form.Item>:
						<Form.Item
							name={`${newPropPath}.value`}
							noStyle={true}
						>
							<Input className="json-input" />
						</Form.Item>
						<Button
							size="small"
							onClick={() => {
								let propName = form.getFieldValue(`${newPropPath}.name`);
								let propValue = form.getFieldValue(`${newPropPath}.value`);
								if (!Object.prototype.hasOwnProperty.call(value, propName)) {
									let newConfig = ConfigClass.fromJSON(config!.toJSON(), "control");
									(newConfig as lib.Config<any>).setProp(fieldName, propName, null);
									setConfig(newConfig);
								}

								let propPath = `${groupName}.${field}.${propName}`;
								form.setFieldsValue({
									[`${newPropPath}.name`]: "",
									[`${newPropPath}.value`]: "",
									[propPath]: propValue,
								});
								form.validateFields([propPath]);
								onValuesChange({ [propPath]: propValue });
							}}
						>
							Add
						</Button>
					</Space>,
				});

			} else {
				childNode.title = <Form.Item
					name={fieldName}
					label={<>
						{def.title || field}
						{def.restartRequired && restartTip}
					</>}
					validateStatus={errorFields.has(fieldName) ? "error" : undefined}
					help={errorFields.get(fieldName)}
					tooltip={def.description}
					valuePropName={def.type === "boolean" ? "checked" : "value"}
				>
					{renderInput(control.inputComponents, def)}
				</Form.Item>;
				initialValues[fieldName] = value;
			}

			treeNode.children.push(childNode);
		}

		treeData.push(treeNode);
	}

	return [propsMap, treeData] as [typeof propsMap, typeof treeData];
}
