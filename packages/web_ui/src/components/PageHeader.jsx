import React from "react";

export default function PageHeader(props) {
	return <div className="page-header">
		<h2 className="page-header-title">{props.title}</h2>
		{props.extra && <div className="page-header-extra">{props.extra}</div>}
	</div>;
}
