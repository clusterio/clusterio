import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Alert, Button, Descriptions, Drawer, Input, Popconfirm, Space, Table, Typography, Upload } from "antd";
import type { ColumnType } from "antd/es/table";
import { DeleteOutlined, SearchOutlined } from "@ant-design/icons";

import * as lib from "@clusterio/lib";
import {
	PageLayout, PageHeader, ControlContext, FactorioIcon, notify, notifyErrorHandler,
	useAccount, useInstances, useDefaultModPack, useExportLocale, useExportPrototypeMetadata,
	useTableQueryState, useColumnSearch, type WebPluginContext,
} from "@clusterio/web_ui";
import {
	DatabaseStatsRequest, DatabaseStatsResponse, DeletePlayerDataRequest, ForceReleaseRequest,
	GetPlayerDataRequest, GetPlayerDataResponse, IpcPlayerData, ListPlayersRequest, PlayerEntry,
	SetPlayerDataRequest,
} from "../messages.js";
import { type ItemSummary, summarizePlayerInventories } from "../player_data.js";

import "./style.css";

const strcmp = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

function useInstanceName() {
	const [instances] = useInstances();
	return (instanceId?: number) => {
		if (instanceId === undefined) {
			return "";
		}
		return instances.get(instanceId)?.name ?? `Instance ${instanceId}`;
	};
}

