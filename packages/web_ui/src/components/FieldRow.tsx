import React from "react";

/** Label and control laid out on one line */
export default function FieldRow(props: { label: React.ReactNode, children: React.ReactNode }) {
	return <div style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
		<label style={{ width: 110, flexShrink: 0 }}>{props.label}</label>
		{props.children}
	</div>;
}
