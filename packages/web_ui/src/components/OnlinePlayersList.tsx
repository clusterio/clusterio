import React, { useState } from "react";
import { Collapse } from "antd";

import { useUsers } from "../model/user";
import UsersTable from "./UsersTable";

type OnlinePlayersListProps = {
	instanceId: number;
};

export default function OnlinePlayersList({ instanceId }: OnlinePlayersListProps) {
	const [users] = useUsers();
	// undefined until the user toggles the panel, then their choice sticks.
	const [open, setOpen] = useState<boolean>();

	const onlineCount = [...users.values()].filter(user => user.instances?.has(instanceId)).length;
	const expanded = open ?? onlineCount > 0;

	return <Collapse
		size="small"
		style={{ marginTop: 16 }}
		activeKey={expanded ? ["players"] : []}
		onChange={keys => setOpen(keys.length > 0)}
		items={[{
			key: "players",
			label: `Online Players (${onlineCount})`,
			children: <UsersTable instanceId={instanceId} onlyOnline size="small" pagination={{
				defaultPageSize: 10,
				showSizeChanger: true,
				pageSizeOptions: ["10", "20", "50", "100", "200"],
				showTotal: (total: number) => `${total} Users`,
			}} />,
		}]}
	/>;
}
