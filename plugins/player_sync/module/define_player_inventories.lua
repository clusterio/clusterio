local inventories = {
	-- Armor must be before main or the sync will fail when the inventory
	-- bonus slots from the armor are in use.
	armor = defines.inventory.character_armor,
	main = defines.inventory.character_main,
	guns = defines.inventory.character_guns,
	ammo = defines.inventory.character_ammo,
	trash = defines.inventory.character_trash,
}

return inventories
