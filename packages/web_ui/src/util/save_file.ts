
/**
 * Downloads a file to the users PC, should only be used following direct user input.
 * @param name Name of the file to save
 * @param blob Content to save
 */
export function saveFile(name: string, blob: Blob) {
	// This is the most common and best supported method, for full support we should consider using npm:file-saver
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = name;
	a.addEventListener("click", (e) => {
		setTimeout(() => URL.revokeObjectURL(a.href), 30 * 1000);
	});
	a.click();
};

/**
 * Downloads a json file to the users PC
 * @param name Name of the file to save, should include .json
 * @param json The object to save as a formated json string
 */
export function saveJson(name: string, json: object) {
	saveFile(name, new Blob([JSON.stringify(json, null, 2)], { type: "application/json" }));
}
