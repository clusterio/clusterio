import React, { useState, ReactNode } from "react";
import { Modal, Tooltip } from "antd";
import ReactMarkdown from "react-markdown";

import webUiPackage from "../../package.json";
import changelog from "../../../../CHANGELOG.md";

const cleanedChangelog = changelog
	.replace(/<!--[\s\S]*?-->/g, "") // remove comments
	.replace(/^#\s+Changelog\s*\n?/i, ""); // remove top-level title

type Props = {
	/** Optional tooltip text */
	tooltip?: string;
	/** Optional class for the clickable wrapper */
	className?: string;
	/** Custom clickable content */
	children?: ReactNode;
};

/**
 * Displays a clickable element which opens a modal containing the changelog.
 * Defaults to showing the current version if no children are provided.
 */
export default function ChangeLogModal({
	tooltip = "View changelog",
	className = "site-version",
	children = webUiPackage.version,
}: Props) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<Tooltip
				title={tooltip}
				placement="bottom"
				align={{ offset: [0, -10] }}
			>
				<span
					className={className}
					style={{ cursor: "pointer" }}
					onClick={() => setOpen(true)}
				>
					{children}
				</span>
			</Tooltip>

			<Modal
				title="Changelog"
				open={open}
				onCancel={() => setOpen(false)}
				footer={null}
				width={800}
			>
				<div style={{ maxHeight: "70vh", overflow: "auto" }}>
					<ReactMarkdown>
						{cleanedChangelog}
					</ReactMarkdown>
				</div>
			</Modal>
		</>
	);
}
