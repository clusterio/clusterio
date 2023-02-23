local clusterio_api = require("clusterio_api")

log("Exporting prototypes")
for group, prototypes in pairs(data.raw) do
	for name, prototype in pairs(prototypes) do
		clusterio_api.send_json("prototype_export", prototype)
	end
end
