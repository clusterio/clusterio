/**
An item with a count specified

@typedef {object} itemStack
@property {string} name The name of the item in the stack
@property {(number|string)} count The amount of items in the stack

@example
itemStack = {name:"iron-plate", count:"12"}
itemStack = {name:"copper-plate", count:972}
*/

/**
The  current state of a circuit wire

@typedef {object} circuitFrame
@property {number} time
@property {(number|string)} signal

@example
circuitFrame = {
    time: Date.now(),
	iron-plate: 1203,
	green-signal: 2
}
*/