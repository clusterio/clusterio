"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const typescript_collections_1 = require("typescript-collections");
const Point_1 = require("./Point");
const TeleportZone_1 = require("./TeleportZone");
const TeleportZoneDirection_1 = require("./TeleportZoneDirection");
class Grid {
    constructor() {
        this._nodes = new typescript_collections_1.Dictionary();
        this._minX = 0;
        this._minY = 0;
        this._maxX = 0;
        this._maxY = 0;
    }
    GetNodes() {
        return this._nodes.values();
    }
    /**
     * Adds a node to the grid
     * @param topLeftCoordinate The top left x,y coordinate of the node
     * @param nodeInstance
     */
    AddNodeToGrid(nodeInstance) {
        let topLeftCoordinate = nodeInstance.TopLeftCoordinate;
        let pointsToSave = new Array();
        // check all points that make up nodeInstance for existing nodes
        for (let x = topLeftCoordinate.X; x < topLeftCoordinate.X + nodeInstance.Width; x++) {
            for (let y = topLeftCoordinate.Y; y < topLeftCoordinate.Y + nodeInstance.Height; y++) {
                let currentPoint = new Point_1.Point(x, y);
                let existingNode = this._nodes.getValue(currentPoint);
                if (existingNode != null) {
                    throw new Error("Cannot add node to grid - collision detected with node '" + existingNode.Name + "'");
                }
                pointsToSave.push(currentPoint);
            }
        }
        // no existing nodes found to assign node to these points
        for (let i = 0; i < pointsToSave.length; i++) {
            this._nodes.setValue(pointsToSave[i], nodeInstance);
        }
        //TODO: Refactor
        //#region Set up teleport zones
        // check surrounding points for nodes
        // check north points
        let y = topLeftCoordinate.Y - 1;
        for (let x = topLeftCoordinate.X; x < topLeftCoordinate.X + nodeInstance.Width; x++) {
            let currentPoint = new Point_1.Point(x, y);
            let existingNode = this._nodes.getValue(currentPoint);
            // found a node - set up teleport zone
            if (existingNode != null) {
                // Create/Update teleport node in existing node to new node
                let teleportZoneFromExistingToNew = existingNode.TeleportZones.getValue(nodeInstance.Key);
                if (teleportZoneFromExistingToNew == null) {
                    teleportZoneFromExistingToNew = new TeleportZone_1.TeleportZone(existingNode, TeleportZoneDirection_1.TeleportZoneDirection.South, currentPoint, currentPoint, existingNode.TeleportZones.size(), nodeInstance);
                    existingNode.TeleportZones.setValue(nodeInstance.Key, teleportZoneFromExistingToNew);
                }
                else {
                    teleportZoneFromExistingToNew.BottomRightCoordinate = currentPoint;
                }
                // Create/Update teleport node in new node to existing node
                let teleportZoneFromNewToExisting = nodeInstance.TeleportZones.getValue(existingNode.Key);
                let pointInNewNode = new Point_1.Point(currentPoint.X, currentPoint.Y + 1);
                if (teleportZoneFromNewToExisting == null) {
                    teleportZoneFromNewToExisting = new TeleportZone_1.TeleportZone(nodeInstance, TeleportZoneDirection_1.TeleportZoneDirection.North, pointInNewNode, pointInNewNode, nodeInstance.TeleportZones.size(), existingNode);
                    nodeInstance.TeleportZones.setValue(existingNode.Key, teleportZoneFromNewToExisting);
                }
                else {
                    teleportZoneFromNewToExisting.BottomRightCoordinate = currentPoint;
                }
            }
        }
        // check south points
        y = topLeftCoordinate.Y + nodeInstance.Height + 1;
        for (let x = topLeftCoordinate.X; x < topLeftCoordinate.X + nodeInstance.Width; x++) {
            let currentPoint = new Point_1.Point(x, y);
            let existingNode = this._nodes.getValue(currentPoint);
            // found a node - set up teleport zone
            if (existingNode != null) {
                // Create/Update teleport node in existing node to new node
                let teleportZoneFromExistingToNew = existingNode.TeleportZones.getValue(nodeInstance.Key);
                if (teleportZoneFromExistingToNew == null) {
                    teleportZoneFromExistingToNew = new TeleportZone_1.TeleportZone(existingNode, TeleportZoneDirection_1.TeleportZoneDirection.North, currentPoint, currentPoint, existingNode.TeleportZones.size(), nodeInstance);
                    existingNode.TeleportZones.setValue(nodeInstance.Key, teleportZoneFromExistingToNew);
                }
                else {
                    teleportZoneFromExistingToNew.BottomRightCoordinate = currentPoint;
                }
                // Create/Update teleport node in new node to existing node
                let teleportZoneFromNewToExisting = nodeInstance.TeleportZones.getValue(existingNode.Key);
                let pointInNewNode = new Point_1.Point(currentPoint.X, currentPoint.Y - 1);
                if (teleportZoneFromNewToExisting == null) {
                    teleportZoneFromNewToExisting = new TeleportZone_1.TeleportZone(nodeInstance, TeleportZoneDirection_1.TeleportZoneDirection.South, pointInNewNode, pointInNewNode, nodeInstance.TeleportZones.size(), existingNode);
                    nodeInstance.TeleportZones.setValue(existingNode.Key, teleportZoneFromNewToExisting);
                }
                else {
                    teleportZoneFromNewToExisting.BottomRightCoordinate = currentPoint;
                }
            }
        }
        // check west points
        let x = topLeftCoordinate.X - 1;
        for (let y = topLeftCoordinate.Y; y < topLeftCoordinate.Y + nodeInstance.Height; y++) {
            let currentPoint = new Point_1.Point(x, y);
            let existingNode = this._nodes.getValue(currentPoint);
            // found a node - set up teleport zone
            if (existingNode != null) {
                // Create/Update teleport node in existing node to new node
                let teleportZoneFromExistingToNew = existingNode.TeleportZones.getValue(nodeInstance.Key);
                if (teleportZoneFromExistingToNew == null) {
                    teleportZoneFromExistingToNew = new TeleportZone_1.TeleportZone(existingNode, TeleportZoneDirection_1.TeleportZoneDirection.East, currentPoint, currentPoint, existingNode.TeleportZones.size(), nodeInstance);
                    existingNode.TeleportZones.setValue(nodeInstance.Key, teleportZoneFromExistingToNew);
                }
                else {
                    teleportZoneFromExistingToNew.BottomRightCoordinate = currentPoint;
                }
                // Create/Update teleport node in new node to existing node
                let teleportZoneFromNewToExisting = nodeInstance.TeleportZones.getValue(existingNode.Key);
                let pointInNewNode = new Point_1.Point(currentPoint.X + 1, currentPoint.Y);
                if (teleportZoneFromNewToExisting == null) {
                    teleportZoneFromNewToExisting = new TeleportZone_1.TeleportZone(nodeInstance, TeleportZoneDirection_1.TeleportZoneDirection.West, pointInNewNode, pointInNewNode, nodeInstance.TeleportZones.size(), existingNode);
                    nodeInstance.TeleportZones.setValue(existingNode.Key, teleportZoneFromNewToExisting);
                }
                else {
                    teleportZoneFromNewToExisting.BottomRightCoordinate = currentPoint;
                }
            }
        }
        // check east points        
        x = topLeftCoordinate.X + nodeInstance.Width + 1;
        for (let y = topLeftCoordinate.Y; y < topLeftCoordinate.Y + nodeInstance.Height; y++) {
            let currentPoint = new Point_1.Point(x, y);
            let existingNode = this._nodes.getValue(currentPoint);
            // found a node - set up teleport zone
            if (existingNode != null) {
                // Create/Update teleport node in existing node to new node
                let teleportZoneFromExistingToNew = existingNode.TeleportZones.getValue(nodeInstance.Key);
                if (teleportZoneFromExistingToNew == null) {
                    teleportZoneFromExistingToNew = new TeleportZone_1.TeleportZone(existingNode, TeleportZoneDirection_1.TeleportZoneDirection.West, currentPoint, currentPoint, existingNode.TeleportZones.size(), nodeInstance);
                    existingNode.TeleportZones.setValue(nodeInstance.Key, teleportZoneFromExistingToNew);
                }
                else {
                    teleportZoneFromExistingToNew.BottomRightCoordinate = currentPoint;
                }
                // Create/Update teleport node in new node to existing node
                let teleportZoneFromNewToExisting = nodeInstance.TeleportZones.getValue(existingNode.Key);
                let pointInNewNode = new Point_1.Point(currentPoint.X - 1, currentPoint.Y);
                if (teleportZoneFromNewToExisting == null) {
                    teleportZoneFromNewToExisting = new TeleportZone_1.TeleportZone(nodeInstance, TeleportZoneDirection_1.TeleportZoneDirection.East, pointInNewNode, pointInNewNode, nodeInstance.TeleportZones.size(), existingNode);
                    nodeInstance.TeleportZones.setValue(existingNode.Key, teleportZoneFromNewToExisting);
                }
                else {
                    teleportZoneFromNewToExisting.BottomRightCoordinate = currentPoint;
                }
            }
        }
        //#endregion
        this._nodes.setValue(topLeftCoordinate, nodeInstance);
        this._minX = Math.min(this._minX, topLeftCoordinate.X);
        this._minY = Math.min(this._minY, topLeftCoordinate.Y);
        this._maxX = Math.max(this._maxX, topLeftCoordinate.X + nodeInstance.Width);
        this._maxY = Math.max(this._maxY, topLeftCoordinate.Y + nodeInstance.Height);
    }
    get Width() {
        return this._maxX - this._minX;
    }
    get Height() {
        return this._maxY - this._minY;
    }
    get TopLeftCoordinate() {
        return new Point_1.Point(this._minX, this._minY);
    }
    get BottomRightCoordinate() {
        return new Point_1.Point(this._maxX, this._maxY);
    }
}
exports.Grid = Grid;
//# sourceMappingURL=Grid.js.map