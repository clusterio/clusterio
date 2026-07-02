import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { TablePaginationConfig } from "antd";
import type { FilterValue, SorterResult } from "antd/es/table/interface";

import {
	applyFilters, applyPagination, applySort,
	parseFilters, parsePagination, parseSort,
	type FilterCodec, type SortOrder,
} from "./tableQuery";

export interface TableQueryStateOptions {
	/** Table name used to namespace every query parameter, e.g. "user" -> `user.sort`, `user.name`. */
	namespace: string;
	/** Column key sorted by default (no `sort` param present). Omit for no default sort. */
	defaultSortKey?: string;
	/** Direction of the default sort. Default "ascend". */
	defaultSortOrder?: SortOrder;
	/** Pagination config to persist pagination; only `defaultPageSize` is read (omit for `pagination={false}`). */
	pagination?: false | TablePaginationConfig;
	/** Per-column-key codecs to persist a bundled filter value as separate readable params. */
	filterCodecs?: Record<string, FilterCodec>;
}

export interface TableQueryState<T> {
	/** Spread onto `<Table onChange={...}>` to persist sort/filter/pagination (pushes history). */
	onChange: (
		pagination: TablePaginationConfig,
		filters: Record<string, FilterValue | null>,
		sorter: SorterResult<T> | SorterResult<T>[],
	) => void;
	/** Controlled `sortOrder` for the column with this key (null unless it's the active sort). */
	sortOrder: (columnKey: string) => SortOrder | null;
	/** Controlled `filteredValue` for the column with this key (null when no filter is active). */
	filteredValue: (columnKey: string) => string[] | null;
	/** Set a column's live filter — filters the table immediately without writing the URL. */
	setFilter: (columnKey: string, values: string[] | null) => void;
	/** Commit a column's filter to the URL: pass `values` to write now (e.g. clear), omit to commit the override. */
	commitFilter: (columnKey: string, values?: string[] | null) => void;
	/** Controlled pagination ({@link current}/{@link pageSize}), or `false` when disabled. */
	pagination: false | TablePaginationConfig;
}

/**
 * Persist an antd Table's sort, column filters and pagination into the URL
 * query string, so reload, link-sharing and browser back/forward restore the
 * same view (clusterio issue #927).
 */
export default function useTableQueryState<T>(options: TableQueryStateOptions): TableQueryState<T> {
	const { defaultSortKey, defaultSortOrder = "ascend" } = options;
	const prefix = `${options.namespace}.`;
	const codecs = options.filterCodecs ?? {};
	const paginationOptions = options.pagination && typeof options.pagination === "object"
		? options.pagination
		: undefined;
	const paginationEnabled = paginationOptions !== undefined;
	const defaultPageSize = paginationOptions?.defaultPageSize ?? 10;

	const [params, setParams] = useSearchParams();
	// Live filter overrides let the table filter as the user types without writing the
	// URL on every keystroke; they are committed to the URL when the filter dropdown
	// closes (see commitFilter) and cleared whenever the URL changes (commit, back/forward).
	const [liveFilters, setLiveFilters] = useState<Record<string, string[] | null>>({});
	// A ref mirrors the overrides so commitFilter always reads the latest values even within
	// the same event that set them (e.g. clearing then closing), instead of a stale closure.
	const liveFiltersRef = useRef<Record<string, string[] | null>>(liveFilters);
	const paramsString = params.toString();
	useEffect(() => {
		liveFiltersRef.current = {};
		setLiveFilters({});
	}, [paramsString]);

	const sort = parseSort(params, prefix, defaultSortKey, defaultSortOrder);
	const filters = parseFilters(params, prefix);
	const page = paginationEnabled ? parsePagination(params, prefix, defaultPageSize) : undefined;

	return {
		onChange(pagination, tableFilters, sorter) {
			// Only single-column sort is persisted; antd passes an array when several
			// columns are sorted, so take the first (primary) sorter.
			const single = Array.isArray(sorter) ? sorter[0] : sorter;
			const order = single && single.order ? single.order : undefined;
			const columnKey = order ? String(single.columnKey ?? single.field ?? "") : undefined;

			const next = new URLSearchParams(params);
			applySort(next, prefix, { columnKey, order }, defaultSortKey, defaultSortOrder);
			const plainFilters: Record<string, FilterValue | null> = {};
			for (const [key, values] of Object.entries(tableFilters)) {
				const codec = codecs[key];
				if (codec) {
					codec.encode(next, values, prefix);
				} else {
					plainFilters[key] = values;
				}
			}
			applyFilters(next, prefix, plainFilters);
			if (paginationEnabled) {
				applyPagination(
					next, prefix, pagination.current ?? 1, pagination.pageSize ?? defaultPageSize, defaultPageSize
				);
			}
			setParams(next);
		},

		sortOrder(columnKey) {
			return columnKey === sort.columnKey ? (sort.order ?? null) : null;
		},

		filteredValue(columnKey) {
			if (columnKey in liveFilters) {
				return liveFilters[columnKey];
			}
			const codec = codecs[columnKey];
			return codec ? codec.decode(params, prefix) : (filters[columnKey] ?? null);
		},

		setFilter(columnKey, values) {
			const nextLive = { ...liveFiltersRef.current, [columnKey]: values };
			liveFiltersRef.current = nextLive;
			setLiveFilters(nextLive);
		},

		commitFilter(columnKey, values) {
			// Explicit values (e.g. from the clear button) are written immediately; otherwise
			// commit the current live override, if any (e.g. when the dropdown closes).
			let effective = values;
			if (effective === undefined && columnKey in liveFiltersRef.current) {
				effective = liveFiltersRef.current[columnKey];
			}
			if (effective === undefined) {
				return;
			}
			const next = new URLSearchParams(params);
			const codec = codecs[columnKey];
			if (codec) {
				codec.encode(next, effective, prefix);
			} else {
				applyFilters(next, prefix, { [columnKey]: effective });
			}
			// Avoid pushing a duplicate history entry when nothing actually changed.
			if (next.toString() !== paramsString) {
				setParams(next);
			}
		},

		pagination: paginationEnabled && page
			? { current: page.page, pageSize: page.pageSize }
			: false,
	};
}
