export async function githubFetch(
	path: string,
	query: Record<string, string>= {},
	init: RequestInit & { headers?: Record<string, string> } = {},
) {
	const url = new URL("https://api.github.com/");
	url.pathname = path;
	for (const [name, value] of Object.entries(query)) {
		url.searchParams.set(name, value);
	}
	init = {
		...init,
		headers: {
			...init.headers as Record<string, string> ?? {},
			"Accept": "application/vnd.github+json",
		}
	};
	if (process.env.GH_TOKEN) {
		init.headers!["Authorization"] = `Bearer ${process.env.GH_TOKEN}`;
	}
	console.log("Fetching", url.href);
	const response = await fetch(url, init);
	if (!response.ok) {
		console.log(response.headers);
		throw new Error(`GitHub replied with ${response.status} ${response.statusText}: ${await response.text()}`);
	}
	if (!response.headers.get("Content-Type")?.startsWith("application/json")) {
		throw new Error(
			`GitHub replied with ${response.status} ${response.statusText}: ${response.headers.get("Content-Type")}`
		);
	}
	return response;
}

export async function githubFetchJson<T>(
	path: string,
	query: Record<string, string> = {},
	init: RequestInit & { headers?: Record<string, string> } = {},
): Promise<T> {
	const response = await githubFetch(path, query, init);
	return await response.json();
}

export async function githubFetchJsonPaginated<T>(
	path: string,
	query: Record<string, string> = {},
	init: RequestInit & { headers?: Record<string, string> } = {},
	shouldContinue: (result: T[]) => boolean = () => true,
): Promise<T[]> {
	const data: T[] = [];
	let pagesRemaining = true;
	query = {
		...query,
		per_page: "100",
	};
	while (pagesRemaining) {
		const response = await githubFetch(path, query, init);
		const responseItems = await response.json();
		data.push(...responseItems);
		const linkHeader = response.headers.get("Link");
		pagesRemaining = linkHeader?.includes(`rel="next"`) ?? false;
		if (pagesRemaining) {
			pagesRemaining = shouldContinue(responseItems);
		}
		if (pagesRemaining) {
			query = {
				...query,
				page: String((query.page ? (Number(query.page)) : 1) + 1),
			}
		}
	}
	return data;
}

// Minimal types that include only what is used and useful for our scripts.  See
// https://docs.github.com/en/rest for complete reference.
export interface PullRequest {
	number: number,
	url: string,
	html_url: string,
	state: string,
	title: string,
	body: string | null,
	created_at: string,
	updated_at: string,
	closed_at: string | null,
	merged_at: string | null,
	merge_commit_sha: string | null,
}

export interface Issue {
	number: number,
	title: string,
	url: string,
	html_url: string,
	state: string,
	body?: string | null,
	user: {
		login: string,
		url: string,
		html_url: string,
	}
	pull_request?: {
		url: string,
		html_url: string,
		merged_at?: string | null,
	},
}

export interface Release {
	tag_name: string,
	target_commitish: string,
	name: string | null,
	body: string | null,
	created_at: string,
	published_at: string | null,
	updated_at?: string | null,
}

export interface Commit {
	sha: string,
	commit: {
		message: string,
	},
	author: null | {} | {
		name?: null | string,
		login: string,
		type: string,
	},
	parents: {
		sha: string,
	}[],
}

export interface Reference {
	ref: string,
	object: {
		type: string,
		sha: string,
	},
}
