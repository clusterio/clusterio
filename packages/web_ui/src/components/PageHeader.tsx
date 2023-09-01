import React from "react";

type PageHeaderProps = {
	title: string|React.ReactElement;
	extra?: React.JSX.Element;
};

export default function PageHeader(props: PageHeaderProps): React.JSX.Element {
	return <div className="page-header">
		<h2 className="page-header-title">{props.title}</h2>
		{props.extra && <div className="page-header-extra">{props.extra}</div>}
	</div>;
}
