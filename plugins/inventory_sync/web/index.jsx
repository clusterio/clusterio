import React, { useContext } from "react";
import { Typography } from "antd";

import libPlugin from "@clusterio/lib/plugin";
import { notifyErrorHandler, PageLayout, ControlContext } from "@clusterio/web_ui";
import info from "../info";

import "./index.css";

const { Paragraph } = Typography;

function InventoryPage() {
    // let control = useContext(ControlContext);

    return <PageLayout nav={[{ name: "Inventory sync" }]}>
        <h2>Inventory sync</h2>
    </PageLayout>;
}

export class WebPlugin extends libPlugin.BaseWebPlugin {
    async init() {
        this.pages = [
            { path: "/inventory", sidebarName: "Inventory sync", content: <InventoryPage /> },
        ];
    }

    onMasterConnectionEvent(event) {
        if (event === "connect") {

        }
    }
}
