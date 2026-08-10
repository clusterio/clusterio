import type { Control } from "../util/websocket";

import React, { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";

import { logger } from "@clusterio/lib";

import ErrorBoundary from "./ErrorBoundary";
import SiteLayout from "./SiteLayout";
import ControlContext from "./ControlContext";
import LoginForm from "./LoginForm";
import { pluginSetKey } from "../util/pluginSet";

import { Button, Card, ConfigProvider, Spin, Typography, theme } from "antd";

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


function PluginsChangedCard() {
	return <div className="login-container">
		<Card>
			<h1>Reload required</h1>
			<Paragraph>
				The plugins the controller is running have changed since this page was opened.
				So the page has been closed and must be reloaded to continue functioning as expected.
			</Paragraph>
			<Button type="primary" onClick={() => window.location.reload()}>Reload</Button>
		</Card>
	</div>;
}


type AppProps = {
	control: Control;
};
export default function App(props: AppProps) {
	let [connected, setConnected] = useState(false);
	let [pluginsChanged, setPluginsChanged] = useState(false);
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

	// The controller reports the plugins it is running in the handshake
	// This is used to detect when plugins change and a restart is required
	useEffect(() => {
		function onHello(data: any) {
			if (pluginSetKey(data.plugins) !== props.control.pluginSetKey) {
				setPluginsChanged(true);
			}
		}

		connector.on("hello", onHello);
		return () => {
			connector.off("hello", onHello);
		};
	}, [props.control]);

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
	if (pluginsChanged) {
		page = <PluginsChangedCard />;

	} else if (connected) {
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
		<ConfigProvider
			theme={{ algorithm: theme.darkAlgorithm }}
		>
			<ErrorBoundary Component={ErrorCard}>
				<ControlContext.Provider value={props.control}>
					<BrowserRouter basename={webRoot}>
						{page}
					</BrowserRouter>
				</ControlContext.Provider>
			</ErrorBoundary>
		</ConfigProvider>
	);
}
