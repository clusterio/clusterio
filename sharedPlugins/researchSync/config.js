

module.exports = {
    // Name of package. For display somewhere I guess.
    name: "researchSync",
    version: "1.0.0",
    arguments: ["index.js"],
    description: "syncs research across servers",
    // We'll send everything in this file to your stdin. Beware.
    scriptOutputFileSubscription: "researchSync.txt",
    fileReadDelay: 50
}
