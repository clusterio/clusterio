import React from "react";
import { Button, Card, Flex, Image, Typography } from "antd";

import example from "../images/console-error-edge.png";
import PageLayout from "./PageLayout";
import type { ErrorProps } from "./App";

const { Paragraph } = Typography;

function SupportLinkCard(props:{
	name: string,
	href: string,
	image: string,
}) {
	return <Card style={{ alignContent: "center" }} styles={{ body: { padding: 10 } }}>
		<Flex align="center" gap="middle">
			<img src={props.image} style={{ width: 50 }}/>
			<Button type="primary" href={props.href}>{props.name}</Button>
		</Flex>
	</Card>;
}

export default function ErrorPage(props: ErrorProps & { throw?: boolean }) {
	if (props.throw) {
		throw props.error;
	}

	return <PageLayout nav={[{ name: "Error" }]}>
		<h2>An Unexpected Error Occurred</h2>
		<Paragraph code className="error-traceback">{props.error.message}</Paragraph>
		<Paragraph>
			Further details can found by saving the console log in dev tools
			(F12, "Console", "Save as", see example below).
			If this is an issue with a plugin then please report it to the plugin creator;
			otherwise, please reach out to the Clusterio team via Github or Discord.
		</Paragraph>
		<Flex gap="middle">
			<SupportLinkCard
				name="Github Issues"
				href="https://github.com/clusterio/clusterio/issues"
				image="https://github.githubassets.com/favicons/favicon-dark.svg"
			/>
			<SupportLinkCard
				name="Support Server"
				href="https://discord.gg/mzAsgnm"
				image="https://cdn.prod.website-files.com/6257adef93867e50d84d30e2/66e3d7f4ef6498ac018f2c55_Symbol.svg"
			/>
		</Flex>
		<br/>
		<Image height={250} src={example}/>
	</PageLayout>;
};
