import React from "react";


export default class ErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error) {
		return { error };
	}

	render() {
		if (this.state.error) {
			return <this.props.Component error={this.state.error} />;
		}
		return this.props.children;
	}
}
