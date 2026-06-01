import React, { useRef } from "react";
import { InputRef, Input, Space, Segmented, Button, Typography } from "antd";
import type { FilterDropdownProps } from "antd/es/table/interface";
import { CheckOutlined, CloseOutlined, MinusOutlined } from "@ant-design/icons";
import { UserDetails } from "@clusterio/lib";
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
	value: string | number | boolean,
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

export function useUserFilter() {
	const searchInput = useRef<InputRef>(null);

	function filterDropdown({
		selectedKeys,
		setSelectedKeys,
		confirm,
		clearFilters,
	}: {
		selectedKeys: string[];
		setSelectedKeys: (keys: string[]) => void;
		confirm: FilterDropdownProps["confirm"];
		clearFilters: FilterDropdownProps["clearFilters"];
	}) {
		const filter: UserFilter = selectedKeys[0]
			? decodeFilter(selectedKeys[0])
			: {};

		function update(next: Partial<UserFilter>, search?: boolean) {
			const updated = { ...filter, ...next };
			setSelectedKeys([encodeFilter(updated)]);
			confirm({ closeDropdown: false });
		}

		return (
			<div style={{ padding: 8, width: 240 }} onKeyDown={(e) => e.stopPropagation()}>
				<Space direction="vertical" style={{ width: "100%" }}>
					<Input.Search
						ref={searchInput}
						placeholder="Search username"
						value={filter.search}
						allowClear
						onChange={(e) => update({ search: e.target.value })}
						onSearch={() => confirm({ closeDropdown: true })}
						onClear={() => {
							clearFilters?.({ closeDropdown: false });
							confirm({ closeDropdown: true });
						}}
					/>

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
				</Space>
			</div>
		);
	}

	const filterDropdownProps = {
		onOpenChange: (open: boolean) => {
			if (open) {
				setTimeout(() => searchInput.current?.select(), 100);
			}
		},
	};

	return { filterDropdown, filterDropdownProps };
}
