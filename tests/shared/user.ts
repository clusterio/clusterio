import * as lib from "@clusterio/lib";

/** User that records permission checks and denies the given permission */
export function permissionRecorder(denied?: string) {
	const checked: string[] = [];
	const user = {
		checkPermission(permission: string) {
			checked.push(permission);
			if (permission === denied) {
				throw new lib.PermissionError("Permission denied");
			}
		},
	} as unknown as lib.IUser;
	return { user, checked };
}
