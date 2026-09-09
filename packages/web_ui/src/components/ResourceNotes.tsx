import React, { useContext, useEffect, useState } from "react";
import { Button, Input, Space, Typography } from "antd";

import * as lib from "@clusterio/lib";
import { notifyErrorHandler } from "../util/notify";
import { useAccount } from "../model/account";
import { useNote } from "../model/notes";
import { formatTimestamp } from "../util/time_format";
import ControlContext from "./ControlContext";
import SectionHeader from "./SectionHeader";

const { Text } = Typography;

type ResourceNotesProps = {
	/** Type of resource, such as "host" or "instance". */
	resourceType: string;
	/** Id of the resource within its type. */
	resourceId: string | number;
	/** Render without the section header, for use inside tables and modals. */
	compact?: boolean;
};

/**
 * Shows the note attached to a resource with an editor for users that
 * have the core.note.update permission.
 */
export default function ResourceNotes(props: ResourceNotesProps) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [note] = useNote(props.resourceType, props.resourceId);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");
	const [saving, setSaving] = useState(false);
	const canUpdate = account.hasPermission("core.note.update");
	const canView = account.hasPermission("core.note.subscribe");

	// Pick up changes made by others while not editing
	const content = note?.content ?? "";
	useEffect(() => {
		if (!editing) {
			setDraft(content);
		}
	}, [content, editing]);

	if (!canView && !canUpdate) {
		return null;
	}

	function save() {
		setSaving(true);
		control.send(new lib.NoteSetRequest(props.resourceType, String(props.resourceId), draft))
			.then(() => setEditing(false))
			.catch(notifyErrorHandler("Error saving note"))
			.finally(() => setSaving(false));
	}

	function cancel() {
		setDraft(content);
		setEditing(false);
	}

	const buttons = editing
		? <Space>
			<Button size="small" onClick={cancel} disabled={saving}>Cancel</Button>
			<Button size="small" type="primary" onClick={save} loading={saving}>Save</Button>
		</Space>
		: <Button size="small" onClick={() => setEditing(true)}>{note ? "Edit" : "Add note"}</Button>;

	const body = editing
		? <Input.TextArea
			autoSize={{ minRows: 3 }}
			value={draft}
			onChange={e => setDraft(e.target.value)}
			onKeyDown={e => {
				if (e.key === "Escape") {
					cancel();
				} else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
					save();
				}
			}}
			placeholder="Write a note visible to everyone with access to this page"
			autoFocus
		/>
		: <>
			{note
				? <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{note.content}</div>
				: <Text type="secondary">No note</Text>
			}
			{note && (note.updatedBy || note.updatedAtMs) && <div>
				<Text type="secondary" style={{ fontSize: "0.85em" }}>
					Last edited{note.updatedBy ? ` by ${note.updatedBy}` : ""}
					{note.updatedAtMs ? ` on ${formatTimestamp(note.updatedAtMs)}` : ""}
				</Text>
			</div>}
		</>;

	if (props.compact) {
		return <Space direction="vertical" style={{ width: "100%" }}>
			{body}
			{canUpdate && buttons}
		</Space>;
	}

	return <>
		<SectionHeader title="Notes" extra={canUpdate ? buttons : undefined} />
		{body}
	</>;
}
