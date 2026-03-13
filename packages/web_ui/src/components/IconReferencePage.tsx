import { useMemo, useState } from "react";
import { Card, Input, Space, Table, Tag, Typography } from "antd";

import { useExportPrototypeMetadata } from "../model/export_prototype_metadata";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";
import FactorioIcon from "./FactorioIcon";
import { useParams } from "react-router-dom";
import { useModPack } from "../model/mod_pack";
import { PrototypeMetadataEntry } from "../store/export_prototype_metadata_store";

const { Text } = Typography;

function filterPrototypes(
	prototypes: Map<string, Map<string, PrototypeMetadataEntry>> | undefined,
	filter: string
) {
	const query = filter.trim().toLowerCase();
	return new Map(
		[...prototypes ?? []].map(([baseType, entries]) => [
			baseType,
			new Map([...entries.entries()].filter(([name, entry]) => (
				`${entry.base_type}.${name}`.includes(query)
				|| `${entry.type}.${name}`.includes(query)
			))),
		]),
	);
}

function countPrototypes(
	prototypes: Map<string, Map<string, PrototypeMetadataEntry>> | undefined,
) {
	return prototypes ? [...prototypes.values()].reduce((a, e) => a + e.size, 0) : 0;
}

export default function IconReferencePage() {
	let params = useParams();
	let modPackId = Number(params.id);

	const [filter, setFilter] = useState("");
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
	const [modPack] = useModPack(modPackId);
	const manifest = modPack?.exportManifest;
	const prototypes = useExportPrototypeMetadata(modPack);
	const filtered = useMemo(() => filterPrototypes(prototypes, filter), [prototypes, filter]);
	const groups = useMemo(() => (
		[...filtered]
			.map(([baseType, entries]) => ({ baseType, entries: [...entries.values()] }))
			.filter(group => group.entries.length)
	), [filtered]);

	const visibleCount = countPrototypes(filtered);
	const totalCount = countPrototypes(prototypes);
	const autoExpand = visibleCount <= 20;

	const isExpanded = (category: string) => autoExpand || expandedGroups.has(category);

	const toggleGroup = (category: string) => {
		setExpandedGroups(prev => {
			const next = new Set(prev);
			if (next.has(category)) {
				next.delete(category);
			} else {
				next.add(category);
			}
			return next;
		});
	};

	const columns = [
		{
			title: "Icon",
			key: "icon",
			width: 48,
			render: (prototype: PrototypeMetadataEntry) => (
				<FactorioIcon modPackId={modPackId} prototype={prototype}/>
			),
		},
		{
			title: "Name",
			dataIndex: "name",
			key: "name",
			render: (name: string) => (
				<Text style={{ fontSize: 12 }}>{name}</Text>
			),
		},
		{
			title: "Path",
			dataIndex: ["icon", "path"],
			key: "path",
			render: (p: string | undefined) => (p
				? <Text type="secondary" style={{ fontSize: 11 }}>{p}</Text>
				: null),
		},
	];

	let nav = [
		{ name: "Mods", path: "/mods" },
		{ name: "Mod Packs" },
		{ name: modPack?.name ?? String(modPackId), path: `/mods/mod-packs/${modPackId}/view` },
		{ name: "Icon Reference" },
	];
	return (
		<PageLayout nav={nav}>
			<PageHeader title="Icon Reference" />
			<div style={{ width: "80%", margin: "0 auto" }}>
				{!modPack?.exportManifest && (
					<Card>
						<Text type="secondary">
							No export data available. Run export-data on an instance to generate icons.
						</Text>
					</Card>
				)}
				{manifest && manifest.exportedAt && (
					<div style={{ marginBottom: 12, fontSize: 12, lineHeight: 1.8 }}>
						{manifest.exportedAt && (
							<div>
								<Text type="secondary">Exported: </Text>
								<Text>{new Date(manifest.exportedAt).toLocaleString()}</Text>
							</div>
						)}
						<div>
							<Text type="secondary">Prototypes: </Text>
							<Text>{totalCount}</Text>
						</div>
					</div>
				)}
				<Card>
					<Space style={{ marginBottom: 16, display: "flex", alignItems: "center" }}>
						<Input
							placeholder="Filter by type or name…"
							value={filter}
							onChange={e => setFilter(e.target.value)}
							allowClear
							style={{ width: 320 }}
						/>
						<Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
							{visibleCount === totalCount
								? `${totalCount} icons`
								: `${visibleCount} / ${totalCount} icons`}
						</Text>
					</Space>
					{groups.map(({ baseType, entries }) => {
						const expanded = isExpanded(baseType);
						return (
							<div key={baseType} style={{ marginBottom: 8 }}>
								<div
									onClick={() => toggleGroup(baseType)}
									style={{
										display: "flex",
										alignItems: "center",
										gap: 8,
										padding: "6px 12px",
										background: "#1d1d1d",
										border: "1px solid #333",
										borderRadius: expanded ? "4px 4px 0 0" : 4,
										cursor: "pointer",
										userSelect: "none",
									}}
								>
									<span style={{ fontSize: 10, color: "#888", width: 12 }}>
										{expanded ? "▾" : "►"}
									</span>
									<Tag style={{ margin: 0 }}>{baseType}</Tag>
									<Text type="secondary" style={{ fontSize: 12 }}>
										{entries.length}
									</Text>
								</div>
								{expanded && (
									<Table<PrototypeMetadataEntry>
										columns={columns}
										dataSource={entries}
										rowKey="key"
										size="small"
										showHeader={false}
										pagination={false}
										style={{ borderTop: "none" }}
									/>
								)}
							</div>
						);
					})}
				</Card>
			</div>
		</PageLayout>
	);
}