function titleCase(text: string) {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

// Factorio reads colors back as 0-1 floats but accepts 0-255 as well
function formatColor(color: any) {
	let [r, g, b] = Array.isArray(color) ? color : [color.r, color.g, color.b];
	let scale = Math.max(r, g, b) > 1 ? 1 : 255;
	let hex = (c: number) => Math.min(255, Math.max(0, Math.round(c * scale))).toString(16).padStart(2, "0");
	return `#${hex(r)}${hex(g)}${hex(b)}`;
}

// Filters the table locally, the inventory tables are not kept in the URL
function itemSearch<T>(getText: (record: T) => string): ColumnType<T> {
	return {
		filterIcon: (filtered: boolean) => <SearchOutlined style={{ color: filtered ? "#1677ff" : undefined }} />,
		filterDropdown: ({ selectedKeys, setSelectedKeys, confirm }) => (
			<div style={{ padding: 8, width: 240 }} onKeyDown={e => e.stopPropagation()}>
				<Input.Search
					placeholder="Search"
					value={selectedKeys[0] as string | undefined}
					allowClear
					onChange={e => {
						setSelectedKeys(e.target.value ? [e.target.value] : []);
						confirm({ closeDropdown: false });
					}}
					onPressEnter={() => confirm()}
				/>
			</div>
		),
		onFilter: (value, record) => getText(record).toLowerCase().includes(String(value).toLowerCase()),
	};
}

function InventoryTable(props: { name: string, items: ItemSummary[] }) {
	const modPack = useDefaultModPack();
	const locale = useExportLocale(modPack);
	const prototypes = useExportPrototypeMetadata(modPack);
	const itemMetadata = prototypes?.get("item");
	const qualityMetadata = prototypes?.get("quality");
	// The export lists qualities in the order mods define them, normal is left out of the stored data
	const qualityOrder = [...qualityMetadata?.keys() ?? []];
	const qualityRank = (quality?: string) => (quality === undefined ? -1 : qualityOrder.indexOf(quality));

	function getLocaleName(type: "item" | "quality", name: string) {
		let meta = (type === "item" ? itemMetadata : qualityMetadata)?.get(name);
		if (typeof meta?.localised_name === "string") {
			return meta.localised_name;
		}
		if (meta?.localised_name) {
			return locale.get(meta.localised_name[0]) ?? name;
		}
		if (type === "quality") {
			return locale.get(`quality-name.${name}`) ?? name;
		}
		return locale.get(`item-name.${name}`) ?? locale.get(`entity-name.${name}`) ?? name;
	}
	const itemText = (item: ItemSummary) => (
		item.exportSize !== undefined ? item.name : `${getLocaleName("item", item.name)} ${item.name}`
	);

	return <Table<ItemSummary>
		size="small"
		title={() => titleCase(props.name)}
		columns={[
			{
				title: "Item",
				key: "item",
				...itemSearch(itemText),
				sorter: (a, b) => strcmp(itemText(a), itemText(b)),
				render: (_, item) => (item.exportSize !== undefined
					? <Typography.Text type="secondary">{item.name}</Typography.Text>
					: <Space size="small">
						<FactorioIcon modPackId={modPack?.id} prototype={itemMetadata?.get(item.name)} />
						{getLocaleName("item", item.name)}
					</Space>
				),
			},
			{
				title: "Quality",
				key: "quality",
				sorter: (a, b) => qualityRank(a.quality) - qualityRank(b.quality),
				render: (_, item) => item.quality !== undefined && <Space size="small">
					<FactorioIcon modPackId={modPack?.id} prototype={qualityMetadata?.get(item.quality)} />
					{getLocaleName("quality", item.quality)}
				</Space>,
			},
			{
				title: "Count",
				key: "count",
				align: "right",
				sorter: (a, b) => a.count - b.count,
				render: (_, item) => item.count,
			},
			{
				title: "Size",
				key: "size",
				align: "right",
				sorter: (a, b) => (a.exportSize ?? -1) - (b.exportSize ?? -1),
				render: (_, item) => (item.exportSize === undefined ? "" : lib.formatBytes(item.exportSize)),
			},
		]}
		dataSource={props.items.map((item, key) => ({ ...item, key }))}
		pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
	/>;
}

function usePlayerData(playerName?: string) {
	const control = useContext(ControlContext);
	const [loaded, setLoaded] = useState<{ playerName: string, response: GetPlayerDataResponse }>();
	// Only the latest request may set the response, an import or delete can finish after a reload
	const requestId = useRef(0);
	const currentPlayer = useRef(playerName);
	currentPlayer.current = playerName;

	const reload = useCallback(() => {
		// Ignore reloads from actions that finish after switching to another player
		if (playerName !== currentPlayer.current) {
			return;
		}
		requestId.current += 1;
		let id = requestId.current;
		if (playerName === undefined) {
			return;
		}
		control.send(new GetPlayerDataRequest(playerName)).then(response => {
			if (id === requestId.current) {
				setLoaded({ playerName, response });
			}
		}).catch(
			notifyErrorHandler("Error loading player data")
		);
	}, [control, playerName]);
	useEffect(reload, [reload]);

	return [loaded?.playerName === playerName ? loaded?.response : undefined, reload] as const;
}

type PlayerProps = { playerName: string, response: GetPlayerDataResponse, onChange: () => void };

function PlayerDrawer(props: { playerName?: string, onClose: () => void, onChange: () => void }) {
	const { playerName } = props;
	const [response, reload] = usePlayerData(playerName);

	function changed() {
		reload();
		props.onChange();
	}

	const loaded = response && playerName !== undefined;
	return <Drawer
		title={playerName}
		open={playerName !== undefined}
		onClose={props.onClose}
		size="large"
		extra={loaded && <PlayerActions playerName={playerName} response={response} onChange={changed} />}
	>
		{loaded && <PlayerDetails playerName={playerName} response={response} onChange={changed} />}
	</Drawer>;
}

function PlayerActions(props: PlayerProps) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const { playerName, response } = props;

	async function upload(file: File) {
		let playerData: IpcPlayerData;
		try {
			playerData = JSON.parse(await file.text());
		} catch (err: any) {
			notify("Invalid JSON", "error", err.message);
			return;
		}
		playerData.name = playerName;
		playerData.generation ??= 0;
		let result = await control.send(new SetPlayerDataRequest(playerName, playerData));
		notify(`Stored player data for ${playerName} as generation ${result.generation}`);
		props.onChange();
	}

	function download() {
		let json = JSON.stringify(response.playerData, null, "\t");
		let url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
		let link = document.createElement("a");
		link.href = url;
		link.download = `${playerName}.json`;
		link.click();
		URL.revokeObjectURL(url);
	}

	const canModify = account.hasPermission("player_sync.inventory.modify");
	const acquired = response.instanceId !== undefined;
	return <Space>
		<Button disabled={!response.playerData} onClick={download}>Export</Button>
		{canModify && <Upload
			accept=".json,application/json"
			showUploadList={false}
			disabled={acquired}
			beforeUpload={file => {
				upload(file).catch(notifyErrorHandler("Error storing player data"));
				return false;
			}}
		>
			<Button disabled={acquired}>Import</Button>
		</Upload>}
		{canModify && <Popconfirm
			title="Delete the stored player data?"
			description={
				"The next join creates a new synced inventory from whatever the player has on that instance."
			}
			okText="Delete"
			okButtonProps={{ danger: true }}
			onConfirm={() => control.send(new DeletePlayerDataRequest(playerName)).then(props.onChange).catch(
				notifyErrorHandler("Error deleting player data")
			)}
		>
			<Button danger title="Delete" icon={<DeleteOutlined />} disabled={!response.playerData || acquired} />
		</Popconfirm>}
	</Space>;
}

