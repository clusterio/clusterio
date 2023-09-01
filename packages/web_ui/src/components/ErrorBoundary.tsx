import React from "react";

import type { ErrorProps } from "./App";

type ErrorBoundaryProps = {
	Component: (props: ErrorProps) => React.JSX.Element;
	children?: React.ReactElement;
};

type ErrorBoundaryState = {
	error: Error | null;
};

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { error: null };

	static getDerivedStateFromError(error: any) {
		return { error };
	}

	render() {
		if (this.state.error) {
			return <this.props.Component error={this.state.error} />;
		}
		return this.props.children;
	}
}
