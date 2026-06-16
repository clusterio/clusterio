import type React from "react";
import type { Control } from "./util/websocket";
import * as lib from "@clusterio/lib";

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

export type UserAccount = {
	/** Name of the currently logged in account. */
	name: string;
	/** Roles of the currently logged in account. */
	roles: lib.AccountRole[];
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

export interface InputComponentProps {
	disabled?: boolean,
	fieldDefinition: lib.FieldDefinition,
	value: null | boolean | number | string,
	onChange: (value: null | boolean | number | string) => void,
}

export type InputComponent = React.ComponentType<InputComponentProps>;

export type ExtensionSlotProps = {
	/** Placed at the end of the controller page. */
	ControllerPage: Record<string, never>;
	/** Placed at the end of the hosts list page. */
	HostsPage: Record<string, never>;
	/**
	 * Placed at the end of each host page.
	 * `host` is the host the page is displayed for.
	 */
	HostViewPage: {
		host: lib.HostDetails;
	};
	/** Placed at the end of the instance list page.  */
	InstancesPage: Record<string, never>;
	/**
	 * Placed at the end of each instance page.
	 * `instance` is the instance the page is displayed for.
	 */
	InstanceViewPage: {
		instance: lib.InstanceDetails;
	};
	/** Placed at the end of the users list page. */
	UsersPage: Record<string, never>;
	/**
	 * Placed at the end of each user page.
	 * `user` is the user the page is displayed for.
	 */
	UserViewPage: {
		user: lib.UserDetails;
	};
	/** Placed at the end of the roles list page.  */
	RolesPage: Record<string, never>;
	/**
	 * Placed at the end of each role page.
	 * `role` is the role the page is displayed for.
	 */
	RoleViewPage: {
		role: lib.Role;
	};
};

export type PluginExtensionSlot = keyof ExtensionSlotProps;

export type PluginExtensionProps<K extends PluginExtensionSlot> = ExtensionSlotProps[K] & {
	component: K;
	search?: string;
};

export type ExtensionComponent<K extends PluginExtensionSlot> = React.ComponentType<PluginExtensionProps<K>>;

export type ExtensionComponents = { [K in PluginExtensionSlot]: Map<string, ExtensionComponent<K>> };

export type WebPluginContext = lib.PluginLoadContext<{
	control: Control;
	container: any;
	package: any;
}>;

/**
 * Collection of host plugin hooks
 */
export class WebHooks {
	constructor(logger: lib.Logger) {
		this.controllerConnectionEvent = new lib.AsyncHook(logger);
		this.extensionComponents = new lib.AsyncHook(logger);
		this.inputComponents = new lib.AsyncHook(logger);
		this.loginForms = new lib.AsyncHook(logger);
		this.pages = new lib.AsyncHook(logger);
	}

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
	readonly controllerConnectionEvent: lib.AsyncHook<[event: "connect" | "drop" | "resume" | "close"]>;

	/**
	 * Collect additional UI components to render in core ui extension points.
	 *
	 * Each plugin may return a partial mapping of extension slot names
	 * to React components. All returned components are rendered.
	 *
	 * Multiple plugins may contribute to the same slot.
	 */
	readonly extensionComponents: lib.AsyncHook<[], Partial<{
		[K in PluginExtensionSlot]: ExtensionComponent<K>;
	}>>;

	/**
	 * Collect additional config input components provided by plugins.
	 *
	 * Each plugin may return a mapping of input component names to React components.
	 * These mappings are merged together to form the final registry.
	 *
	 * If multiple plugins define the same key, the last attached handler wins.
	 */
	readonly inputComponents: lib.AsyncHook<[], Record<string, InputComponent>>;

	/**
	 * Additional methods used to login to the web ui.
	 *
	 * All returned components are rendered.
	 * Each must has a unique name prefixed with the plugin name.
	 */
	readonly loginForms: lib.AsyncHook<[], PluginLoginForm[]>;

	/**
	 * Additional pages accessible on the web ui.
	 *
	 * Each page must have a unique path.
	 */
	readonly pages: lib.AsyncHook<[], PluginPage[]>;
}

/**
 * Base class for web interface plugins
 */
export default class BaseWebPlugin {
	/**
	 * Contents of the plugin's package.json file
	 */
	package: any;

	pages: PluginPage[] = [];
	loginForms: PluginLoginForm[] = [];
	inputComponents: Record<string, InputComponent> = {};
	componentExtra: Partial<{
		[K in PluginExtensionSlot]: ExtensionComponent<K>;
	}> = {};

	constructor(
		public container: any,
		packageData: any,
		public info: lib.PluginWebpackEnvInfo,
		public control: Control,
		public logger: lib.Logger,
	) {
		this.package = packageData; // strict mode complains if we don't assign it this way

		const attach = <Args extends unknown[], Return>(
			hook: lib.AsyncHook<Args, Return>,
			fn?: lib.HookHandler<Args, Return>,
		) => {
			if (fn) {
				hook.attach(info.name, fn.bind(this));
			}
		};

		attach(control.hooks.controllerConnectionEvent, this.onControllerConnectionEvent);
		attach(control.hooks.inputComponents, () => this.inputComponents);
		attach(control.hooks.extensionComponents, () => this.componentExtra);
		attach(control.hooks.loginForms, () => this.loginForms);
		attach(control.hooks.pages, () => this.pages);
	}

	static fromContext(context: WebPluginContext): BaseWebPlugin {
		return new this(context.container, context.package, context.plugin, context.control, context.logger);
	}

	/**
	 * Called immediately after the class is instantiated.
	 */
	async init() { }

	onControllerConnectionEvent(event: "connect" | "drop" | "resume" | "close") { }
}
