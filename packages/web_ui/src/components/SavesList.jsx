import React, { useContext, useState } from "react";
import { Button, Space, Table, Tooltip, Upload } from "antd";
import CaretLeftOutlined from "@ant-design/icons/CaretLeftOutlined";
import LeftOutlined from "@ant-design/icons/LeftOutlined";

import libLink from "@clusterio/lib/link";

import ControlContext from "./ControlContext";
import CreateSaveModal from "./CreateSaveModal";
import SectionHeader from "./SectionHeader";
import { useSaves } from "../model/saves";
import { notifyErrorHandler } from "../util/notify";


function formatBytes(bytes) {
	if (bytes === 0) {
		return "0 Bytes";
	}

	let units = [" Bytes", " kB", " MB", " GB", " TB"];
	let factor = 1000;
	let power = Math.min(Math.floor(Math.log(bytes) / Math.log(factor)), units.length);
	return (power > 0 ? (bytes / factor ** power).toFixed(2) : bytes) + units[power];
}

export default function SavesList(props) {
	let control = useContext(ControlContext);
	let saves = useSaves(props.instance.id);
	let [starting, setStarting] = useState(false);

	const saveTable = <Table
		size="small"
		columns={[
			{
				title: "Name",
				render: save => <>
					{save.name}
					{save.loaded && <Tooltip title="Currently loaded save"><CaretLeftOutlined/></Tooltip>}
					{save.default && <Tooltip title="Save loaded by default"><LeftOutlined/></Tooltip>}
				</>,
				sorter: (a, b) => a.name.localeCompare(b.name),
			},
			{
				title: "Size",
				key: "size",
				responsive: ["sm"],
				render: save => formatBytes(save.size),
				align: "right",
				sorter: (a, b) => a.size - b.size,
			},
			{
				title: "Last Modified",
				key: "mtime_ms",
				render: save => new Date(save.mtime_ms).toLocaleString(),
				sorter: (a, b) => a.mtime_ms - b.mtime_ms,
				defaultSortOrder: "descend",
			},
		]}
		dataSource={saves}
		rowKey={save => save.name}
		pagination={false}
		expandable={{
			columnWidth: 33,
			expandRowByClick: true,
			expandedRowRender: save => <Space wrap style={{marginBottom: 0}}>
				<Button
					loading={starting}
					disabled={props.instance.status !== "stopped"}
					onClick={() => {
						setStarting(true);
						libLink.messages.startInstance.send(
							control, { instance_id: props.instance.id, save: save.name }
						).catch(
							notifyErrorHandler("Error loading save")
						).finally(
							() => { setStarting(false); }
						);
					}}
				>Load save</Button>
			</Space>,
		}}
	/>;

	let uploadProps = {
		name: "file",
		accept: ".zip",
		headers: {
			"X-Access-Token": control.connector.token,
		},
		data: {
			instance_id: props.instance.id,
		},
		showUploadList: false,
		action: `${webRoot}api/upload-save`,
		// TODO: show progress to user.
	};

	return <div>
		<SectionHeader title="Saves" extra=<Space>
			<Upload {...uploadProps} >
				<Button>Upload save</Button>
			</Upload>
			<CreateSaveModal instance={props.instance} />
		</Space> />
		<Upload.Dragger className="save-list-dragger" openFileDialogOnClick={false} {...uploadProps}>
			{saveTable}
		</Upload.Dragger>
	</div>;
}
