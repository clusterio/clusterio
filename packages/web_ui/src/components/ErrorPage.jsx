import React, { useContext } from "react";
import { Typography } from "antd";

import { libLink } from "@clusterio/lib";

import PageLayout from "./PageLayout";

const { Paragraph } = Typography;


export default function ErrorPage(props) {
	return <PageLayout nav={[{ name: "Error" }]}>
		<h2>An unexpected error occured</h2>
		<Paragraph code className="error-traceback">{props.error.stack}</Paragraph>
	</PageLayout>;
};
