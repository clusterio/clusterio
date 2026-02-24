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
} from "../model/item_metadata";
import PageHeader from "./PageHeader";
import PageLayout from "./PageLayout";

const { Text } = Typography;

type IconEntry = {
	key: string;
	category: string;
	name: string;
	cssClass: string;
	size: number;
};

const STATIC_ALERT_NAMES = [
	"alert-ammo-icon-red",
	"alert-asteroid-collector-path-blocked-icon",
	"alert-danger-icon",
	"alert-destination-full-icon",
	"alert-destroyed-icon",
	"alert-electricity-icon-red",
	"alert-electricity-icon-unplugged",
	"alert-endangered-by-lightning",
	"alert-endangered-by-lightning-red",
	"alert-fluid-icon-red",
	"alert-food-icon-red",
	"alert-frozen-icon",
	"alert-fuel-icon-red",
	"alert-item-to-be-delivered-symbol",
	"alert-no-building-material-icon",
	"alert-no-path-icon",
	"alert-no-platform-storage-space-icon",
	"alert-no-roboport-storage-space-icon",
	"alert-no-storage-space-icon",
	"alert-not-enough-construction-robots-icon",
	"alert-not-enough-repair-packs-icon",
	"alert-nutrients-icon-red",
	"alert-pipeline-disabled-icon",
	"alert-recharge-icon",
	"alert-resources-depleted-icon",
	"alert-too-far-from-roboport-icon",
	"alert-unclaimed-cargo-icon",
	"alert-warning-icon",
];

const DYNAMIC_CATEGORIES = [
	"item", "recipe", "signal", "technology", "planet", "quality", "entity",
] as const;

const ALL_CATEGORIES = [...DYNAMIC_CATEGORIES, "static"] as const;

type Category = typeof ALL_CATEGORIES[number];

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

	const byCategory: Record<typeof DYNAMIC_CATEGORIES[number], Map<string, { size: number }>> = {
		item, recipe, signal, technology, planet, quality, entity,
	};

	return useMemo(() => {
		const entries: IconEntry[] = [];

		// Dynamic categories from spritesheet metadata
		for (const category of DYNAMIC_CATEGORIES) {
			const names = [...byCategory[category].keys()].sort();
			for (const name of names) {
				const meta = byCategory[category].get(name)!;
				entries.push({
					key: `${category}:${name}`,
					category,
					name,
					cssClass: `${category}-${CSS.escape(name)}`,
					size: meta.size,
				});
			}
		}

		// Static alerts — hardcoded, size 32
		for (const name of STATIC_ALERT_NAMES) {
			entries.push({
				key: `static:${name}`,
				category: "static",
				name,
				cssClass: `static-${CSS.escape(name)}`,
				size: 32,
			});
		}

		return entries;
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [item, recipe, signal, technology, planet, quality, entity]);
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
		for (const cat of ALL_CATEGORIES) {
			map.set(cat, []);
		}
		for (const entry of filtered) {
			map.get(entry.category)!.push(entry);
		}
		return ALL_CATEGORIES.map(cat => ({ category: cat, entries: map.get(cat)! }))
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
	];

	return (
		<PageLayout nav={[{ name: "Icon Reference" }]}>
			<PageHeader title="Icon Reference" />
			<Card style={{ width: "60%", margin: "0 auto" }}>
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
		</PageLayout>
	);
}
