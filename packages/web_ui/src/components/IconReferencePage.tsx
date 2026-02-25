import React, { useMemo, useState } from "react";
import { Card, Input, Space, Table, Tag, Typography } from "antd";

import {
	useItemMetadata,
	useRecipeMetadata,
	useSignalMetadata,
	useTechnologyMetadata,
	usePlanetMetadata,
	useQualityMetadata,
	useEntityMetadata,
	useStaticMetadata,
} from "../model/item_metadata";
import { useExportManifest } from "../model/export_manifest";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";

const { Text } = Typography;

type IconEntry = {
	key: string;
	category: string;
	name: string;
	cssClass: string;
	size: number;
	path?: string;
};

const CATEGORIES = [
	"item", "recipe", "signal", "technology", "planet", "quality", "entity", "static",
] as const;

type Category = typeof CATEGORIES[number];

const CATEGORY_LABELS: Record<Category, string> = {
	item: "Item",
	recipe: "Recipe",
	signal: "Signal",
	technology: "Technology",
	planet: "Planet",
	quality: "Quality",
	entity: "Entity",
	static: "Static",
};

function useAllIconEntries() {
	const item = useItemMetadata();
	const recipe = useRecipeMetadata();
	const signal = useSignalMetadata();
	const technology = useTechnologyMetadata();
	const planet = usePlanetMetadata();
	const quality = useQualityMetadata();
	const entity = useEntityMetadata();
	const staticIcons = useStaticMetadata();

	const byCategory: Record<Category, Map<string, { size: number; path?: string }>> = {
		item, recipe, signal, technology, planet, quality, entity, static: staticIcons,
	};

	return useMemo(() => {
		const entries: IconEntry[] = [];

		for (const category of CATEGORIES) {
			const names = [...byCategory[category].keys()].sort();
			for (const name of names) {
				const meta = byCategory[category].get(name)!;
				entries.push({
					key: `${category}:${name}`,
					category,
					name,
					cssClass: `${category}-${CSS.escape(name)}`,
					size: meta.size,
					path: meta.path,
				});
			}
		}

		return entries;
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [item, recipe, signal, technology, planet, quality, entity, staticIcons]);
}

export default function IconReferencePage() {
	const [filter, setFilter] = useState("");
	const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
	const allEntries = useAllIconEntries();

	const filtered = useMemo(() => {
		const q = filter.trim().toLowerCase();
		if (!q) {
			return allEntries;
		}
		return allEntries.filter(e =>
			e.name.toLowerCase().includes(q) || e.cssClass.toLowerCase().includes(q)
		);
	}, [allEntries, filter]);

	const groups = useMemo(() => {
		const map = new Map<string, IconEntry[]>();
		for (const cat of CATEGORIES) {
			map.set(cat, []);
		}
		for (const entry of filtered) {
			map.get(entry.category)!.push(entry);
		}
		return CATEGORIES.map(cat => ({ category: cat, entries: map.get(cat)! }))
			.filter(g => g.entries.length > 0);
	}, [filtered]);

	const visibleCount = filtered.length;
	const totalCount = allEntries.length;
	const autoExpand = visibleCount <= 20;

	const isExpanded = (category: string) =>
		autoExpand || expandedGroups.has(category);

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
			dataIndex: "cssClass",
			key: "icon",
			width: 48,
			render: (_: string, record: IconEntry) => (
				<div className={record.cssClass} style={{ imageRendering: "pixelated" }} />
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
			title: "Usage",
			dataIndex: "cssClass",
			key: "usage",
			render: (cssClass: string) => (
				<Text code style={{ fontSize: 11, color: "#90ee90" }}>
					{"<div className=\"" + cssClass + "\" />"}
				</Text>
			),
		},
		{
			title: "Path",
			dataIndex: "path",
			key: "path",
			render: (p: string | undefined) => p
				? <Text type="secondary" style={{ fontSize: 11 }}>{p}</Text>
				: null,
		},
	];

	const manifest = useExportManifest();

	return (
		<PageLayout nav={[{ name: "Icon Reference" }]}>
			<PageHeader title="Icon Reference" />
			<div style={{ width: "80%", margin: "0 auto" }}>
				{manifest && (manifest.modPackName || manifest.instanceName || manifest.exportedAt) && (
					<div style={{ marginBottom: 12, fontSize: 12, lineHeight: 1.8 }}>
						{manifest.modPackName && (
							<div><Text type="secondary">Mod Pack: </Text><Text>{manifest.modPackName}</Text></div>
						)}
						{manifest.instanceName && (
							<div><Text type="secondary">Instance: </Text><Text>{manifest.instanceName}</Text></div>
						)}
						{manifest.exportedAt && (
							<div><Text type="secondary">Exported: </Text><Text>{new Date(manifest.exportedAt).toLocaleString()}</Text></div>
						)}
						<div>
							<Text type="secondary">Icons: </Text>
							<Text>{totalCount}</Text>
						</div>
					</div>
				)}
			<Card>
				<Space style={{ marginBottom: 16, display: "flex", alignItems: "center" }}>
					<Input
						placeholder="Filter by name or class…"
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
				{groups.map(({ category, entries }) => {
					const label = CATEGORY_LABELS[category as Category] ?? category;
					const expanded = isExpanded(category);
					return (
						<div key={category} style={{ marginBottom: 8 }}>
							<div
								onClick={() => toggleGroup(category)}
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
								<Tag style={{ margin: 0 }}>{label}</Tag>
								<Text type="secondary" style={{ fontSize: 12 }}>
									{entries.length}
								</Text>
							</div>
							{expanded && (
								<Table<IconEntry>
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
