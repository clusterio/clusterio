import { InboxOutlined } from "@ant-design/icons";
import { DraggingContext } from "../model/is_dragging";
import { useContext } from "react";

// This component is used to display a dropzone when a file is being dragged over the parent component
export function Dropzone() {
	const isDroppingFile = useContext(DraggingContext);

	return <div
		style={{
			position: "absolute",
			top: "0",
			left: "0",
			width: "100%",
			height: "100%",
			zIndex: "90",
			backgroundColor: "#88888844",
			borderRadius: "20px",
			border: "dashed 2px rgb(22, 119, 255)",
			display: isDroppingFile ? "block" : "none",
		}}
	>
		<div
			id="dropzone-icon"
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
			<InboxOutlined />
			<p style={{ fontSize: "24px", display: "block", textAlign: "center", marginTop: "8px" }}>
				Drop to upload
			</p>
		</div>
	</div>;
}
