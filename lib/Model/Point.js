"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Point {
    /**
     * Constructs a Point. Will not accept NaNs.
     * @param x A number. Cannot be NaN.
     * @param y A number. Cannot be NaN.
     */
    constructor(x, y) {
        this.toString = () => {
            return "(" + this.X + "," + this.Y + ")";
        };
        if (Number.isNaN(x)) {
            throw new Error("x is NaN. Will not construct Point.");
        }
        if (Number.isNaN(y)) {
            throw new Error("y is NaN. Will not construct Point.");
        }
        this.X = x;
        this.Y = y;
    }
    /**
     * Constructs a Point from a string representation in the format (x,y). Will not accept NaNs.
     * @param vectorAsString A string in the format (x,y). Will not accept NaNs.
     */
    static FromString(vectorAsString) {
        this.CheckChar('(', vectorAsString[0], vectorAsString);
        this.CheckChar(')', vectorAsString[vectorAsString.length - 1], vectorAsString);
        if (vectorAsString.indexOf(',') === -1) {
            throw new Error("vectorAsString is an invalid format. Cannot find ','. fullString: " + vectorAsString);
        }
        let splitStr = vectorAsString.substr(1, vectorAsString.length - 2).split(',');
        if (splitStr.length != 2) {
            throw new Error("vectorAsString is an invalid format. Expecting string in format (x,y). fullString: " + vectorAsString);
        }
        let x = parseInt(splitStr[0]);
        let y = parseInt(splitStr[1]);
        let v = new Point(x, y);
        return v;
    }
    static CheckChar(expectedChar, actualChar, fullString) {
        if (actualChar != expectedChar) {
            throw new Error("vectorAsString is an invalid format. Expecting: '" + expectedChar + "'. Actual: '" + actualChar + "'. fullString: " + fullString);
        }
    }
    equals(obj) {
        return this.X === obj.X && this.Y === obj.Y;
    }
    Add(p) {
        return new Point(this.X + p.X, this.Y + p.Y);
    }
    Subtract(p) {
        return new Point(this.X - p.X, this.Y - p.Y);
    }
}
exports.Point = Point;
//# sourceMappingURL=Point.js.map