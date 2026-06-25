/**
 * Pure helpers for storing antd Table state (sort / filters / pagination) in
 * the URL query string. Kept free of React and antd runtime imports so the
 * serialisation can be unit tested in isolation.
 *
 * Every parameter is namespaced with the table's name so the URL is
 * self-describing and two tables could coexist on one page without colliding:
 *   <ns>.sort        `<field>.<asc|desc>`, e.g. user.sort=name.desc
 *   <ns>.page        1-based page number
 *   <ns>.size        rows per page
 *   <ns>.<column>    filter value for that column (e.g. user.name, user.admin)
 *
 * System keys (`sort`, `page`, `size`) are reserved, so filterable columns must
 * not use those names. `prefix` below is the namespace with its trailing dot,
 * e.g. "user.". Multi-value filters use a repeated parameter
 * (`user.roles=1&user.roles=2`) so URLSearchParams handles encoding once.
 */

export type SortOrder = "ascend" | "descend";

export interface TableSortState {
	/** Column key the table is sorted by, or undefined for no/default sort. */
	columnKey?: string;
	/** Sort direction, or undefined when unsorted. */
	order?: SortOrder;
}

export interface TablePageState {
	page: number;
	pageSize: number;
}

/** A single filter value as produced by antd (React.Key is string | number | bigint). */
export type FilterValue = string | number | bigint | boolean;

/**
 * Maps a single column's antd filter value to/from one or more query
 * parameters. Lets a column that bundles several controls (e.g. the user
 * filter) persist as separate readable params instead of one opaque blob.
 * `prefix` is the table namespace with its trailing dot, e.g. "user.".
 */
export interface FilterCodec {
	/** Read this column's `filteredValue` from the query, or null when inactive. */
	decode(params: URLSearchParams, prefix: string): string[] | null;
	/** Write this column's antd filter value into `params` (mutating). */
	encode(params: URLSearchParams, value: ReadonlyArray<FilterValue> | null, prefix: string): void;
}

/** Suffixes reserved for table-level state; any other `<prefix><x>` is a column filter. */
const RESERVED_SUFFIXES = new Set(["sort", "page", "size"]);

/** Convert a URL sort direction token to the antd sort order. */
function orderFromToken(token: string): SortOrder {
	return token === "desc" ? "descend" : "ascend";
}

/** Convert an antd sort order to a URL direction token. */
function tokenFromOrder(order: SortOrder): string {
	return order === "descend" ? "desc" : "asc";
}

/**
 * Read the sort state from the query, falling back to the supplied defaults
 * when no sort parameter is present. The value is `<field>.<asc|desc>`; only the
 * first `<prefix>sort` parameter is used (the format allows repeats so
 * multi-column sort can be added later without changing the URL shape).
 */
export function parseSort(
	params: URLSearchParams,
	prefix: string,
	defaultKey?: string,
	defaultOrder: SortOrder = "ascend",
): TableSortState {
	const raw = params.getAll(`${prefix}sort`)[0];
	if (!raw) {
		return { columnKey: defaultKey, order: defaultKey ? defaultOrder : undefined };
	}
	const dot = raw.lastIndexOf(".");
	const columnKey = dot === -1 ? raw : raw.slice(0, dot);
	const order = dot === -1 ? defaultOrder : orderFromToken(raw.slice(dot + 1));
	return { columnKey, order };
}

/** Read pagination state from the query, tolerating missing/garbage values. */
export function parsePagination(
	params: URLSearchParams,
	prefix: string,
	defaultPageSize: number,
	defaultPage = 1,
): TablePageState {
	const page = Number.parseInt(params.get(`${prefix}page`) ?? "", 10);
	const pageSize = Number.parseInt(params.get(`${prefix}size`) ?? "", 10);
	return {
		page: Number.isInteger(page) && page >= 1 ? page : defaultPage,
		pageSize: Number.isInteger(pageSize) && pageSize >= 1 ? pageSize : defaultPageSize,
	};
}

/** Collect every namespaced column-filter parameter into a map of column key -> values. */
export function parseFilters(params: URLSearchParams, prefix: string): Record<string, string[]> {
	const filters: Record<string, string[]> = {};
	for (const key of params.keys()) {
		if (key.startsWith(prefix)) {
			const column = key.slice(prefix.length);
			if (!RESERVED_SUFFIXES.has(column) && !(column in filters)) {
				filters[column] = params.getAll(key);
			}
		}
	}
	return filters;
}

/**
 * Write the sort state into `params` (mutating it). The parameters are omitted
 * when the sort matches the table default or is cleared, keeping default URLs
 * clean.
 */
export function applySort(
	params: URLSearchParams,
	prefix: string,
	sort: TableSortState,
	defaultKey?: string,
	defaultOrder: SortOrder = "ascend",
): void {
	const { columnKey, order } = sort;
	const isDefault = columnKey === defaultKey && (order ?? defaultOrder) === defaultOrder;
	params.delete(`${prefix}sort`);
	if (columnKey && order && !isDefault) {
		params.set(`${prefix}sort`, `${columnKey}.${tokenFromOrder(order)}`);
	}
}

/**
 * Write the filter state into `params` (mutating it). `filters` is the object
 * antd hands to onChange: every filterable column key mapped to its current
 * value array, or null when inactive.
 */
export function applyFilters(
	params: URLSearchParams,
	prefix: string,
	filters: Record<string, ReadonlyArray<FilterValue> | null>,
): void {
	for (const [key, values] of Object.entries(filters)) {
		const param = prefix + key;
		params.delete(param);
		if (values) {
			for (const value of values) {
				params.append(param, String(value));
			}
		}
	}
}

/**
 * Write pagination into `params` (mutating it). Defaults (page 1 / default
 * page size) are omitted to keep URLs clean.
 */
export function applyPagination(
	params: URLSearchParams,
	prefix: string,
	page: number,
	pageSize: number,
	defaultPageSize: number,
): void {
	if (page > 1) {
		params.set(`${prefix}page`, String(page));
	} else {
		params.delete(`${prefix}page`);
	}
	if (pageSize !== defaultPageSize) {
		params.set(`${prefix}size`, String(pageSize));
	} else {
		params.delete(`${prefix}size`);
	}
}
