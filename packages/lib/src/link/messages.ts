import * as core from "../data/messages_core";
import * as controller from "../data/messages_controller";
import * as host from "../data/messages_host";
import * as instance from "../data/messages_instance";
import * as mod from "../data/messages_mod";
import * as user from "../data/messages_user";
import * as role from "../data/messages_role";
import * as plugin from "../data/messages_plugin";
import * as subscriptions from "../subscriptions";
import type { RequestClass, EventClass } from "./link";

/**
 * Event and Request payloads registered with the Link class. Used to decode
 * the data payload of incomming requsts and event messages into instances of
 * their proper classes.
 * @internal
 */
export const dataClasses: (RequestClass<unknown, unknown> | EventClass<unknown>)[] = [
	core.PingRequest,
	core.AccountUpdateEvent,

	controller.ControllerStopRequest,
	controller.ControllerRestartRequest,
	controller.ControllerUpdateRequest,
	controller.ControllerConfigGetRequest,
	controller.ControllerConfigSetFieldRequest,
	controller.ControllerConfigSetPropRequest,
	controller.HostGenerateTokenRequest,
	controller.HostConfigCreateRequest,
	controller.GetFactorioCredentialsRequest,
	controller.LogSetSubscriptionsRequest,
	controller.LogQueryRequest,
	controller.LogMessageEvent,
	controller.SystemInfoRequest,
	controller.SystemInfoUpdateEvent,
	controller.DebugDumpWsRequest,
	controller.DebugWsMessageEvent,
	controller.FactorioVersionsRequest,

	subscriptions.SubscriptionRequest,

	host.HostStopRequest,
	host.HostRestartRequest,
	host.HostUpdateRequest,
	host.HostConfigGetRequest,
	host.HostConfigSetFieldRequest,
	host.HostConfigSetPropRequest,
	host.HostListRequest,
	host.HostInfoUpdateEvent,
	host.HostUpdatesEvent,
	host.HostMetricsRequest,
	host.ControllerConnectionEvent,
	host.PrepareControllerDisconnectRequest,
	host.SyncUserListsEvent,
	host.HostRevokeTokensRequest,

	instance.InstanceDetailsGetRequest,
	instance.InstanceDetailsListRequest,
	instance.InstanceDetailsUpdatesEvent,
	instance.InstanceCreateRequest,
	instance.InstanceConfigGetRequest,
	instance.InstanceConfigSetFieldRequest,
	instance.InstanceConfigSetPropRequest,
	instance.InstanceAssignRequest,
	instance.InstanceMetricsRequest,
	instance.InstanceStartRequest,
	instance.InstanceRestartRequest,
	instance.InstanceSaveDetailsListRequest,
	instance.InstanceSaveDetailsUpdatesEvent,
	instance.InstanceCreateSaveRequest,
	instance.InstanceRenameSaveRequest,
	instance.InstanceCopySaveRequest,
	instance.InstanceDeleteSaveRequest,
	instance.InstanceDownloadSaveRequest,
	instance.InstanceTransferSaveRequest,
	instance.InstancePullSaveRequest,
	instance.InstancePushSaveRequest,
	instance.InstanceLoadScenarioRequest,
	instance.InstanceExportDataRequest,
	instance.InstanceExtractPlayersRequest,
	instance.InstanceStopRequest,
	instance.InstanceKillRequest,
	instance.InstanceDeleteRequest,
	instance.InstanceDeleteInternalRequest,
	instance.InstanceSendRconRequest,
	instance.InstancesUpdateRequest,
	instance.InstanceAssignInternalRequest,
	instance.InstanceUnassignInternalRequest,
	instance.InstanceInitialisedEvent,
	instance.InstanceStatusChangedEvent,
	instance.InstanceDetailsChangedEvent,
	instance.InstanceBanlistUpdateEvent,
	instance.InstanceAdminlistUpdateEvent,
	instance.InstanceWhitelistUpdateEvent,
	instance.InstancePlayerUpdateEvent,

	mod.ModPackGetRequest,
	mod.ModPackGetDefaultRequest,
	mod.ModPackListRequest,
	mod.ModPackCreateRequest,
	mod.ModPackUpdateRequest,
	mod.ModPackDeleteRequest,
	mod.ModGetRequest,
	mod.ModListRequest,
	mod.ModSearchRequest,
	mod.ModPortalGetAllRequest,
	mod.ModDownloadRequest,
	mod.ModDeleteRequest,
	mod.ModPackUpdatesEvent,
	mod.ModUpdatesEvent,
	mod.ModPortalDownloadRequest,
	mod.ModDependencyResolveRequest,

	role.PermissionListRequest,
	role.RoleListRequest,
	role.RoleUpdatesEvent,
	role.RoleCreateRequest,
	role.RoleUpdateRequest,
	role.RoleGrantDefaultPermissionsRequest,
	role.RoleDeleteRequest,

	user.UserGetRequest,
	user.UserListRequest,
	user.UserCreateRequest,
	user.UserRevokeTokenRequest,
	user.UserUpdateRolesRequest,
	user.UserSetAdminRequest,
	user.UserSetWhitelistedRequest,
	user.UserSetBannedRequest,
	user.UserDeleteRequest,
	user.UserUpdatesEvent,
	user.UserBulkImportRequest,
	user.UserBulkExportRequest,

	plugin.PluginListRequest,
	plugin.PluginUpdateRequest,
	plugin.PluginInstallRequest,
];
