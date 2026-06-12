import React from "react";
import { Modal } from "antd";
import ReactMarkdown from "react-markdown";

import changelog from "../../../../CHANGELOG.md";

const cleanedChangelog = changelog
	.replace(/<!--[\s\S]*?-->/g, "") // remove comments
	.replace(/^#\s+Changelog\s*\n?/i, ""); // remove top-level title

/**
 * Displays a modal element which contains the change log
 */
export default function ChangeLogModal({ open, onClose }: any) {
	return <Modal
		title="Changelog"
		open={open}
		onCancel={onClose}
		footer={null}
		width={800}
	>
		<ReactMarkdown>
			{cleanedChangelog}
		</ReactMarkdown>
	</Modal>;
}
