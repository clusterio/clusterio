import type { Control } from "../util/websocket";

import React, { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";

import { logger } from "@clusterio/lib";

import ErrorBoundary from "./ErrorBoundary";
import SiteLayout from "./SiteLayout";
import ControlContext from "./ControlContext";
import LoginForm from "./LoginForm";

import { Card, ConfigProvider, Spin, Typography, theme } from "antd";

const { Paragraph } = Typography;


export type ErrorProps = {
	error: Error;
};
function ErrorCard(props: ErrorProps) {
	return <div className="login-container">
		<Card>
			<h1>An unexpected error occured</h1>
			<Paragraph code className="error-traceback">{props.error.stack}</Paragraph>
		</Card>
	</div>;
}


type AppProps = {
	control: Control;
};
export default function App(props: AppProps) {
	let [connected, setConnected] = useState(false);
	let [token, setToken] = useState(localStorage.getItem("controller_token") || null);
	let connector = props.control.connector;

	function clearToken() {
		setToken(null);
		connector.token = null;
		localStorage.removeItem("controller_token");
	}

	useEffect(() => {
		function onConnect() {
			if (token === null) {
				localStorage.removeItem("controller_token");
			} else {
				localStorage.setItem("controller_token", token);
			}
			setConnected(true);
		}

		function onClose() {
			setConnected(false);
		}

		function onError(err: any) {
			logger.error(`Unexpected error in connector:\n${err.stack}`);
			clearToken();
			setConnected(false);
		}

		connector.on("connect", onConnect);
		connector.on("close", onClose);
		connector.on("error", onError);

		return () => {
			connector.off("error", onError);
			connector.off("close", onClose);
			connector.off("connect", onConnect);
		};
	}, [token, props.control]);

	useEffect(() => {
		if (token && !connected) {
			if (props.control.loggingOut) {
				clearToken();
				props.control.loggingOut = false;
			} else {
				connector.token = token;
				connector.connect();
			}
		}
	}, [token, connected]);

	let page;
	if (connected) {
		page = <SiteLayout/>;

	} else if (token) {
		page = <div className="login-container">
			<Card>
				<h1>Connecting</h1>
				<Spin size="large"/>
			</Card>
		</div>;

	} else {
		page = <div className="login-container">
			<LoginForm setToken={setToken} />
		</div>;
	}

	return (
		<ErrorBoundary Component={ErrorCard}>
			<ConfigProvider
				theme={{ algorithm: theme.darkAlgorithm }}
			>
				<ControlContext.Provider value={props.control}>
					<BrowserRouter basename={window.webRoot}>
						{page}
					</BrowserRouter>
				</ControlContext.Provider>
			</ConfigProvider>
		</ErrorBoundary>
	);
}
