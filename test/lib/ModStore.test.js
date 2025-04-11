"use strict";
const assert = require("assert").strict;
const path = require("path");
const fs = require("fs-extra");
const JSZip = require("jszip"); // Added for creating mock zips

// Capture native fetch before any potential mocks are applied
const nativeFetch = global.fetch;

// Removed logger mocking setup

const { ModStore, ModInfo } = require("@clusterio/lib"); // Adjust path based on compiled output

// Mock fetch function
global.fetch = async (url, options) => {
	throw new Error(`fetch mock not implemented for ${url}`);
};

const MODS_DIR = path.join("temp", "test", "mod_store", "mods");
const CACHE_FILE = path.join(MODS_DIR, "mod-info-cache.json");

// Helper function to create a mock mod zip file
async function createMockModZip(filePath, name, version, factorioVersion = "1.1", dependencies = ["base >= 1.1"]) {
	const zip = new JSZip();
	const infoJson = {
		name: name,
		version: version,
		title: `${name} Mod Title`,
		author: "Test Author",
		factorio_version: factorioVersion,
		dependencies: dependencies,
		description: `Description for ${name}`,
	};
	zip.file(`${name}/info.json`, JSON.stringify(infoJson, null, 4));
	zip.file(`${name}/dummy.lua`, "-- Mock Lua file");

	await fs.ensureDir(path.dirname(filePath));
	const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
	await fs.writeFile(filePath, buffer);
}

// Helper to wait briefly for mtime changes
async function waitBriefly() {
	return new Promise(resolve => setTimeout(resolve, 50)); // 50ms should be enough for mtime resolution
}

