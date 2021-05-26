import React, { useContext, useState } from "react";

export default function SectionHeader(props) {
	return <div className="section-header">
		<div className="section-header-title">{props.title}</div>
		{props.extra && <div className="section-header-extra">{props.extra}</div>}
	</div>;
}
