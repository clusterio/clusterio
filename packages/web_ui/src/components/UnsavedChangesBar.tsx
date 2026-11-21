import React from "react";
import { Button, Space } from "antd";

type UnsavedChangesBarProps = {
	onRevert: () => void;
	onApply: () => void;
	applying?: boolean;
};

/** Floating bar shown while a page has edits that are not applied yet */
export default function UnsavedChangesBar(props: UnsavedChangesBarProps) {
	return <div style={{
		position: "fixed",
		bottom: 24,
		left: "50%",
		transform: "translateX(-50%)",
		background: "#2a1912",
		borderRadius: 8,
		boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
		padding: "10px 14px",
		display: "flex",
		alignItems: "center",
		gap: 12,
		zIndex: 1000,
	}}>
		<span style={{ color: "#FFF" }}>
			You have unsaved changes
		</span>

		<Space>
			<Button onClick={props.onRevert}>
				Revert
			</Button>

			<Button type="primary" loading={props.applying} onClick={props.onApply}>
				Apply
			</Button>
		</Space>
	</div>;
}
