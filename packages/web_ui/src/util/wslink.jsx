import * as errors from "@clusterio/lib/errors";
import * as link from "@clusterio/lib/link";

// Note: control is created as in bootstrap.jsx as a global.

let listSlaves = createListFunction("listSlaves");
let listInstances = createListFunction("listInstances");
let listUsers = createListFunction("listUsers", "name");
let listRoles = createListFunction("listRoles");
let listPermissions = createListFunction("listPermissions", "name");

async function startInstance({ instance_id, save = null }) {
	return await link.messages.startInstance.send(control, { instance_id, save });
};
async function stopInstance({ instance_id }) {
	return await link.messages.stopInstance.send(control, { instance_id });
};
async function createInstance(serialized_config) {
	return await link.messages.createInstance.send(control, { serialized_config });
};
async function deleteInstance({ instance_id }) {
	return await link.messages.deleteInstance.send(control, { instance_id });
};
async function assignInstance({ instance_id, slave_id }) {
	return await link.messages.assignInstanceCommand.send(control, {
		instance_id,
		slave_id,
	});
};
async function createSave({ instance_id }) {
	return await link.messages.createSave.send(control, { instance_id });
};
async function getInstanceConfig({ instance_id }) {
	return await link.messages.getInstanceConfig.send(control, { instance_id });
};
async function setInstanceConfigField({ instance_id, field, value }) {
	return await link.messages.setInstanceConfigField.send(control, {
		instance_id,
		field,
		value: typeof value === "object" ? JSON.stringify(value) : value,
	});
};
async function setInstanceConfigProp({ instance_id, field, prop, value }) {
	return await link.messages.setInstanceConfigProp.send(control, {
		instance_id,
		field,
		prop,
		value, // JSON Object
	});
};
async function sendRcon({ instance_id, command }) {
	return await link.messages.sendRcon.send(control, { instance_id, command });
};
async function setInstanceOutputSubscriptions({ instance_id }) {
	return await link.messages.setInstanceOutputSubscriptions.send(control, { instance_ids: [instance_id] });
};

async function createUser({ name }) {
	return await link.messages.createUser.send(control, { name });
};
async function deleteUser({ name }) {
	return await link.messages.deleteUser.send(control, { name });
};
async function setRoles({ name, roles }) {
	return await link.messages.updateUserRoles.send(control, {
		name,
		roles,
	});
};

async function createRole({ name, description, permissions = [] }) {
	return await link.messages.createRole.send(control, { name, description, permissions });
};
async function updateRole({ id, name, description, permissions }) {
	return await link.messages.updateRole.send(control, {
		id, name, description, permissions,
	});
};

export {
	listSlaves,
	listInstances,
	listUsers,
	createUser,
	deleteUser,
	listRoles,
	setRoles,
	createRole,
	updateRole,
	listPermissions,
	startInstance,
	stopInstance,
	createInstance,
	deleteInstance,
	assignInstance,
	createSave,
	getInstanceConfig,
	setInstanceConfigField,
	setInstanceConfigProp,
	sendRcon,
	setInstanceOutputSubscriptions,
};

function createListFunction(name, key) {
	return async () => (
		(await link.messages[name].send(control)).list.map(addKey(key || "id"))
	);
}
function addKey(key) {
	return function (el) {
		return {
			...el,
			key: el[key],
		};
	};
}
