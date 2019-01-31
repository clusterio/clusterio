const fs = require("fs-extra")
const path = require("path")

module.exports = function(app){
	app.get("/api/getPictures", async (req, res) => {
		let pictures = (await fs.readdir(path.join(__dirname, `../../static/pictures`)))
		.filter(path => path.includes(".png"))
		.map(name => ({
			name: name.replace(".png",""),
			path: `/pictures/${name}`
		}))
		
		
		res.send(pictures)
	})
}