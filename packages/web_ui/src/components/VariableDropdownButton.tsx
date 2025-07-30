import React from "react";
import { Button, Dropdown } from "antd";

import { MenuItemType } from "antd/es/menu/interface";
import { DropdownButtonProps } from "antd/es/dropdown";

export type VariableDropdownButtonProps = DropdownButtonProps & {
	actions: (MenuItemType & { onClick?: () => void })[],
};

export default function VariableDropdownButton(props: VariableDropdownButtonProps) {
	const menuActions = [...props.actions];
	const mainAction = menuActions.shift();
	if (!mainAction) {
		return <></>;
	}

	const buttonProps: DropdownButtonProps = {
		...props,
		danger: mainAction.danger,
		onClick: (event) => {
			event.stopPropagation();
			if (mainAction.onClick) {
				mainAction.onClick();
			}
		},
	};

	return menuActions.length === 0
		? <Button {...buttonProps}>
			{mainAction.label}
		</Button>
		: <Dropdown.Button
			{...buttonProps}
			// stopPropagation is needed to prevent propagation to table rows
			menu={{ items: menuActions, onClick: (e: any) => e.domEvent.stopPropagation() }}
			buttonsRender={([left, right]) => [
				left, React.cloneElement(right as any, { onClick: (e: any) => e.stopPropagation() }),
			]}
		>
			{mainAction.label}
		</Dropdown.Button>;
}
