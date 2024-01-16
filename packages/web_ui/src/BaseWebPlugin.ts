import type React from "react";
import type { AccountRole, FieldDefinition, Logger, PluginWebpackEnvInfo } from "@clusterio/lib";
import type { Control } from "./util/websocket";

/**
 * Plugin supplied login form
 */
export interface PluginLoginForm {
	/**
	 * Internal name of the login form, this should start with the
	 * plugin name followed by a dot.
	 */
	name: string;

	/** Name displayed above this form in the login window.  */
	title: string;

	/**
	 * React component that's rendered for this login form.  This is
	 * supplied the setToken function via its props which should be called
	 * when an authentication token is aquired via this form.
	 */
	Component: React.ComponentType<{ setToken(token: string): void }>;
}

export interface InputComponentProps {
	fieldDefinition: FieldDefinition,
	value: null | boolean | number | string,
	onChange: (value: null | boolean | number | string) => void,
}
export type InputComponent = React.ComponentType<InputComponentProps>;

export type UserAccount = {
	/** Name of the currently logged in account. */
	name: string;
	/** Roles of the corrently logged in account. */
	roles: AccountRole[];
	/** Check if the currently logged in account has the given permission. */
	hasPermission: (permission: string) => boolean | null;
	/** Check if the currently logged in account has any of the given permissions. */
	hasAnyPermission: (...permissions: string[]) => boolean | null;
	/** Check if the currently logged in account has all of given permissions. */
	hasAllPermission: (...permissions: string[]) => boolean | null;
	/** Logs out of the web interface. */
	logOut: () => void;
};

/**
 * Plugin supplied pages
 */
export interface PluginPage {
	/** URL path to this page. */
	path: string;
	/**
	 * If present and this path matches one of the pages in the sidebar it
	 * will cause that sidebar entry to be highlighted as active.
	 */
	sidebarPath?: string;
	/**
	 * If present group this entry under a group of the given name in the
	 * sidebar.
	 */
	sidebarGroup?: string;
	/**
	 * If present creates an entry in the sidebar for this page with the
	 * given text.
	 */
	sidebarName?: string;
	/**
	 * A react node which is rendered when this page is navigated to.
	 * Should render a PageLayout.
	 */
	content?: React.ReactElement;
	/**
	 * Permission to access page. function are expected to throw an error if access is deny.
	 */
	permission?: string | ((account: UserAccount) => (boolean|null));
};

/**
 * Base class for web interface plugins
 */
export default class BaseWebPlugin {
	/**
	 * Contents of the plugin's package.json file
	 */
	package: any;
	/**
	 * Logger for this plugin
	 *
	 * Instance of winston Logger for sending log messages from this
	 * plugin.  Supported methods and their corresponding log levels are
	 * `error`, `warn`, `audit`, `info` and `verbose`.
	 */
	logger: Logger;
	/**
	 * List of login forms provided by this plugin
	 */
	loginForms: PluginLoginForm[] = [];
	/**
	 * List of pages provided by this plugin
	 */
	pages: PluginPage[] = [];
	/**
	 * Additional Config inputComponent types available to render config
	 * entries with.
	 */
	inputComponents: Record<string, InputComponent> = {};
	/**
	 * Extra react component to add to core components
	 *
	 * Interface to augment core components of the web UI.  Setting a
	 * component as one of the supported properties of this object will
	 * cause the web UI to render it when displaying that component,
	 * usually at the end.  Each component will receive a `plugin` param
	 * which is the instance of the web plugin that contained the
	 * component extra.
	 */
	componentExtra: {
		/** Placed at the end of the controller page. */
		ControllerPage?: React.ComponentType,
		/** Placed at the end of the hosts list page. */
		HostsPage?: React.ComponentType,
		/**
		 * Placed at the end of each host page.  Takes a `host` param which
		 * is the host the page is displayed for.
		 */
		HostViewPage?: React.ComponentType,
		/** Placed at the end of the instance list page.  */
		InstancesPage?: React.ComponentType,
		/**
		 * Placed at the end of each instance page.  Takes an `instance`
		 * param which is the instance the page is displayed for.
		 */
		InstanceViewPage?: React.ComponentType,
		/** Placed at the end of the users list page.  */
		UsersPage?: React.ComponentType,
		/**
		 * Placed at the end of each user page.  Takes a `user` param which
		 * is the user object the page is displayed for.
		 */
		UserViewPage?: React.ComponentType,
		/** Placed at the end of the roles list page.  */
		RolesPage?: React.ComponentType,
		/**
		 * Placed at the end of each role page.  Takes a `role` param which
		 * is the role object the page is displayed for.
		 */
		RoleViewPage?: React.ComponentType,
	} = {};


	constructor(
		/**
		 * Webpack container for this plugin
		 */
		public container: any,
		packageData: any,
		/**
		 * The plugin's own info module
		 */
		public info: PluginWebpackEnvInfo,
		/**
		 * Control link to the controller
		 *
		 * Not connected at the time init is invoked.
		 */
		public control: Control,
		logger: Logger,
	) {
		this.package = packageData;
		this.logger = logger.child({ plugin: this.info.name }) as unknown as Logger;
	}

	/**
	 * Called immediately after the class is instantiated.
	 */
	async init() { }

	/**
	 * Called when an event on the controller connection happens
	 *
	 * The event param may be one of connect, drop, resume and close and has
	 * the following meaning:
	 *
	 * ##### connect
	 *
	 * Invoked when a new connection to the controller has been established.
	 *
	 * ##### drop
	 *
	 * Invoked when a connection loss is detected between the control link
	 * and the controller.  Plugins should respond to this event by throtteling
	 * messages it is sending to the controller to an absolute minimum.
	 *
	 * Messages sent over a dropped controller connection will get queued up in
	 * memory in the browser and sent all in one go when the connection is
	 * re-established again.
	 *
	 * ##### resume
	 *
	 * Invoked when the connection that had previously dropped is
	 * re-established.
	 *
	 * ##### close
	 *
	 * Invoked when the connection to the controller has been closed.  This
	 * typically means the controller has shut down.  Plugins should not
	 * send any messages that goes to or via the controller after the
	 * connection has been closed and before a new one is established.
	 *
	 * @param event - one of connect, drop, resume and close
	 */
	onControllerConnectionEvent(event: "connect" | "drop" | "resume" | "close") { }
}
