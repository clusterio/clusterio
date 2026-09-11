import React, { useRef } from "react";
import { InputRef, Input, Space, Segmented, Typography, Tag } from "antd";
import type { FilterDropdownProps } from "antd/es/table/interface";
import { CheckOutlined, CloseOutlined, MinusOutlined } from "@ant-design/icons";
import { UserDetails } from "@clusterio/lib";
import type { FilterCodec } from "../util/tableQuery";
import type { TableQueryState } from "../util/useTableQueryState";
const { Text } = Typography;

export interface UserFilter {
	search?: string;
	admin?: boolean;
	whitelisted?: boolean;
	banned?: boolean;
}

function encodeFilter(value: UserFilter): string {
	return JSON.stringify(value);
}

function decodeFilter(value: string): UserFilter {
	try {
		return JSON.parse(value);
	} catch {
		return {};
	}
}

function triFromParam(value: string | null): boolean | undefined {
	if (value === "true") { return true; }
	if (value === "false") { return false; }
	return undefined;
}

/**
 * Persists the bundled user filter as separate readable query parameters
 * (`filter.name` for the text search plus `filter.admin`/`filter.whitelisted`/
 * `filter.banned`) instead of one opaque JSON blob. Plug into
 * useTableQueryState via `filterCodecs: { name: userFilterCodec }`.
 */
export const userFilterCodec: FilterCodec = {
	decode(params, prefix) {
		const filter: UserFilter = {};
		const search = params.get(`${prefix}name`);
		if (search) { filter.search = search; }
		const admin = triFromParam(params.get(`${prefix}admin`));
		if (admin !== undefined) { filter.admin = admin; }
		const whitelisted = triFromParam(params.get(`${prefix}whitelisted`));
		if (whitelisted !== undefined) { filter.whitelisted = whitelisted; }
		const banned = triFromParam(params.get(`${prefix}banned`));
		if (banned !== undefined) { filter.banned = banned; }
		return Object.keys(filter).length ? [encodeFilter(filter)] : null;
	},
	encode(params, value, prefix) {
		const filter = value && value[0] ? decodeFilter(String(value[0])) : {};
		const set = (key: string, val: string | undefined) => (
			val !== undefined ? params.set(prefix + key, val) : params.delete(prefix + key)
		);
		set("name", filter.search || undefined);
		set("admin", filter.admin === undefined ? undefined : String(filter.admin));
		set("whitelisted", filter.whitelisted === undefined ? undefined : String(filter.whitelisted));
		set("banned", filter.banned === undefined ? undefined : String(filter.banned));
	},
};

function triStateToSegmented(value?: boolean) {
	if (value === true) { return "yes"; }
	if (value === false) { return "no"; }
	return "any";
}

function segmentedToTriState(value: string): boolean | undefined {
	if (value === "yes") { return true; }
	if (value === "no") { return false; }
	return undefined;
}

function matchesTriState(value: boolean, filter?: boolean) {
	return filter === undefined || value === filter;
}

export function onFilterUser(
	value: boolean | React.Key,
	record: UserDetails
) {
	const filter = decodeFilter(String(value));

	// Name filter
	if (filter.search) {
		if (!record.name.toLowerCase().includes(filter.search.toLowerCase())) {
			return false;
		}
	}

	// Status filter
	return matchesTriState(record.isAdmin, filter.admin)
		&& matchesTriState(record.isWhitelisted, filter.whitelisted)
		&& matchesTriState(record.isBanned, filter.banned);
}

export function Username({
	user,
	withStatus = false,
} : {
	user: UserDetails,
	withStatus: boolean,
}) {
	return (
		<Space>
			{user.name}
			{withStatus && (
				<span>
					{user.isAdmin && <Tag color="gold">Admin</Tag>}
					{user.isWhitelisted && <Tag>Whitelisted</Tag>}
					{user.isBanned && <Tag color="red">Banned</Tag>}
				</span>
			)}
		</Space>
	);
}

export function useUserFilter(
	tableState: TableQueryState<UserDetails>,
	columnKey: string,
	withStatus?: boolean,
) {
	const searchInput = useRef<InputRef>(null);

	function filterDropdown({
		selectedKeys,
		setSelectedKeys,
		close,
	}: FilterDropdownProps) {
		const filter: UserFilter = selectedKeys[0]
			? decodeFilter(String(selectedKeys[0]))
			: {};

		// Update the live filter as the user types/toggles; the URL is only written when the
		// dropdown closes (see onOpenChange) or when enter is pressed (see onPressEnter)
		function update(next: Partial<UserFilter>) {
			const encoded = encodeFilter({ ...filter, ...next });
			const values = encoded === "{}" ? null : [encoded];
			setSelectedKeys(values ?? []);
			tableState.setFilter(columnKey, values);
		}

		return (
			<div style={{ padding: 8, width: 240 }} onKeyDown={(e) => e.stopPropagation()}>
				<Space direction="vertical" style={{ width: "100%" }}>
					<Input.Search
						ref={searchInput}
						placeholder="Search username"
						value={filter.search}
						allowClear
						onPressEnter={e => {
							close();
							tableState.commitFilter(columnKey);
						}}
						onChange={(e) => update({ search: e.target.value !== "" ? e.target.value : undefined })}
					/>

					{withStatus &&<>
						<Space size={8} align="center">
							<Segmented
								size="small"
								value={triStateToSegmented(filter.admin)}
								onChange={value => update({ admin: segmentedToTriState(value) })}
								options={[
									{ icon: <CloseOutlined />, value: "no", className: "seg-no" },
									{ icon: <MinusOutlined />, value: "any" },
									{ icon: <CheckOutlined />, value: "yes", className: "seg-yes" },
								]}
							/>
							<Text>Admin</Text>
						</Space>

						<Space size={8} align="center">
							<Segmented
								size="small"
								value={triStateToSegmented(filter.whitelisted)}
								onChange={value => update({ whitelisted: segmentedToTriState(value) })}
								options={[
									{ icon: <CloseOutlined />, value: "no", className: "seg-no" },
									{ icon: <MinusOutlined />, value: "any" },
									{ icon: <CheckOutlined />, value: "yes", className: "seg-yes" },
								]}
							/>
							<Text>Whitelist</Text>
						</Space>

						<Space size={8} align="center">
							<Segmented
								size="small"
								value={triStateToSegmented(filter.banned)}
								onChange={value => update({ banned: segmentedToTriState(value) })}
								options={[
									{ icon: <CloseOutlined />, value: "no", className: "seg-no" },
									{ icon: <MinusOutlined />, value: "any" },
									{ icon: <CheckOutlined />, value: "yes", className: "seg-yes" },
								]}
							/>
							<Text>Banned</Text>
						</Space>
					</>}
				</Space>
			</div>
		);
	}

	const filterDropdownProps = {
		onOpenChange: (open: boolean) => {
			if (open) {
				setTimeout(() => searchInput.current?.select(), 100);
			} else {
				tableState.commitFilter(columnKey);
			}
		},
	};

	return { filterDropdown, filterDropdownProps };
}
