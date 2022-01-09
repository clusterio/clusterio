import React, { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";

import { libLogging } from "@clusterio/lib";

import ErrorBoundary from "./ErrorBoundary";
import SiteLayout from "./SiteLayout";
import ControlContext from "./ControlContext";
import LoginForm from "./LoginForm";

import { Card, Spin, Typography } from "antd";

const { Paragraph } = Typography;
const { logger } = libLogging;


function ErrorCard(props) {
	return <div className="login-container">
		<Card>
			<h1>An unexpected error occured</h1>
			<Paragraph code className="error-traceback">{props.error.stack}</Paragraph>
		</Card>
	</div>;
}

export default function App(props) {
	let [connected, setConnected] = useState(false);
	let [token, setToken] = useState(localStorage.getItem("master_token") || null);
	let connector = props.control.connector;

	function clearToken() {
		setToken(null);
		connector.token = null;
		localStorage.removeItem("master_token");
	}

	useEffect(() => {
		function onConnect() {
			localStorage.setItem("master_token", token);
			setConnected(true);
		}

		function onClose() {
			setConnected(false);
		}

		function onError(err) {
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
			<ControlContext.Provider value={props.control}>
				<BrowserRouter basename={webRoot}>
					{page}
				</BrowserRouter>
			</ControlContext.Provider>
		</ErrorBoundary>
	);
}
