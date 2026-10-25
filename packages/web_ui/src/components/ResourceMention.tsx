import React from "react";

import Link from "./Link";
import { useHost } from "../model/host";
import { useInstance } from "../model/instance";
import { useModPack } from "../model/mod_pack";
import { useRole } from "../model/roles";
import { useUser } from "../model/user";

/** Matches @type/id references to resources that have a view page. */
export const mentionPattern = /(?<![\w@])@(?:(host|instance|role|mod_pack)\/(\d+)|(user)\/(#?[\w.-]*[\w-]))/g;

export function mentionPath(resourceType: string, resourceId: string) {
	switch (resourceType) {
		case "host": return `/hosts/${resourceId}/view`;
		case "instance": return `/instances/${resourceId}/view`;
		case "role": return `/roles/${resourceId}/view`;
		case "mod_pack": return `/mods/mod-packs/${resourceId}/view`;
		case "user": return `/users/${encodeURIComponent(resourceId)}/view`;
		default: return undefined;
	}
}

type ResourceMentionProps = {
	resourceType: string;
	resourceId: string;
};

/**
 * Link to a resource showing its name, or its id if the name is not
 * available to this client.
 */
export default function ResourceMention(props: ResourceMentionProps) {
	switch (props.resourceType) {
		case "host": return <HostMention id={props.resourceId} />;
		case "instance": return <InstanceMention id={props.resourceId} />;
		case "role": return <RoleMention id={props.resourceId} />;
		case "mod_pack": return <ModPackMention id={props.resourceId} />;
		case "user": return <UserMention id={props.resourceId} />;
		default: return <>@{props.resourceType}/{props.resourceId}</>;
	}
}

function MentionLink(props: { resourceType: string, id: string, name?: string }) {
	return <Link to={mentionPath(props.resourceType, props.id)!}>{props.name ?? props.id}</Link>;
}

function HostMention(props: { id: string }) {
	const [host] = useHost(Number(props.id));
	return <MentionLink resourceType="host" id={props.id} name={host?.name} />;
}

function InstanceMention(props: { id: string }) {
	const [instance] = useInstance(Number(props.id));
	return <MentionLink resourceType="instance" id={props.id} name={instance?.name} />;
}

function RoleMention(props: { id: string }) {
	const [role] = useRole(Number(props.id));
	return <MentionLink resourceType="role" id={props.id} name={role?.name} />;
}

function ModPackMention(props: { id: string }) {
	const [modPack] = useModPack(Number(props.id));
	return <MentionLink resourceType="mod_pack" id={props.id} name={modPack?.name} />;
}

function UserMention(props: { id: string }) {
	const [user] = useUser(props.id);
	return <MentionLink resourceType="user" id={props.id} name={user?.name} />;
}
