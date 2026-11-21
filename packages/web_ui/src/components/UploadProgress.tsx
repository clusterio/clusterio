import { useCallback, useState } from "react";
import { Button, List, Progress, Typography, type UploadProps } from "antd";

import * as lib from "@clusterio/lib";

import notify, { notifyErrorHandler } from "../util/notify";

type CustomRequest = NonNullable<UploadProps["customRequest"]>;

interface Upload {
	uid: string;
	name: string;
	loaded: number;
	total: number;
	abort: () => void;
}

function errorMessage(err: any, body: any) {
	const errors = [...body?.request_errors ?? [], ...body?.errors ?? []];
	if (errors.length) {
		return errors.join(", ");
	}
	if (err instanceof Error) {
		return err.message;
	}
	return "Connection to the controller failed";
}

/**
 * Track uploads made by antd Upload components and show them with a cancel button.
 * @returns customRequest to pass to every Upload sharing the list, and the list to render.
 */
export function useUploadProgress(): { customRequest: CustomRequest, list: React.ReactNode } {
	const [uploads, setUploads] = useState<Upload[]>([]);

	function update(uid: string, change: Partial<Upload>) {
		setUploads(current => current.map(upload => (upload.uid === uid ? { ...upload, ...change } : upload)));
	}
	function remove(uid: string) {
		setUploads(current => current.filter(upload => upload.uid !== uid));
	}

	const customRequest = useCallback<CustomRequest>((options, { defaultRequest }) => {
		const file = options.file as File & { uid: string };
		const uid = file.uid;
		// antd types this as void, rc-upload returns the abort handle.
		const request = defaultRequest({
			...options,
			onProgress(event) {
				options.onProgress?.(event);
				update(uid, { loaded: event.loaded ?? 0, total: event.total ?? file.size });
			},
			onSuccess(body, xhr) {
				options.onSuccess?.(body, xhr);
				remove(uid);
			},
			onError(err, body) {
				options.onError?.(err, body);
				remove(uid);
				notifyErrorHandler(`Error uploading ${file.name}`)(new Error(errorMessage(err, body)));
			},
		}) as unknown as { abort: () => void };
		const abort = () => {
			request.abort();
			// An aborted XMLHttpRequest calls neither onload nor onerror.
			options.onError?.(new Error("Upload cancelled"));
			remove(uid);
			notify(`Cancelled upload of ${file.name}`);
		};
		setUploads(current => [...current, { uid, name: file.name, loaded: 0, total: file.size, abort }]);
		return { abort };
	}, []);

	const list = uploads.length ? <List
		size="small"
		className="upload-progress-list"
		dataSource={uploads}
		rowKey={upload => upload.uid}
		renderItem={upload => <List.Item
			actions={[<Button key="cancel" size="small" onClick={upload.abort}>Cancel</Button>]}
		>
			<div style={{ flex: 1, minWidth: 0 }}>
				<Typography.Text ellipsis>{upload.name}</Typography.Text>
				<Progress
					percent={upload.total ? upload.loaded / upload.total * 100 : 0}
					format={() => `${lib.formatBytes(upload.loaded)} / ${lib.formatBytes(upload.total)}`}
				/>
			</div>
		</List.Item>}
	/> : null;

	return { customRequest, list };
}
