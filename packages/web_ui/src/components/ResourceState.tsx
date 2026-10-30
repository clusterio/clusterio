import React from "react";
import { Result, ResultProps, Spin } from "antd";

import Link from "./Link";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import type { ResourceStatus } from "../util/useResourceState";

type ResourceStateProps = {
	/** Status from useResourceState */
	state: ResourceStatus;
	/** Capitalised name of the kind of resource, e.g. "Mod pack" */
	type: string;
	/** Id or name of the resource */
	id: number | string;
	nav: React.ComponentProps<typeof PageLayout>["nav"];
	/** Page listing this kind of resource */
	listPath: string;
	/** Error from the subscription */
	error: Error | null;
};

/** Whole page to render in place of a view page when its resource can't be shown */
export default function ResourceState(props: ResourceStateProps) {
	const { state, type, id, nav } = props;
	if (state === "ok") {
		return null;
	}

	if (state === "loading") {
		return <PageLayout nav={nav}>
			<PageHeader title={String(id)} />
			<Spin size="large" />
		</PageLayout>;
	}

	const results: Record<typeof state, ResultProps> = {
		missing: { status: "warning", title: `${type} not found`, subTitle: `${type} ${id} was not found.` },
		deleted: { status: "warning", title: `${type} ${id} has been deleted` },
		error: { status: "error", title: `Could not load ${type.toLowerCase()}`, subTitle: props.error?.message },
	};

	return <PageLayout nav={nav}>
		<Result
			{...results[state]}
			extra={<Link to={props.listPath}>Back to {type.toLowerCase()} list</Link>}
		/>
	</PageLayout>;
}
