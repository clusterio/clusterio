import React from "react";

import { useUsers } from "../model/user";
import UsersTable from "./UsersTable";

type OnlinePlayersListProps = {
	instanceId: number;
};

export default function OnlinePlayersList({ instanceId }: OnlinePlayersListProps) {
	const [users] = useUsers();

	// Filter users to only show those online on this specific instance
	const onlineUsers = [...users.values()].filter(user => user.instances && user.instances.has(instanceId));

	if (onlineUsers.length === 0) {
		return null;
	}

	return (
		<div style={{ marginTop: 16 }}>
			<h4>Online Players ({onlineUsers.length})</h4>
			<UsersTable instanceId={instanceId} onlyOnline size="small" pagination={{
				defaultPageSize: 10,
				showSizeChanger: true,
				pageSizeOptions: ["10", "20", "50", "100", "200"],
				showTotal: (total: number) => `${total} Users`,
			}} />
		</div>
	);
}
