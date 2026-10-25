import React, { useContext, useEffect, useState } from "react";
import { Button, Input, Space, Typography } from "antd";
import ReactMarkdown, { Components } from "react-markdown";

import * as lib from "@clusterio/lib";
import { notifyErrorHandler } from "../util/notify";
import { useAccount } from "../model/account";
import { useNote } from "../model/notes";
import { formatTimestamp } from "../util/time_format";
import ControlContext from "./ControlContext";
import ResourceMention, { mentionPath, mentionPattern } from "./ResourceMention";
import SectionHeader from "./SectionHeader";

const { Text } = Typography;

/**
 * Remark plugin turning @type/id mentions into links and line breaks into
 * hard breaks. Text inside code and existing links is left alone.
 */
function remarkNoteText() {
	function split(value: string) {
		const nodes: any[] = [];
		let last = 0;
		function pushText(text: string) {
			text.split("\n").forEach((line, index) => {
				if (index > 0) {
					nodes.push({ type: "break" });
				}
				if (line) {
					nodes.push({ type: "text", value: line });
				}
			});
		}
		for (const match of value.matchAll(mentionPattern)) {
			pushText(value.slice(last, match.index));
			const resourceType = match[1] ?? match[3];
			const resourceId = match[2] ?? match[4];
			nodes.push({
				type: "link",
				url: mentionPath(resourceType, resourceId),
				children: [{ type: "text", value: match[0] }],
				data: { hProperties: { dataResourceType: resourceType, dataResourceId: resourceId } },
			});
			last = match.index + match[0].length;
		}
		pushText(value.slice(last));
		return nodes;
	}
	function visit(node: any) {
		if (!node.children || node.type === "link" || node.type === "linkReference") {
			return;
		}
		node.children = node.children.flatMap((child: any) => {
			if (child.type === "text") {
				return split(child.value);
			}
			visit(child);
			return [child];
		});
	}
	return visit;
}

const noteComponents: Components = {
	a({ node, ...props }) {
		const resourceType = node?.properties.dataResourceType;
		const resourceId = node?.properties.dataResourceId;
		if (typeof resourceType === "string" && typeof resourceId === "string") {
			return <ResourceMention resourceType={resourceType} resourceId={resourceId} />;
		}
		return <a {...props} target="_blank" rel="noopener noreferrer" />;
	},
};

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
	// Remount on resource change so a draft is never saved to another resource
	return <ResourceNotesEditor key={lib.Note.idFor(props.resourceType, props.resourceId)} {...props} />;
}

function ResourceNotesEditor(props: ResourceNotesProps) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const [note, synced] = useNote(props.resourceType, props.resourceId);
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
		: <Button size="small" onClick={() => setEditing(true)} disabled={!synced}>
			{note ? "Edit" : "Add note"}
		</Button>;

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
			placeholder={
				"Write a note visible to everyone with access to this page. " +
				"Supports Markdown and links like @instance/<id> or @user/<name>"
			}
			autoFocus
		/>
		: <>
			{note
				? <div style={{ overflowWrap: "anywhere" }}>
					<ReactMarkdown remarkPlugins={[remarkNoteText]} components={noteComponents}>
						{note.content}
					</ReactMarkdown>
				</div>
				: <Text type="secondary">{synced ? "No note" : "Loading"}</Text>
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
