import React from "react";

type SectionHeader = {
	title: string;
	extra?: React.JSX.Element;
};
export default function SectionHeader(props: SectionHeader): React.JSX.Element {
	return <div className="section-header">
		<div className="section-header-title">{props.title}</div>
		{props.extra && <div className="section-header-extra">{props.extra}</div>}
	</div>;
}
