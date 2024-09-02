import { useContext } from "react";
import { Button } from "antd";
import { InboxOutlined, UploadOutlined } from "@ant-design/icons";

import { DraggingContext } from "../model/is_dragging";

export default function UploadButton(props: React.ComponentProps<typeof Button>) {
	const isDroppingFile = useContext(DraggingContext);
	const borderColor = props.disabled ? "gray" : "rgb(22, 119, 255)";
	return <Button
		className={`dropzone ${props.disabled ? "disabled" : "enabled"}`}
		{...props}
		style={{
			...props.style,
			// Distinct border when dropping file
			border: isDroppingFile ? `dashed 2px ${borderColor}` : undefined,
		}}
		icon={isDroppingFile ? <InboxOutlined /> : props.icon || <UploadOutlined />}
	>
		{props.children || "Upload"}
	</Button>;
}
