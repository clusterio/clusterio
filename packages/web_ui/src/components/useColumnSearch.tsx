import React, { useRef } from "react";
import { Input, InputRef } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { FilterDropdownProps } from "antd/es/table/interface";

/**
 * Column props for a free-text search filter rendered in the column header
 * dropdown (the same style as the Users table). Spread the result onto a
 * column; the search value is persisted through the table's filter state by
 * {@link useTableQueryState}.
 *
 * @param getText Returns the searchable text for a row.
 * @param placeholder Placeholder shown in the search box.
 */
export default function useColumnSearch<T>(getText: (record: T) => string, placeholder = "Search") {
	const searchInput = useRef<InputRef>(null);

	return {
		filterIcon: (filtered: boolean) => (
			<SearchOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
		),
		filterDropdown: ({ selectedKeys, setSelectedKeys, confirm, clearFilters }: FilterDropdownProps) => (
			<div style={{ padding: 8, width: 240 }} onKeyDown={e => e.stopPropagation()}>
				<Input.Search
					ref={searchInput}
					placeholder={placeholder}
					value={selectedKeys[0] as string | undefined}
					allowClear
					onChange={e => setSelectedKeys(e.target.value ? [e.target.value] : [])}
					onSearch={() => confirm({ closeDropdown: true })}
					onClear={() => {
						clearFilters?.({ closeDropdown: false });
						confirm({ closeDropdown: true });
					}}
				/>
			</div>
		),
		filterDropdownProps: {
			onOpenChange: (open: boolean) => {
				if (open) {
					setTimeout(() => searchInput.current?.select(), 100);
				}
			},
		},
		onFilter: (value: React.Key | boolean, record: T) => (
			getText(record).toLowerCase().includes(String(value).toLowerCase())
		),
	};
}
