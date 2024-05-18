import { InboxOutlined } from "@ant-design/icons";
import { DraggingContext } from "../model/is_dragging";
import { useContext } from "react";

// This component is used to display a dropzone when a file is being dragged over the parent component
export function Dropzone({ disabled = false }: { disabled?: boolean }) {
	const isDroppingFile = useContext(DraggingContext);

	const textStyle: { color?: string } = {};
	let text = "Drop to upload";
	if (disabled) {
		textStyle.color = "red";
		text = "Target is offline";
	}
	const borderColor = disabled ? "gray" : "rgb(22, 119, 255)";

	return <div
		className={`dropzone ${disabled ? "disabled" : "enabled"}`} // Don't remove this class, linked to SiteLayout
		style={{
			position: "absolute",
			top: "0",
			left: "0",
			width: "100%",
			height: "100%",
			zIndex: "90",
			backgroundColor: "#88888844",
			borderRadius: "20px",
			border: `dashed 2px ${borderColor}`,
			display: isDroppingFile ? "block" : "none",
		}}
	>
		<div
			className="dropzone-icon"
			style={{
				fontSize: "72px",
				color: "rgb(22, 119, 255)",
				display: "flex",
				zIndex: "100",
				alignItems: "center",
				justifyContent: "center",
				flexDirection: "column",
				height: "100%",
			}}
		>
			<InboxOutlined style={textStyle} />
			<p style={{ ...textStyle, fontSize: "24px", display: "block", textAlign: "center", marginTop: "8px" }}>
				{text}
			</p>
		</div>
	</div>;
}
