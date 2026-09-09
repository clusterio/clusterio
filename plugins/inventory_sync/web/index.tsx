import React, { useCallback, useContext, useEffect, useState } from "react";
import { Alert, Button, Descriptions, Drawer, Popconfirm, Space, Table, Typography, Upload } from "antd";

import * as lib from "@clusterio/lib";
import {
	BaseWebPlugin, PageLayout, PageHeader, ControlContext, FactorioIcon, notify, notifyErrorHandler,
	useAccount, useInstances, useDefaultModPack, useExportLocale, useExportPrototypeMetadata,
	useTableQueryState, useColumnSearch,
} from "@clusterio/web_ui";
import {
	DatabaseStatsRequest, DatabaseStatsResponse, DeletePlayerDataRequest, ForceReleaseRequest,
	GetPlayerDataRequest, GetPlayerDataResponse, IpcPlayerData, ListPlayersRequest, PlayerEntry,
	SetPlayerDataRequest,
} from "../messages";
import { type ItemSummary, summarizePlayerInventories } from "../player_data";

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

function InventoryTable(props: { name: string, items: ItemSummary[] }) {
	const modPack = useDefaultModPack();
	const locale = useExportLocale(modPack);
	const prototypes = useExportPrototypeMetadata(modPack);
	const itemMetadata = prototypes?.get("item");

	function getLocaleName(itemName: string) {
		let meta = itemMetadata?.get(itemName);
		if (typeof meta?.localised_name === "string") {
			return meta.localised_name;
		}
		if (meta?.localised_name) {
			return locale.get(meta.localised_name[0]) ?? itemName;
		}
		return locale.get(`item-name.${itemName}`) ?? locale.get(`entity-name.${itemName}`) ?? itemName;
	}

	return <Table
		size="small"
		title={() => props.name}
		columns={[
			{
				title: "Item",
				key: "item",
				render: (_, item) => (item.exportSize !== undefined
					? <Typography.Text type="secondary">{item.name}</Typography.Text>
					: <>
						<FactorioIcon modPackId={modPack?.id} prototype={itemMetadata?.get(item.name)} />
						{getLocaleName(item.name)}
					</>
				),
			},
			{
				title: "Quality",
				key: "quality",
				render: (_, item) => item.quality,
			},
			{
				title: "Count",
				key: "count",
				align: "right",
				render: (_, item) => item.count,
			},
			{
				title: "Size",
				key: "size",
				align: "right",
				render: (_, item) => (item.exportSize === undefined ? "" : lib.formatBytes(item.exportSize)),
			},
		]}
		dataSource={props.items.map((item, key) => ({ ...item, key }))}
		pagination={false}
	/>;
}

