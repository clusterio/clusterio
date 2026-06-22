import React, { useState } from "react";
import { Button } from "antd";
import { BaseWebPlugin, PageLayout, PageHeader } from "@clusterio/web_ui";
import * as lib from "@clusterio/lib";

function MockExternalWebPage() {
	const [count, setCount] = useState(0);
	return <PageLayout nav={[{ name: "mock_external_web" }]}>
		<PageHeader title="mock_external_web" />
		<Button onClick={() => setCount(count + 1)}>Clicked {count} times (lib is {typeof lib})</Button>
	</PageLayout>;
}

export class WebPlugin extends BaseWebPlugin {
	async init() {
		this.pages = [
			{
				path: "/mock_external_web",
				sidebarName: "mock_external_web",
				permission: "mock_external_web.page.view",
				content: <MockExternalWebPage/>,
			},
		];
	}
}
