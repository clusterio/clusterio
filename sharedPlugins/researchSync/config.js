

module.exports = {
    // Name of package. For display somewhere I guess.
    name: "researchSync",
    version: "1.0.0",
    // Binary entrypoint for plugin. Don't let it crash. Stdout is sent to game as server chat (run /c commands from here for interface)
    // Make sure its cross platform somehow.
    binary: "nodePackage",
    arguments: ["index.js"],
    description: "syncs research across servers",
    // We'll send everything in this file to your stdin. Beware.
    scriptOutputFileSubscription: "researchSync.txt",
    fileReadDelay: 50
}