describe("lib/ModStore", function () {
	before(async function () {
		await fs.ensureDir(MODS_DIR);
	});

	beforeEach(function () {
		// Reset mocks before each test
		global.fetch = async (url, options) => {
			throw new Error(`fetch mock not implemented for ${url} in this test`);
		};
	});

	afterEach(async function () {
		await fs.emptyDir(MODS_DIR);
	});

	describe("constructor", function () {
		it("should create an instance with empty files map", function () {
			const modStore = new ModStore(MODS_DIR, new Map());
			assert(modStore instanceof ModStore);
			assert.equal(modStore.modsDirectory, MODS_DIR);
			assert.equal(modStore.files.size, 0);
		});
	});

	describe("fromDirectory", function () {
		it("should load from an empty directory", async function () {
			const modStore = await ModStore.fromDirectory(MODS_DIR);
			assert(modStore instanceof ModStore);
			assert.equal(modStore.modsDirectory, MODS_DIR);
			assert.equal(modStore.files.size, 0);
		});

		it("should load a single mod zip file", async function () {
			const modName = "test-mod";
			const modVersion = "1.0.0";
			const filename = `${modName}_${modVersion}.zip`;
			await createMockModZip(path.join(MODS_DIR, filename), modName, modVersion);

			const modStore = await ModStore.fromDirectory(MODS_DIR);
			assert.equal(modStore.files.size, 1);
			const modInfo = modStore.files.get(filename);
			assert(modInfo instanceof ModInfo);
			assert.equal(modInfo.name, modName);
			assert.equal(modInfo.version, modVersion);
			assert.equal(modInfo.filename, filename);
		});

		it("should load multiple mod zip files", async function () {
			const mod1Name = "test-mod-1";
			const mod1Version = "1.0.0";
			const mod1Filename = `${mod1Name}_${mod1Version}.zip`;
			await createMockModZip(path.join(MODS_DIR, mod1Filename), mod1Name, mod1Version);

			const mod2Name = "test-mod-2";
			const mod2Version = "0.1.0";
			const mod2Filename = `${mod2Name}_${mod2Version}.zip`;
			await createMockModZip(path.join(MODS_DIR, mod2Filename), mod2Name, mod2Version);

			const modStore = await ModStore.fromDirectory(MODS_DIR);
			assert.equal(modStore.files.size, 2);
			assert(modStore.files.has(mod1Filename));
			assert(modStore.files.has(mod2Filename));
		});

		it("should ignore non-zip files and directories", async function () {
			// Add a valid mod
			const modName = "real-mod";
			const modVersion = "1.0.0";
			const filename = `${modName}_${modVersion}.zip`;
			await createMockModZip(path.join(MODS_DIR, filename), modName, modVersion);

			// Add other file types and directories
			await fs.writeFile(path.join(MODS_DIR, "some-text.txt"), "hello");
			await fs.ensureDir(path.join(MODS_DIR, "a-directory"));
			await fs.writeFile(path.join(MODS_DIR, "archive.tar.gz"), "not a zip");
			await createMockModZip(path.join(MODS_DIR, "temp_file.tmp.zip"), "temp", "1.0.0"); // Should ignore .tmp.zip

			const modStore = await ModStore.fromDirectory(MODS_DIR);
			assert.equal(modStore.files.size, 1);
			assert(modStore.files.has(filename)); // Should only load the real mod
		});

		it("should invalidate cache if mod file is modified", async function () {
			const modName = "updated-mod";
			const modVersion = "1.0.0";
			const filename = `${modName}_${modVersion}.zip`;
			const modPath = path.join(MODS_DIR, filename);

			// Create mod and load once to generate cache
			await createMockModZip(modPath, modName, modVersion);
			let modStore = await ModStore.fromDirectory(MODS_DIR);
			assert.equal(modStore.files.size, 1);
			assert(await fs.pathExists(CACHE_FILE), "Cache file should exist");

			// Wait and recreate the file to update mtime
			await waitBriefly();
			await createMockModZip(modPath, modName, modVersion, "1.1", ["base >= 1.1", "? updated-dep"]);

			// Load again
			modStore = await ModStore.fromDirectory(MODS_DIR);
			assert.equal(modStore.files.size, 1, "Mod should be reloaded");
			const modInfo = modStore.files.get(filename);
			assert(modInfo instanceof ModInfo);
			assert.equal(modInfo.name, modName);
			assert.equal(modInfo.version, modVersion);
			// Check if the dependency was updated (indicating re-read)
			assert(modInfo.dependencies.includes("? updated-dep"));
		});

		it("should handle corrupted zip files gracefully", async function () {
			// Create a valid mod
			const validModName = "valid-mod";
			const validModVersion = "1.0.0";
			const validFilename = `${validModName}_${validModVersion}.zip`;
			await createMockModZip(path.join(MODS_DIR, validFilename), validModName, validModVersion);

			// Create an invalid zip file (just text)
			const invalidFilename = "invalid-mod_0.0.1.zip";
			await fs.writeFile(path.join(MODS_DIR, invalidFilename), "This is not a zip file");

			const modStore = await ModStore.fromDirectory(MODS_DIR);
			assert.equal(modStore.files.size, 1, "Only the valid mod should be loaded");
			assert(modStore.files.has(validFilename));
			assert(!modStore.files.has(invalidFilename));
		});

		// TODO: Tests for loading mods from directory
		// - Directory with cache file
		// - Cache invalidation
		// - Error handling for corrupt zips
	});

	describe("downloadFile (static)", function () {
		const downloadUrl = "http://example.com/download.zip";
		const downloadPath = path.join(MODS_DIR, "downloaded.zip");
		const fileContent = "mock file content";

		beforeEach(function () {
			// Reset fetch mock specifically for downloadFile tests
			global.fetch = async (url, options) => {
				if (url.toString() === downloadUrl) {
					// Simulate a readable stream for the response body
					const { Readable } = require("stream");
					const stream = Readable.from(fileContent);
					return {
						ok: true,
						status: 200,
						statusText: "OK",
						body: Readable.toWeb(stream), // Convert Node stream to Web ReadableStream
					};
				}
				return {
					ok: false,
					status: 404,
					statusText: "Not Found",
					body: null,
				};
			};
		});

		it("should download content from URL to the specified file path", async function () {
			await ModStore.downloadFile(downloadUrl, downloadPath);
			const writtenContent = await fs.readFile(downloadPath, "utf8");
			assert.equal(writtenContent, fileContent);
		});

		it("should throw if fetch response is not ok", async function () {
			await assert.rejects(
				ModStore.downloadFile("http://example.com/not-found", downloadPath),
				/Failed to fetch .* 404 Not Found/
			);
		});

		it("should throw if fetch response body is missing", async function () {
			global.fetch = async (url, options) => ({
				ok: true,
				status: 200,
				statusText: "OK",
				body: null, // Simulate missing body
			});
			await assert.rejects(
				ModStore.downloadFile(downloadUrl, downloadPath),
				/Response body is missing/
			);
		});

		// Note: Testing the stream piping error handling might require more complex stream mocking.
	});

	describe("downloadMods", function () {
		let modStore;
		const username = "testuser";
		const token = "testtoken";
		const factorioVersion = "1.1";

		// Store original downloadFile and fetch, restore them after tests
		let originalDownloadFile;
		let originalFetch;
		before(function () {
			originalDownloadFile = ModStore.downloadFile;
			originalFetch = global.fetch;
		});

		after(function () {
			ModStore.downloadFile = originalDownloadFile;
			global.fetch = originalFetch;
		});

		beforeEach(async function () {
			// Start with an empty store for download tests
			await fs.emptyDir(MODS_DIR); // Clear any existing files in the temp dir
			modStore = await ModStore.fromDirectory(MODS_DIR); // Initialize using fromDirectory

			// Replace downloadFile with a mock that creates the file directly
			ModStore.downloadFile = async (url, filePath) => {
				const finalFilename = path.basename(filePath).replace(/\.tmp$/, "");
				const match = finalFilename.match(/^(.*)_(\d+\.\d+\.\d+)\.zip$/);
				if (!match) {
					throw new Error(`Mock downloadFile could not parse filename: ${finalFilename}`);
				}
				const [, name, version] = match;
				await createMockModZip(filePath, name, version, factorioVersion);
			};

			// Restore fetch before each test in this suite to avoid pollution
			global.fetch = originalFetch;
		});

		// Helper to create the mock fetch function for the Factorio Mod Portal API
		function createMockPortalApiFetch(modsToDownloadMap, fetchCallsArray = null) {
			return async (url, options) => {
				const urlString = url.toString();
				if (fetchCallsArray) {
					fetchCallsArray.push({ url: urlString, options }); // Track call if array is provided
				}

				if (urlString.startsWith("https://mods.factorio.com/api/mods") && options?.method === "POST") {
					const body = options.body;
					let requestedModNames = [];
					if (body instanceof URLSearchParams) {
						requestedModNames = (body.get("namelist") || "").split(",").filter(Boolean);
					}
					const results = requestedModNames.map(name => {
						const requestedVersion = modsToDownloadMap.get(name);
						if (!requestedVersion) {
							// Use assert or throw for clearer test failure messages
							assert.fail(`[Test Mock ERROR] Mock fetch received unexpected mod name: ${name}`);
						}
						return {
							name: name,
							latest_release: {
								download_url: `/download/${name}/${requestedVersion}`,
								file_name: `${name}_${requestedVersion}.zip`,
								info_json: { factorio_version: factorioVersion },
								version: requestedVersion,
								sha1: `sha1_${name}_${requestedVersion}`,
							},
						};
					});
					return { ok: true, status: 200, json: async () => ({ results: results, pagination: {} }) };
				}
				// Fallback for unhandled fetches in this test
				return { ok: false, status: 404, statusText: `Test Mock 404: ${urlString}` };
			};
		}

		it("should download and add a single mod", async function () {
			const modsToDownload = new Map([["download-mod-1", "1.1.0"]]);

			// Define fetch mock specific to this test
			global.fetch = createMockPortalApiFetch(modsToDownload);

			await modStore.downloadMods(modsToDownload, username, token, factorioVersion);

			assert.equal(modStore.files.size, 1, "Should have 1 mod after download");
			const filename = "download-mod-1_1.1.0.zip";
			assert(modStore.files.has(filename), `Mod ${filename} should be in the store`);
			assert(await fs.pathExists(path.join(MODS_DIR, filename)), `File ${filename} should exist`);
			const modInfo = modStore.files.get(filename);
			assert(modInfo instanceof ModInfo);
			assert.equal(modInfo.name, "download-mod-1");
			assert.equal(modInfo.version, "1.1.0");
		});

		it("should download multiple mods", async function () {
			const modsToDownload = new Map([
				["multi-mod-a", "1.0.0"],
				["multi-mod-b", "2.0.0"],
			]);

			// Define fetch mock specific to this test
			global.fetch = createMockPortalApiFetch(modsToDownload);

			await modStore.downloadMods(modsToDownload, username, token, factorioVersion);

			assert.equal(modStore.files.size, 2);
			assert(modStore.files.has("multi-mod-a_1.0.0.zip"));
			assert(modStore.files.has("multi-mod-b_2.0.0.zip"));
			assert(await fs.pathExists(path.join(MODS_DIR, "multi-mod-a_1.0.0.zip")));
			assert(await fs.pathExists(path.join(MODS_DIR, "multi-mod-b_2.0.0.zip")));
		});

		it("should skip already downloaded mods", async function () {
			const existingModName = "existing-mod";
			const existingModVersion = "1.0.0";
			const existingFilename = `${existingModName}_${existingModVersion}.zip`;
			await createMockModZip(path.join(MODS_DIR, existingFilename), existingModName, existingModVersion);
			modStore = await ModStore.fromDirectory(MODS_DIR);
			assert.equal(modStore.files.size, 1);

			const modsToDownload = new Map([
				[existingModName, existingModVersion], // Already present
				["new-mod", "0.5.0"], // New mod
			]);

			let fetchCalls = [];
			// Define fetch mock specific to this test (wraps original for tracking)
			global.fetch = createMockPortalApiFetch(modsToDownload, fetchCalls);

			await modStore.downloadMods(modsToDownload, username, token, factorioVersion);

			assert.equal(modStore.files.size, 2, "Should have 2 mods total");
			assert(modStore.files.has(existingFilename));
			assert(modStore.files.has("new-mod_0.5.0.zip"));
			assert(await fs.pathExists(path.join(MODS_DIR, "new-mod_0.5.0.zip")));

			const postCall = fetchCalls.find(call => call.options?.method === "POST");
			assert(postCall, "POST call to API should have happened");
			const requestedMods = (postCall.options.body.get("namelist") || "").split(",");
			assert.deepEqual(requestedMods, ["new-mod"], "Only new-mod should be in the namelist");
		});

		it("should skip built-in mods", async function () {
			const modsToDownload = new Map([
				["base", "1.1.0"], // Built-in
				["core", "1.1.0"], // Built-in
				["another-new-mod", "1.0.0"], // Not built-in
			]);

			let fetchCalls = [];
			// Define fetch mock specific to this test
			global.fetch = createMockPortalApiFetch(modsToDownload, fetchCalls);

			await modStore.downloadMods(modsToDownload, username, token, factorioVersion);

			assert.equal(modStore.files.size, 1, "Only non-builtin mod should be downloaded");
			assert(modStore.files.has("another-new-mod_1.0.0.zip"));

			const postCall = fetchCalls.find(call => call.options?.method === "POST");
			assert(postCall, "POST call to API should have happened");
			const requestedMods = (postCall.options.body.get("namelist") || "").split(",");
			assert.deepEqual(requestedMods, ["another-new-mod"], "Only non-builtin mod should be in the namelist");
		});

		it("should handle Factorio version formatting (e.g., 1.1.100 -> 1.1)", async function () {
			const modsToDownload = new Map([["version-test-mod", "1.0.0"]]);
			let capturedApiUrl = null;

			// Define fetch mock specific to this test
			const testFetch = async (url, options) => {
				const urlString = url.toString();
				if (urlString.startsWith("https://mods.factorio.com/api/mods") && options?.method === "POST") {
					capturedApiUrl = urlString; // Capture URL
					const body = options.body;
					let requestedModNames = [];
					if (body instanceof URLSearchParams) {
						requestedModNames = (body.get("namelist") || "").split(",").filter(Boolean);
					}
					const results = requestedModNames.map(name => {
						const requestedVersion = modsToDownload.get(name);
						if (!requestedVersion) {
							throw new Error(`[Test Mock ERROR] No version for ${name}`);
						}
						return {
							name: name,
							latest_release: {
								download_url: `/download/${name}/${requestedVersion}`,
								file_name: `${name}_${requestedVersion}.zip`,
								info_json: { factorio_version: factorioVersion },
								version: requestedVersion,
								sha1: `sha1_${name}_${requestedVersion}`,
							},
						};
					});
					return { ok: true, status: 200, json: async () => ({ results: results, pagination: {} }) };
				}
				return { ok: false, status: 404, statusText: `Test Mock 404: ${urlString}` };
			};
			global.fetch = testFetch;

			await modStore.downloadMods(modsToDownload, username, token, "1.1.100"); // Use full version

			assert(capturedApiUrl, "Fetch to API mods should have been called");
			const apiUrlParams = new URL(capturedApiUrl).searchParams;
			assert.equal(apiUrlParams.get("version"), "1.1", "Factorio version should be truncated in API call");
		});

		it("should handle API error during mod info fetch", async function () {
			const modsToDownload = new Map([["api-error-mod", "1.0.0"]]);

			// Define fetch mock specific to this test (simulates API error)
			global.fetch = async (url, options) => {
				if (url.toString().startsWith("https://mods.factorio.com/api/mods") && options?.method === "POST") {
					return {
						ok: false,
						status: 503,
						statusText: "Service Unavailable",
					};
				}
				// This fallback shouldn't be reached in this test
				return { ok: false, status: 404, statusText: `Test Mock 404: ${url.toString()}` };
			};

			await assert.rejects(
				modStore.downloadMods(modsToDownload, username, token, factorioVersion),
				/Fetch: https:\/\/mods\.factorio\.com\/api\/mods.* returned 503 Service Unavailable/
			);
			assert.equal(modStore.files.size, 0, "No mods should be added on API error");
		});

		it("should handle download error for a specific mod", async function () {
			const modsToDownload = new Map([
				["good-mod", "1.0.0"], // This one should succeed
				["bad-download-mod", "1.0.0"], // This one will fail
				["another-good-mod", "1.0.0"], // This one should also succeed
			]);

			// Mock ModStore.downloadFile to fail for the specific mod
			const originalDSF = ModStore.downloadFile;
			ModStore.downloadFile = async (url, filePath) => {
				if (filePath.includes("bad-download-mod")) {
					throw new Error("Simulated download failure");
				} else {
					// Use original mock logic for successful downloads
					const finalFilename = path.basename(filePath).replace(/\.tmp$/, "");
					const match = finalFilename.match(/^(.*)_(\d+\.\d+\.\d+)\.zip$/);
					if (!match) {
						throw new Error(`Mock downloadFile could not parse filename: ${finalFilename}`);
					}
					const [, name, version] = match;
					await createMockModZip(filePath, name, version, factorioVersion);
				}
			};

			// Define fetch mock specific to this test (for the API call)
			global.fetch = async (url, options) => {
				const urlString = url.toString();
				if (urlString.startsWith("https://mods.factorio.com/api/mods") && options?.method === "POST") {
					const body = options.body;
					let requestedModNames = [];
					if (body instanceof URLSearchParams) {
						requestedModNames = (body.get("namelist") || "").split(",").filter(Boolean);
					}
					const results = requestedModNames.map(name => {
						const requestedVersion = modsToDownload.get(name);
						if (!requestedVersion) {
							throw new Error(`[Test Mock ERROR] No version for ${name}`);
						}
						return {
							name: name,
							latest_release: {
								download_url: `/download/${name}/${requestedVersion}`,
								file_name: `${name}_${requestedVersion}.zip`,
								info_json: { factorio_version: factorioVersion },
								version: requestedVersion,
								sha1: `sha1_${name}_${requestedVersion}`,
							},
						};
					});
					return { ok: true, status: 200, json: async () => ({ results: results, pagination: {} }) };
				}
				return { ok: false, status: 404, statusText: `Test Mock 404: ${urlString}` };
			};

			await modStore.downloadMods(modsToDownload, username, token, factorioVersion);
			ModStore.downloadFile = originalDSF; // Restore downloadFile mock

			assert.equal(modStore.files.size, 2, "Only successfully downloaded mods should be added");
			assert(modStore.files.has("good-mod_1.0.0.zip"));
			assert(modStore.files.has("another-good-mod_1.0.0.zip"));
			assert(!modStore.files.has("bad-download-mod_1.0.0.zip"));
		});

		it("should download mods in chunks", async function () {
			const modsToDownload = new Map([
				["chunk-mod-1", "1.0.0"],
				["chunk-mod-2", "1.0.0"],
				["chunk-mod-3", "1.0.0"],
				["chunk-mod-4", "1.0.0"],
			]);
			let postCalls = 0;

			// Define fetch mock specific to this test
			const testFetch = async (url, options) => {
				const urlString = url.toString();
				if (urlString.startsWith("https://mods.factorio.com/api/mods") && options?.method === "POST") {
					postCalls += 1; // Track POST calls
					const body = options.body;
					let requestedModNames = [];
					if (body instanceof URLSearchParams) {
						requestedModNames = (body.get("namelist") || "").split(",").filter(Boolean);
					}
					const results = requestedModNames.map(name => {
						const requestedVersion = modsToDownload.get(name);
						if (!requestedVersion) {
							throw new Error(`[Test Mock ERROR] No version for ${name}`);
						}
						return {
							name: name,
							latest_release: {
								download_url: `/download/${name}/${requestedVersion}`,
								file_name: `${name}_${requestedVersion}.zip`,
								info_json: { factorio_version: factorioVersion },
								version: requestedVersion,
								sha1: `sha1_${name}_${requestedVersion}`,
							},
						};
					});
					return { ok: true, status: 200, json: async () => ({ results: results, pagination: {} }) };
				}
				return { ok: false, status: 404, statusText: `Test Mock 404: ${urlString}` };
			};
			global.fetch = testFetch;

			await modStore.downloadMods(modsToDownload, username, token, factorioVersion);

			// Assuming chunkSize is 500, 4 mods should be 1 chunk/POST call
			assert.equal(postCalls, 1, "Should make 1 POST call for 4 mods");
			assert.equal(modStore.files.size, modsToDownload.size, "All chunked mods should be downloaded");
			assert(modStore.files.has("chunk-mod-1_1.0.0.zip"));
			assert(modStore.files.has("chunk-mod-4_1.0.0.zip"));
		});
	});

	describe("fetchAllModsFromPortal (static)", function () {
		const factorioVersion = "1.1";
		const apiBaseUrl = "https://mods.factorio.com/api/mods";
		const pageSize = 2; // Small page size for mock tests

		// Keep track of the original fetch for the live test
		let originalFetch;
		before(function() {
			originalFetch = global.fetch;
		});
		after(function() {
			global.fetch = originalFetch; // Restore original fetch after this suite
		});

		// Simplified mock mod data for mock tests
		const mockPortalMods = [
			{ name: "pa", title: "A", owner: "oA", latest_release: {
				version: "1.0.0", sha1: "sha1pa", info_json: { factorio_version: factorioVersion },
			} },
			{ name: "pb", title: "B", owner: "oB", latest_release: {
				version: "2.0.0", sha1: "sha1pb", info_json: { factorio_version: factorioVersion },
			} },
			{ name: "pc", title: "C", owner: "oC", latest_release: {
				version: "3.0.0", sha1: "sha1pc", info_json: { factorio_version: factorioVersion },
			} },
			{ name: "pd", title: "D", owner: "oD", latest_release: {
				version: "4.0.0", sha1: "sha1pd", info_json: { factorio_version: factorioVersion },
			} },
		];
		const totalMods = mockPortalMods.length;
		const totalPages = Math.ceil(totalMods / pageSize);

		beforeEach(function () {
			// Set up mock fetch for most tests in this suite
			global.fetch = async (url, options) => {
				const urlObj = new URL(url);
				if (urlObj.origin + urlObj.pathname === apiBaseUrl && !options?.method /* GET */) {
					const params = urlObj.searchParams;
					const page = parseInt(params.get("page") || "1", 10);
					const reqPageSize = parseInt(params.get("page_size") || String(pageSize), 10);
					const reqVersion = params.get("version");
					const hideDeprecated = params.get("hide_deprecated") === "true";

					// Helper to create the mock response
					const createMockResponse = (results, pagination) => {
						const jsonFunc = async () => ({ results, pagination });
						return {
							ok: true,
							status: 200,
							statusText: "OK",
							headers: {
								entries: () => [["content-type", "application/json"]],
								get: (headerName) => (
									headerName.toLowerCase() === "content-type" ? "application/json" : null
								),
							},
							json: jsonFunc,
						};
					};

					// Use larger page size for mock fetch logic if not specified
					const effectivePageSize = reqPageSize || 50;

					if (reqVersion !== factorioVersion) {
						return { ok: false, status: 400, statusText: "Bad Request - Incorrect Version" };
					}

					const mockTotalPages = Math.ceil(totalMods / effectivePageSize);
					const pagination = {
						page,
						page_count: mockTotalPages,
						page_size: effectivePageSize,
						count: totalMods,
					};

					if (page > mockTotalPages) {
						return createMockResponse([], pagination);
					}

					const startIndex = (page - 1) * effectivePageSize;
					const endIndex = startIndex + effectivePageSize;
					const pageResults = mockPortalMods.slice(startIndex, endIndex);

					return createMockResponse(pageResults, pagination);
				}

				// Fallback for unhandled fetch in mock tests
				return {
					ok: false,
					status: 404,
					statusText: `Not Found - Mock fetch unhandled for ${url}`,
					body: null,
				};
			};
		});

		it("should fetch all mods by handling pagination (using mock)", async function () {
			// This test uses the mock fetch setup in beforeEach
			const allMods = await ModStore.fetchAllModsFromPortal(factorioVersion);
			assert.equal(allMods.length, totalMods, "Should fetch all mock mods");
			const fetchedNames = allMods.map(m => m.name).sort();
			const expectedNames = mockPortalMods.map(m => m.name).sort();
			assert.deepEqual(fetchedNames, expectedNames, "Fetched names mismatch");
		});

		it("should pass hide_deprecated parameter correctly (using mock)", async function () {
			// This test uses the mock fetch setup in beforeEach
			let capturedUrl = null;
			const currentFetch = global.fetch; // Capture the mock fetch
			global.fetch = async (url, options) => {
				capturedUrl = url.toString();
				return currentFetch(url, options);
			};

			await ModStore.fetchAllModsFromPortal(factorioVersion, true); // hide_deprecated = true
			assert(capturedUrl.includes("hide_deprecated=true"), "URL should contain hide_deprecated=true");

			await ModStore.fetchAllModsFromPortal(factorioVersion, false); // hide_deprecated = false
			assert(capturedUrl.includes("hide_deprecated=false"), "URL should contain hide_deprecated=false");
		});

		it("should handle API errors during pagination (using mock)", async function () {
			// This test uses the mock fetch setup in beforeEach
			const errorPage = 2;
			const currentFetch = global.fetch; // Capture the mock fetch
			global.fetch = async (url, options) => {
				const urlObj = new URL(url);
				const page = parseInt(urlObj.searchParams.get("page") || "1", 10);

				// Modify pagination for this test to ensure page 2 is requested
				if (page === errorPage) {
					return {
						ok: false,
						status: 500,
						statusText: "Internal Server Error",
						text: async () => "API Error",
					};
				}

				// For other pages (like page 1), return the standard mock response,
				// but ensure pagination suggests more pages exist.
				const response = await currentFetch(url, options);
				if (response.ok && page === 1) {
					const json = await response.json();
					json.pagination.page_count = Math.max(json.pagination.page_count, errorPage);
					return { ...response, json: async () => json };
				}
				return response; // Return other pages/errors as is
			};

			await assert.rejects(
				ModStore.fetchAllModsFromPortal(factorioVersion),
				/Mod portal fetch page 2 failed: 500 Internal Server Error - API Error/
			);
		});

		it("should handle empty results from the portal (using mock)", async function () {
			// Override fetch to return empty results on the first page
			global.fetch = async (url, options) => {
				const urlObj = new URL(url);
				if (urlObj.origin + urlObj.pathname === apiBaseUrl && !options?.method) {
					const pagination = { page: 1, page_count: 0, page_size: 50, count: 0 };
					return { ok: true, status: 200, json: async () => ({ results: [], pagination }) };
				}
				return {
					ok: false, status: 404, statusText: `Mock fetch unhandled for ${url}`,
				};
			};

			const allMods = await ModStore.fetchAllModsFromPortal(factorioVersion);
			assert.equal(allMods.length, 0, "Should return an empty array for no mods");
		});

		// Note: This test connects to the actual Factorio Mod Portal API.
		// It requires network access and may take a while to run.
		// It might also break if the API changes or is unavailable.
		it("should fetch all mods from the LIVE portal API and check structure/count", async function () {
			this.timeout(60000); // Increase timeout to 60 seconds for live API call
			// Ensure we are using the true native fetch we captured earlier
			global.fetch = nativeFetch;
			assert.strictEqual(
				global.fetch,
				nativeFetch, // Check against the truly native fetch
				"global.fetch was not restored to the original native fetch"
			);

			const liveFactorioVersion = "1.1"; // Use a common, stable version

			let allMods = [];
			try {
				allMods = await ModStore.fetchAllModsFromPortal(liveFactorioVersion, true); // hide deprecated
			} catch (err) {
				// Provide more context if the API call fails
				const cause = err.cause ? ` - Cause: ${err.cause}` : "";
				const status = err.response ? ` - Status: ${err.response.status}` : "";
				let detailedMessage = `Live API call failed: ${err.message} (Type: ${err.constructor.name})`;
				if (err.cause) {
					detailedMessage += ` - Cause: ${err.cause}`;
				}
				// Try to get response info safely
				const response = err.response || (typeof err.status === "number" ? err : null);
				if (response) {
					detailedMessage += ` - Status: ${response.status} ${response.statusText || ""}`;
					if (typeof response.text === "function") {
						try {
							// Attempt to get text body for more context
							const textBody = await response.text();
							detailedMessage += ` - Body Preview: ${textBody.substring(0, 200)}...`;
						} catch (textErr) {
							detailedMessage += ` - (Failed to read response body as text: ${textErr.message})`;
						}
					}
				} else {
					// Log the whole error object if it's not a response-related error
					try {
						detailedMessage += ` - Error Details: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`;
					} catch (stringifyErr) {
						detailedMessage += " - (Could not stringify error object)";
					}
				}
				assert.fail(detailedMessage);
			}

			assert(Array.isArray(allMods), "Result should be an array");
			// Check for a realistically large number of mods. Adjust if needed.
			assert(
				allMods.length > 3000,
				`Expected > 3000 mods for Factorio ${liveFactorioVersion}, but got ${allMods.length}`
			);

			// Check the structure of the first mod (assuming the list is not empty)
			if (allMods.length > 0) {
				const firstMod = allMods[0];
				assert.equal(typeof firstMod.name, "string", "First mod should have a string name");
				assert.equal(typeof firstMod.title, "string", "First mod should have a string title");
				assert.equal(typeof firstMod.owner, "string", "First mod should have a string owner");
				assert.ok(firstMod.latest_release, "First mod should have latest_release info");
				assert.equal(
					typeof firstMod.latest_release.version,
					"string",
					"latest_release version should be string" // eslint-disable-line max-len
				);
				assert.equal(
					typeof firstMod.latest_release.sha1,
					"string",
					"latest_release should have a sha1 string" // eslint-disable-line max-len
				);
				assert.ok(firstMod.latest_release.info_json, "latest_release should have info_json");
				assert.equal(
					typeof firstMod.latest_release.info_json.factorio_version,
					"string",
					"info_json should have factorio_version string" // eslint-disable-line max-len
				);
				// Check for an expected field from the user example
				assert.equal(
					typeof firstMod.downloads_count,
					"number",
					"First mod should have downloads_count number" // eslint-disable-line max-len
				);
			} else {
				// This should not happen for v1.1 but handles edge cases
				// eslint-disable-next-line no-console
				console.warn("Warning: Live Mod Portal API returned 0 mods.");
			}
		});
	});

	// === Instance Methods ===
	describe("Instance Methods", function () {
		let modStore;
		let testMod1Name = "test-mod-1";
		let testMod1Version = "1.0.0";
		let testMod1Filename = `${testMod1Name}_${testMod1Version}.zip`;
		let testMod1Path = path.join(MODS_DIR, testMod1Filename);

		beforeEach(async function () {
			// Create a fresh store and a default mod for instance tests
			await createMockModZip(testMod1Path, testMod1Name, testMod1Version);
			modStore = await ModStore.fromDirectory(MODS_DIR);
			assert.equal(modStore.files.size, 1, "Test setup failed: ModStore should have 1 mod initially");
		});

		describe("getMod", function () {
			it("should return ModInfo for an existing mod", function () {
				const modInfo = modStore.getMod(testMod1Name, testMod1Version);
				assert(modInfo instanceof ModInfo);
				assert.equal(modInfo.name, testMod1Name);
				assert.equal(modInfo.version, testMod1Version);
			});

			it("should return undefined for a non-existent mod name", function () {
				const modInfo = modStore.getMod("non-existent-mod", testMod1Version);
				assert.equal(modInfo, undefined);
			});

			it("should return undefined for a non-existent mod version", function () {
				const modInfo = modStore.getMod(testMod1Name, "99.9.9");
				assert.equal(modInfo, undefined);
			});

			it("should return undefined if sha1 does not match", function () {
				const modInfo = modStore.getMod(testMod1Name, testMod1Version, "mismatched-sha1");
				assert.equal(modInfo, undefined);
			});

			it("should return ModInfo if sha1 matches", function () {
				const existingMod = modStore.files.get(testMod1Filename);
				assert(existingMod, "Test setup error: existing mod not found"); // Ensure mod exists
				const modInfo = modStore.getMod(testMod1Name, testMod1Version, existingMod.sha1);
				assert(modInfo instanceof ModInfo);
				assert.equal(modInfo.name, testMod1Name);
				assert.equal(modInfo.sha1, existingMod.sha1);
			});
		});

		describe("loadFile (instance)", function () {
			let testMod2Name = "test-mod-2";
			let testMod2Version = "0.1.0";
			let testMod2Filename = `${testMod2Name}_${testMod2Version}.zip`;
			let testMod2Path = path.join(MODS_DIR, testMod2Filename);

			it("should load an existing file and add it to the store", async function () {
				await createMockModZip(testMod2Path, testMod2Name, testMod2Version);
				assert(!modStore.files.has(testMod2Filename), "Mod should not be present before loadFile");

				const modInfo = await modStore.loadFile(testMod2Filename);
				assert(modInfo instanceof ModInfo);
				assert.equal(modInfo.name, testMod2Name);
				assert.equal(modInfo.version, testMod2Version);
				assert(modStore.files.has(testMod2Filename), "Mod should be present after loadFile");
				assert.equal(modStore.files.get(testMod2Filename), modInfo);
			});

			it("should emit 'change' event when loading a file", async function () {
				await createMockModZip(testMod2Path, testMod2Name, testMod2Version);
				let changeEventFired = false;
				let eventModInfo = null;
				modStore.on("change", (mod) => {
					changeEventFired = true;
					eventModInfo = mod;
				});

				const loadedModInfo = await modStore.loadFile(testMod2Filename);
				assert(changeEventFired, "Change event should have fired");
				assert.equal(eventModInfo, loadedModInfo, "Event should pass the loaded ModInfo");
			});

			it("should throw when loading a non-existent file", async function () {
				await assert.rejects(
					modStore.loadFile("non-existent.zip"),
					/ENOENT: no such file or directory/ // Check for fs error
				);
			});

			it("should throw if filename does not match info.json", async function () {
				const wrongFilename = `wrong-name_${testMod2Version}.zip`;
				await createMockModZip(path.join(MODS_DIR, wrongFilename), testMod2Name, testMod2Version);
				await assert.rejects(
					modStore.loadFile(wrongFilename),
					/filename does not match the expected name/ // Check for ModStore.loadFile's specific error
				);
			});
		});

		describe("deleteFile", function () {
			it("should delete an existing file from store and filesystem", async function () {
				assert(modStore.files.has(testMod1Filename), "Mod should exist before deletion");
				assert(await fs.pathExists(testMod1Path), "Mod file should exist before deletion");

				await modStore.deleteFile(testMod1Filename);

				assert(!modStore.files.has(testMod1Filename), "Mod should not exist in store after deletion");
				assert(!(await fs.pathExists(testMod1Path)), "Mod file should not exist after deletion");
			});

			it("should emit 'change' event with isDeleted flag when deleting", async function () {
				const originalModInfo = modStore.files.get(testMod1Filename);
				let changeEventFired = false;
				let eventModInfo = null;
				modStore.on("change", (mod) => {
					changeEventFired = true;
					eventModInfo = mod;
				});

				await modStore.deleteFile(testMod1Filename);

				assert(changeEventFired, "Change event should have fired");
				assert.equal(eventModInfo, originalModInfo, "Event should pass the original ModInfo object");
				assert(eventModInfo.isDeleted, "Event ModInfo should have isDeleted flag set");
			});

			it("should throw when deleting a non-existent file", async function () {
				await assert.rejects(
					modStore.deleteFile("non-existent.zip"),
					/Mod non-existent.zip does not exist/
				);
			});
		});

		describe("addMod", function () {
			it("should add a ModInfo object to the files map", function () {
				const modInfo = new ModInfo({
					name: "added-mod", version: "0.5.0", factorio_version: "1.1", title: "T", author: "A",
					dependencies: [], description: "D", sha1: "dummy", size: 100, mtimeMs: Date.now(),
				});
				assert(!modStore.files.has(modInfo.filename), "Mod should not be present before addMod");
				modStore.addMod(modInfo);
				assert(modStore.files.has(modInfo.filename), "Mod should be present after addMod");
				assert.equal(modStore.files.get(modInfo.filename), modInfo);
			});

			it("should emit 'change' event when adding a mod", function () {
				const modInfo = new ModInfo({
					name: "added-mod-event", version: "0.5.1", factorio_version: "1.1", title: "T", author: "A",
					dependencies: [], description: "D", sha1: "dummy", size: 100, mtimeMs: Date.now(),
				});
				let changeEventFired = false;
				let eventModInfo = null;
				modStore.on("change", (mod) => {
					changeEventFired = true;
					eventModInfo = mod;
				});

				modStore.addMod(modInfo);
				assert(changeEventFired, "Change event should have fired");
				assert.equal(eventModInfo, modInfo, "Event should pass the added ModInfo");
			});
		});
	});
});
