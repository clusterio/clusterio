import t from "tap";
import { isDevInstall } from "@clusterio/lib/dist/node/src/dev_install.js";

t.test("isDevInstall()", async t1 => {
	t1.test("is true in a source checkout", async t2 => {
		t2.equal(isDevInstall(), true);
	});
});