function PlayerDetails(props: PlayerProps) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const instanceName = useInstanceName();
	const { playerName, response } = props;
	const playerData = response.playerData;
	const canModify = account.hasPermission("player_sync.inventory.modify");
	const color = playerData?.color ? formatColor(playerData.color) : undefined;
	let cheatMode = "-";
	if (playerData?.cheat_mode !== undefined) {
		cheatMode = playerData.cheat_mode ? "Yes" : "No";
	}

	return <Space direction="vertical" size="middle" style={{ width: "100%" }}>
		{response.instanceId !== undefined && <Alert
			type="info"
			showIcon
			message={`Acquired by ${instanceName(response.instanceId)}`}
			description={<>
				This is not a live view. The stored data goes out of date while the instance holds the player, and
				is replaced when the player leaves and the instance uploads its copy.
				{canModify && " Importing and deleting are disabled until then. Release the lock if the instance " +
					"is stuck holding it."}
			</>}
			action={canModify && <Popconfirm
				title="Release the lock on this player?"
				onConfirm={() => control.send(new ForceReleaseRequest(playerName)).then(props.onChange).catch(
					notifyErrorHandler("Error releasing lock")
				)}
			>
				<Button danger>Release</Button>
			</Popconfirm>}
		/>}
		<Descriptions bordered size="small" column={2}>
			<Descriptions.Item label="Generation">{playerData?.generation ?? "-"}</Descriptions.Item>
			<Descriptions.Item label="Size">
				{playerData ? lib.formatBytes(JSON.stringify(playerData).length) : "-"}
			</Descriptions.Item>
			<Descriptions.Item label="Controller">{playerData?.controller ?? "-"}</Descriptions.Item>
			<Descriptions.Item label="Force">{playerData?.force ?? "-"}</Descriptions.Item>
			<Descriptions.Item label="Color">
				{color ? <Space size="small">
					<span className="player-sync-color" style={{ background: color }} />
					{color}
				</Space> : "-"}
			</Descriptions.Item>
			<Descriptions.Item label="Cheat mode">{cheatMode}</Descriptions.Item>
		</Descriptions>
		{!playerData && <Typography.Text type="secondary">No player data stored</Typography.Text>}
		{playerData && summarizePlayerInventories(playerData).map(
			inventory => <InventoryTable key={inventory.name} {...inventory} />
		)}
	</Space>;
}

function InventoryPage() {
	const control = useContext(ControlContext);
	const instanceName = useInstanceName();
	const [statsData, setStatsData] = useState<DatabaseStatsResponse>();
	const [players, setPlayers] = useState<PlayerEntry[]>([]);
	const [selected, setSelected] = useState<string>();

	const tableState = useTableQueryState<PlayerEntry>({
		namespace: "inventory", defaultSortKey: "name", pagination: { defaultPageSize: 50 },
	});
	const nameSearch = useColumnSearch<PlayerEntry>(tableState, "name", player => player.name, "Search");
	const forces = [...new Set(players.flatMap(player => (player.force === undefined ? [] : [player.force])))];

	const reload = useCallback(() => {
		control.send(new DatabaseStatsRequest()).then(setStatsData).catch(
			notifyErrorHandler("Error loading player sync statistics")
		);
		control.send(new ListPlayersRequest()).then(setPlayers).catch(
			notifyErrorHandler("Error loading player list")
		);
	}, [control]);
	useEffect(reload, [reload]);

	return <PageLayout nav={[{ name: "Player sync" }]}>
		<PageHeader title="Player sync" />
		{statsData && <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
			<Descriptions.Item label="Database size">{lib.formatBytes(statsData.databaseSize)}</Descriptions.Item>
			<Descriptions.Item label="Database entries">{statsData.databaseEntries}</Descriptions.Item>
		</Descriptions>}
		<Table
			columns={[
				{
					title: "Name",
					key: "name",
					dataIndex: "name",
					...nameSearch,
					filteredValue: tableState.filteredValue("name"),
					sorter: (a, b) => strcmp(a.name, b.name),
					sortOrder: tableState.sortOrder("name"),
				},
				{
					title: "Force",
					key: "force",
					filters: forces.sort(strcmp).map(force => ({ text: force, value: force })),
					filterMultiple: true,
					filteredValue: tableState.filteredValue("force"),
					onFilter: (value, player) => player.force === value,
					sorter: (a, b) => strcmp(a.force ?? "", b.force ?? ""),
					sortOrder: tableState.sortOrder("force"),
					render: (_, player) => player.force ?? "-",
				},
				{
					title: "Size",
					key: "size",
					align: "right",
					sorter: (a, b) => (a.size ?? -1) - (b.size ?? -1),
					sortOrder: tableState.sortOrder("size"),
					render: (_, player) => (player.size === undefined ? "-" : lib.formatBytes(player.size)),
				},
				{
					title: "Acquired by",
					key: "instance",
					sorter: (a, b) => strcmp(instanceName(a.instanceId), instanceName(b.instanceId)),
					sortOrder: tableState.sortOrder("instance"),
					render: (_, player) => instanceName(player.instanceId),
				},
			]}
			dataSource={players}
			rowKey="name"
			pagination={tableState.pagination}
			onChange={tableState.onChange}
			onRow={player => ({
				style: { cursor: "pointer" },
				onClick: () => setSelected(player.name),
			})}
		/>
		<PlayerDrawer playerName={selected} onClose={() => setSelected(undefined)} onChange={reload} />
	</PageLayout>;
}

export default async function(context: WebPluginContext) {
	const { control, plugin } = context;

	control.hooks.pages.attach(plugin.name, () => [
		{
			path: "/inventory",
			sidebarName: "Player sync",
			permission: "player_sync.inventory.view",
			content: <InventoryPage />,
		},
	]);
}
