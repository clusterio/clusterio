import { useRef } from "react";

export type ResourceStatus = "loading" | "ok" | "missing" | "deleted" | "error";

export function getResourceStatus(
	exists: boolean,
	seen: boolean,
	synced: boolean,
	error: Error | null,
): ResourceStatus {
	if (exists) {
		return "ok";
	}
	// A retry only clears the error when its response arrives, which can be after the update that synced it
	if (synced) {
		return seen ? "deleted" : "missing";
	}
	return error ? "error" : "loading";
}

/**
 * Status of the resource shown on a view page, for use with the ResourceState component
 *
 * @param value - The resource, undefined or null if the subscription does not have it.
 * @param synced - The synced property from the subscription.
 * @param error - The error property from the subscription.
 * @param id - Identifies the resource shown, the router reuses the page when navigating between resources.
 * @returns "ok" if there is a value to show, otherwise why there isn't.
 */
export default function useResourceState(value: unknown, synced: boolean, error: Error | null, id: number | string) {
	const seenId = useRef<number | string>(undefined);
	const exists = value !== undefined && value !== null;
	if (exists) {
		seenId.current = id;
	}
	return getResourceStatus(exists, seenId.current === id, synced, error);
}
