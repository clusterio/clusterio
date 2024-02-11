import React from "react";
import { Typography } from "antd";
import {
	LinkProps,
	useHref,
	useLinkClickHandler,
} from "react-router-dom";
import { BaseType } from "antd/es/typography/Base";

const Link = React.forwardRef(
	(
		{
			onClick,
			replace = false,
			state,
			target,
			to,
			type,
			...rest
		}: LinkProps,
		ref
	) => {
		let href = useHref(to);
		let handleClick = useLinkClickHandler(to, {
			replace,
			state,
			target,
		}) as (event: React.MouseEvent<HTMLElement, MouseEvent>) => void;

		return (
			<Typography.Link
				{...rest}
				href={href}
				onClick={(event) => {
					onClick?.(event as React.MouseEvent<HTMLAnchorElement, MouseEvent>);
					if (!event.defaultPrevented) {
						handleClick(event);
					}
				}}
				ref={ref as React.RefObject<HTMLElement> | null}
				target={target}
				type={type as BaseType}
			/>
		);
	}
);
export default Link;