function PlayerDrawer(props: { playerName?: string, onClose: () => void, onChange: () => void }) {
	const control = useContext(ControlContext);
	const account = useAccount();
	const instanceName = useInstanceName();
	const [response, setResponse] = useState<GetPlayerDataResponse>();
	const { playerName } = props;

	const reload = useCallback(() => {
		if (playerName === undefined) {
			setResponse(undefined);
			return;
		}
		control.send(new GetPlayerDataRequest(playerName)).then(setResponse).catch(
			notifyErrorHandler("Error loading player data")
		);
	}, [control, playerName]);
	useEffect(reload, [reload]);

	function changed() {
		reload();
		props.onChange();
	}

	async function upload(file: File) {
		let playerData: IpcPlayerData;
		try {
			playerData = JSON.parse(await file.text());
		} catch (err: any) {
			notify("Invalid JSON", "error", err.message);
			return;
		}
		playerData.name = playerName!;
		playerData.generation ??= 0;
		let result = await control.send(new SetPlayerDataRequest(playerName!, playerData));
		notify(`Stored player data for ${playerName} as generation ${result.generation}`);
		changed();
	}

	function download() {
		let json = JSON.stringify(response!.playerData, null, "\t");
		let url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
		let link = document.createElement("a");
		link.href = url;
		link.download = `${playerName}.json`;
		link.click();
		URL.revokeObjectURL(url);
	}

	const canModify = account.hasPermission("inventory_sync.inventory.modify");
	const playerData = response?.playerData;
	const acquiredBy = response?.instanceId !== undefined ? instanceName(response.instanceId) : undefined;
	return <Drawer
		title={playerName}
		open={playerName !== undefined}
		onClose={props.onClose}
		size="large"
	>
		{response && <Space direction="vertical" size="middle" style={{ width: "100%" }}>
			{acquiredBy !== undefined && <Alert
				type="info"
				showIcon
				message={`Acquired by ${acquiredBy}`}
				description={
					"The instance uploads its copy of the player data when the player leaves. Have the player " +
					"leave before modifying it, or release the lock if the instance is stuck holding it."
				}
				action={canModify && <Popconfirm
					title="Release the lock on this player?"
					onConfirm={() => control.send(new ForceReleaseRequest(playerName!)).then(changed).catch(
						notifyErrorHandler("Error releasing lock")
					)}
				>
					<Button>Release</Button>
				</Popconfirm>}
			/>}
			<Descriptions bordered size="small" column={2}>
				<Descriptions.Item label="Generation">{playerData?.generation ?? "-"}</Descriptions.Item>
				<Descriptions.Item label="Size">
					{playerData ? lib.formatBytes(JSON.stringify(playerData).length) : "-"}
				</Descriptions.Item>
				<Descriptions.Item label="Controller">{playerData?.controller ?? "-"}</Descriptions.Item>
				<Descriptions.Item label="Force">{playerData?.force ?? "-"}</Descriptions.Item>
			</Descriptions>
			<Space wrap>
				<Button disabled={!playerData} onClick={download}>Export JSON</Button>
				{canModify && <Upload
					accept=".json,application/json"
					showUploadList={false}
					beforeUpload={file => {
						upload(file).catch(notifyErrorHandler("Error storing player data"));
						return false;
					}}
				>
					<Button>Import JSON</Button>
				</Upload>}
				{canModify && <Popconfirm
					title="Delete the stored player data?"
					description={
						"The next join creates a new synced inventory from whatever the player has on that instance."
					}
					okText="Delete"
					okButtonProps={{ danger: true }}
					onConfirm={() => control.send(new DeletePlayerDataRequest(playerName!)).then(changed).catch(
						notifyErrorHandler("Error deleting player data")
					)}
				>
					<Button danger disabled={!playerData}>Delete</Button>
				</Popconfirm>}
			</Space>
			{!playerData && <Typography.Text type="secondary">No player data stored</Typography.Text>}
			{playerData && summarizePlayerInventories(playerData).map(
				inventory => <InventoryTable key={inventory.name} {...inventory} />
			)}
		</Space>}
	</Drawer>;
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

	const reload = useCallback(() => {
		control.send(new DatabaseStatsRequest()).then(setStatsData).catch(
			notifyErrorHandler("Error loading inventory sync statistics")
		);
		control.send(new ListPlayersRequest()).then(setPlayers).catch(
			notifyErrorHandler("Error loading player list")
		);
	}, [control]);
	useEffect(reload, [reload]);

	return <PageLayout nav={[{ name: "Inventory sync" }]}>
		<PageHeader title="Inventory sync" />
		{statsData && <>
			<p>Database size: {lib.formatBytes(statsData.databaseSize)}</p>
			<p>Database entries: {statsData.databaseEntries}</p>
			<p>Largest entry is {statsData.largestEntry.name} with {lib.formatBytes(statsData.largestEntry.size)}</p>
		</>}
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
					title: "Generation",
					key: "generation",
					align: "right",
					sorter: (a, b) => (a.generation ?? -1) - (b.generation ?? -1),
					sortOrder: tableState.sortOrder("generation"),
					render: (_, player) => player.generation ?? "-",
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

export class WebPlugin extends BaseWebPlugin {
	async init() {
		this.pages = [
			{
				path: "/inventory",
				sidebarName: "Inventory sync",
				permission: "inventory_sync.inventory.view",
				content: <InventoryPage />,
			},
		];
	}
}
