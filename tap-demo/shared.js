"use strict";
// Single source of truth for the tap trunk demo, so the controller secret, ports, and
// paths are not duplicated across boot/teardown/smoke. A real migration would instead
// factor these out of test/integration/index.js into a hook-free shared module (see
// TEST_REFACTOR_PLAN.md); this demo deliberately keeps a minimal local copy.
const path = require("node:path");

const workDir = path.join("temp", "tap-demo");

module.exports = {
	workDir,
	logPath: path.join(workDir, "controller.log"),
	pidPath: path.join(workDir, "controller.pid"),
	authSecret: "TestSecretDoNotUse",
	httpPort: 8880,
	httpsPort: 4443,
	controllerUrl: "https://localhost:4443/",
};
