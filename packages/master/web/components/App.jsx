import React from "react";
import { BrowserRouter } from "react-router-dom";

import basename from "../basename";
import Layout from "../layout";

export default function App() {
    return (
        <BrowserRouter basename={basename}>
            <Layout />
        </BrowserRouter>
    );
}
