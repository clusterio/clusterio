"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Point_1 = require("./Point");
const TeleportZoneDirection_1 = require("./TeleportZoneDirection");
const Config = require("./Config");
class TeleportZone {
    constructor(parentNode, direction, topLeftCoordinate, bottomRightCoordinate, index, targetNode) {
        this.TopLeftCoordinate = topLeftCoordinate;
        this.BottomRightCoordinate = bottomRightCoordinate;
        this.ParentNode = parentNode;
        this.Direction = direction;
        this.Index = index;
        this.TargetNode = targetNode;
    }
    get Name() {
        return TeleportZoneDirection_1.TeleportZoneDirection[this.Direction] + " to " + this.TargetNode.Name;
    }
    // public AddRestriction(restrictingTeleportZone: TeleportZone) {
    //     this.Restrictions.push(new TeleportZoneRestriction(this, restrictingTeleportZone));
    // }
    /**
     * Converts this teleport zone into Factorio map co-ordinates
     * @returns [name, topleft.x, topleft.y, width, height, zoneIndex]
     */
    GenerateTeleportZoneInFactorioCoordinates() {
        // get where this zone is relative to the node itself
        let topLeftRelativeCoordinate = this.TopLeftCoordinate.Subtract(this.ParentNode.TopLeftCoordinate);
        // a grid coordinate point is equivalent to a 1x1 node, so bottomright = topleft.
        // add (1,1) to translate from area representation to coordinates representing actual points.
        let bottomRightRelativeCoordinate = this.BottomRightCoordinate
            .Subtract(this.ParentNode.TopLeftCoordinate)
            .Add(new Point_1.Point(1, 1));
        // Factorio map is e.g. (-500,-500) to (500, 500) for a 1000x1000 node.
        // We therefore need to offset our co-ordinates so that (0,0) is the center and not (width/2, height/2)
        let m = Config.GridToFactorioCoordinateSystemMultiplier;
        let factorioTeleportZoneTopLeft = new Point_1.Point(topLeftRelativeCoordinate.X * m - m / 2, topLeftRelativeCoordinate.Y * m - m / 2);
        let factorioTeleportZoneBottomRight = new Point_1.Point(bottomRightRelativeCoordinate.X * m - m / 2, bottomRightRelativeCoordinate.Y * m - m / 2);
        let zoneWidth = factorioTeleportZoneBottomRight.X - factorioTeleportZoneTopLeft.X;
        let zoneHeight = factorioTeleportZoneBottomRight.Y - factorioTeleportZoneTopLeft.Y;
        let tl = factorioTeleportZoneTopLeft;
        let br = factorioTeleportZoneBottomRight;
        let zw = Config.TeleportZoneWidth;
        switch (this.Direction) {
            case TeleportZoneDirection_1.TeleportZoneDirection.North:
                return [this.Name, tl.X, tl.Y, zoneWidth, zw, this.Index + 1];
            case TeleportZoneDirection_1.TeleportZoneDirection.West:
                return [this.Name, tl.X, tl.Y, zw, zoneHeight, this.Index + 1];
            case TeleportZoneDirection_1.TeleportZoneDirection.South:
                return [this.Name, tl.X, br.Y - zw, zoneWidth, zw, this.Index + 1];
            case TeleportZoneDirection_1.TeleportZoneDirection.East:
                return [this.Name, br.X - zw, tl.Y, zw, zoneHeight, this.Index + 1];
        }
    }
    /**
     * Generates a zone restriction from this teleport zone to target zone
     * @returns [zoneIndex, targetNodeName, targetZoneName]
     */
    GenerateZoneRestriction() {
        let targetZone = this.TargetNode.TeleportZones.getValue(this.ParentNode.Key);
        return [this.Index + 1, this.TargetNode.Name, targetZone.Name];
    }
}
exports.TeleportZone = TeleportZone;
//# sourceMappingURL=TeleportZone.js.map