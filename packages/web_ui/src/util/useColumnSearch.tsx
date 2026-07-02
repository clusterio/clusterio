import React, { useRef } from "react";
import { Input, InputRef } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import type { FilterDropdownProps } from "antd/es/table/interface";

import type { TableQueryState } from "./useTableQueryState";

/**
 * Column props for a free-text search filter rendered in the column header
 * dropdown (the same style as the Users table). Spread the result onto a column
 * whose `filteredValue` is `tableState.filteredValue(columnKey)`.
 *
 * Filtering is live: the table updates as you type via {@link TableQueryState.setFilter},
 * and the value is only written to the URL when the dropdown closes (via
 * {@link TableQueryState.commitFilter}).
 *
 * @param tableState The table's query state.
 * @param columnKey Key of the column this search filters (matches its filteredValue key).
 * @param getText Returns the searchable text for a row.
 * @param placeholder Placeholder shown in the search box.
 */
export default function useColumnSearch<T>(
	tableState: TableQueryState<T>,
	columnKey: string,
	getText: (record: T) => string,
	placeholder = "Search",
) {
	const searchInput = useRef<InputRef>(null);

	return {
		filterIcon: (filtered: boolean) => (
			<SearchOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
		),
		filterDropdown: ({ selectedKeys, setSelectedKeys, close }: FilterDropdownProps) => (
			<div style={{ padding: 8, width: 240 }} onKeyDown={e => e.stopPropagation()}>
				<Input.Search
					ref={searchInput}
					placeholder={placeholder}
					value={selectedKeys[0] as string | undefined}
					allowClear
					onChange={e => {
						const values = e.target.value ? [e.target.value] : [];
						setSelectedKeys(values);
						tableState.setFilter(columnKey, values.length ? values : null);
					}}
					onSearch={() => close()}
					onClear={() => {
						setSelectedKeys([]);
						tableState.setFilter(columnKey, null);
					}}
				/>
			</div>
		),
		filterDropdownProps: {
			onOpenChange: (open: boolean) => {
				if (open) {
					setTimeout(() => searchInput.current?.select(), 100);
				} else {
					tableState.commitFilter(columnKey);
				}
			},
		},
		onFilter: (value: React.Key | boolean, record: T) => (
			getText(record).toLowerCase().includes(String(value).toLowerCase())
		),
	};
}
