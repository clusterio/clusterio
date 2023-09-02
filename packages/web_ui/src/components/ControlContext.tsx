import type { Control } from "../util/websocket";

import React from "react";

export default React.createContext<Control>({} as Control);
