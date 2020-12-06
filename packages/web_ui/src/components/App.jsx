import events from "events";
import React, { useEffect, useState } from "react";
import { BrowserRouter } from "react-router-dom";

import { logger } from "@clusterio/lib/logging";

import basename from "../basename";
import SiteLayout from "./SiteLayout";
import ControlContext from "./ControlContext";
import LoginForm from "./LoginForm";

import { Card, Spin } from "antd";


export default function App(props) {
	let [connected, setConnected] = useState(false);
	let [token, setToken] = useState(localStorage.getItem("master_token") || null);
	let connector = props.control.connector;

	function clearToken() {
		setToken(null);
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

		if (token && !connected) {
			connector.token = token;
			connector.connect();
		}

		return () => {
			connector.off("error", onError);
			connector.off("close", onClose);
			connector.off("connect", onConnect);
		};
	});

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
			<Card>
				<h1>Clusterio</h1>
				<LoginForm setToken={setToken} />
			</Card>
		</div>;
	}

	return (
		<ControlContext.Provider value={props.control}>
			<BrowserRouter basename={basename}>
				{page}
			</BrowserRouter>
		</ControlContext.Provider>
	);
}
