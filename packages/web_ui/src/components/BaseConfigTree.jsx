import React, { useEffect, useContext, useState } from "react";
import { Button, Card, Checkbox, Form, Input, InputNumber, Space, Spin, Tree, Typography } from "antd";

const { Title } = Typography;


export default function BaseConfigTree(props) {
	let [config, setConfig] = useState(null);
	let [form] = Form.useForm();
	let [changedFields, setChangedFields] = useState(new Set());
	let [errorFields, setErrorFields] = useState(new Map());
	let [applying, setApplying] = useState(false);

	async function updateConfig() {
		let serializedConfig = await props.retrieveConfig();
		let newConfig = new props.ConfigClass("control");
		await newConfig.load(serializedConfig);
		setConfig(newConfig);
	}
	useEffect(() => { updateConfig(); }, [props.id]);

	function renderInput(def) {
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
	function onValuesChange(changedValues) {
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

	let treeData = [];
	let propsMap = new Map();
	for (let [name, GroupClass] of props.ConfigClass.groups) {
		let group = config.group(name);
		let treeNode = {
			key: group.name,
			title: group.name,
			children: [],
		};

		for (let def of GroupClass.definitions.values()) {
			if (!group.canAccess(def.name)) {
				continue;
			}

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

				let newPropPath = `${group.name}.${def.name}:add`;
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
							onClick={async () => {
								let propName = form.getFieldValue(`${newPropPath}.name`);
								let propValue = form.getFieldValue(`${newPropPath}.value`);
								if (!Object.prototype.hasOwnProperty.call(value, propName)) {
									let newConfig = new props.ConfigClass("control");
									await newConfig.load(config.serialize());
									newConfig.setProp(fieldName, propName, null);
									setConfig(newConfig);
								}

								let propPath = `${group.name}.${def.name}.${propName}`;
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
					label={def.title || def.name}
					validateStatus={errorFields.has(fieldName) ? "error" : undefined}
					help={errorFields.get(fieldName)}
					tooltip={def.description}
					valuePropName={def.type === "boolean" ? "checked" : "value"}
				>
					{renderInput(def)}
				</Form.Item>;
				initialValues[fieldName] = value;
			}

			treeNode.children.push(childNode);
		}

		treeData.push(treeNode);
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
								request = props.setProp(fieldName, prop, value);

							} else {
								request = props.setField(field, value);
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
