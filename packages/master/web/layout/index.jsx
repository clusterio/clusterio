import {
    Layout,
    Menu,
    Avatar,
} from "antd";
import 'antd/dist/antd.dark.css';
import {
    UnorderedListOutlined,
    UserOutlined,
    SettingOutlined,
    GoldOutlined,
    FileTextOutlined,
    ScheduleOutlined,
} from "@ant-design/icons";

import { withRouter } from "react-router-dom";
import { BrowserRouter as Router, Route, Link } from "react-router-dom";

import React, { Component } from "react";
import { Helmet } from "react-helmet";
import { Dashboard } from "../pages/dashboard";
import { InstancesTable } from "../pages/instances/instancesTable";
import { SlavesTable } from "../pages/slaves/slavesTable"
import { UsersTable } from "../pages/users/usersTable";
import { RolesTable } from "../pages/roles/rolesTable";
import { PermissionsTable } from "../pages/permissions/permissionsTable";
import { InstanceView } from "../pages/instances/instance";
import { UserView } from "../pages/users/user";
import { RoleView } from "../pages/roles/role";
import { Settings } from "../pages/settings/settings";

const { Content, Footer, Sider } = Layout;
const { SubMenu } = Menu;

class SiteLayout extends Component {

    constructor(props) {
        super(props);
        const { location } = props;

        // this.history = useHistory();

        this.onCollapse = this.onCollapse.bind(this);

        this.state = {
            collapsed: false,
            setcollapsed: false,
            tags: [],
            setTags: [],
            location,
            siteSettings: {},
            factoryModel: []
        };
    }

    onCollapse() {
        this.setState({ collapsed: !this.state.collapsed })
    }

    titleCase(text) {
        return text.substring(0, 1).toUpperCase() + text.substring(1);
    }

    replaceParametersInUrl({ endpoint, params }) {
        let path = endpoint;
        console.log("endpoint", params)
        Object.keys(params).forEach(key => {
            path = path.replace(":" + key, params[key])
        })

        return path;
    }


    render() {
        return (
            <Router>
                <Layout style={{ minHeight: "100vh" }}>
                    <Helmet>
                        <meta charSet="utf-8" />
                        <title>Clusterio 2.0</title>
                        <link
                            href="https://fonts.googleapis.com/css?family=Titillium+Web:200,400&display=swap"
                            rel="stylesheet"
                        ></link>
                    </Helmet>
                    {document.location.search !== "?hideExtras" ? (
                        <Sider
                            collapsible
                            collapsed={this.state.collapsed}
                            onCollapse={this.onCollapse}
                            width={250}
                            breakpoint="lg"
                        >
                            <p></p>
                            <div style={{ width: "100%", textAlign: "center" }}>
                                {" "}
                                {this.state.collapsed ? (
                                    <img
                                        alt=""
                                        src="/smal_logo.png"
                                        style={{ height: "48px", margin: 8 }}
                                    />
                                ) : (
                                        <img
                                            alt=""
                                            src="/logo.png"
                                            style={{ width: "200px", margin: 8 }}
                                        />
                                    )}
                            </div>
                            <p></p>
                            <p></p>

                            <Menu
                                theme="dark"
                                defaultSelectedKeys={[
                                    this.state.location.pathname.split("/")[
                                    this.state.location.pathname.split("/").length - 1
                                    ],
                                ]}
                                defaultOpenKeys={(() => {
                                    let x = this.state.location.pathname.split("/");
                                    x.shift();
                                    return x;
                                })()}
                                mode="inline"
                            >
                                <Menu.Item key="slaves">
                                    <span>Slaves</span>
                                    <Link to="/slaves" />
                                </Menu.Item>
                                <Menu.Item key="instances">
                                    <span>Instances</span>
                                    <Link to="/instances" />
                                </Menu.Item>
                                <Menu.Item key="users">
                                    <span>Users</span>
                                    <Link to="/users" />
                                </Menu.Item>
                                <Menu.Item key="roles">
                                    <span>Roles</span>
                                    <Link to="/roles" />
                                </Menu.Item>
                                <Menu.Item key="permissions">
                                    <span>Permissions</span>
                                    <Link to="/permissions" />
                                </Menu.Item>
                                <Menu.Item key="settings">
                                    <span>Settings</span>
                                    <Link to="/settings" />
                                </Menu.Item>
                            </Menu>
                        </Sider>
                    ) : (
                            ""
                        )}
                    <Layout style={{
                        // background: "#F4F4F4"
                    }}>
                        <Content
                            style={{
                                margin: "24px 16px",
                                padding: 24,
                                // background: "#fff",
                                minHeight: 280,
                            }}
                        >
                            <Route exact path="/" component={Dashboard} />
                            <Route
                                exact
                                path="/instances"
                                component={InstancesTable}
                            />
                            <Route
                                exact
                                path="/instances/:id/view"
                                component={InstanceView}
                            />
                            <Route
                                exact
                                path="/slaves"
                                component={SlavesTable}
                            />
                            <Route
                                exact
                                path="/slaves/:id/view"
                                component={SlavesTable}
                            />
                            <Route
                                exact
                                path="/users"
                                component={UsersTable}
                            />
                            <Route
                                exact
                                path="/users/:id/view"
                                component={UserView}
                            />
                            <Route
                                exact
                                path="/roles"
                                component={RolesTable}
                            />
                            <Route
                                exact
                                path="/roles/:id/view"
                                component={RoleView}
                            />
                            <Route
                                exact
                                path="/permissions"
                                component={PermissionsTable}
                            />
                            <Route
                                exact
                                path="/permissions/:id/view"
                                component={PermissionsTable}
                            />
                            <Route
                                exact
                                path="/settings"
                                component={Settings}
                            />
                        </Content>
                        <Footer style={{
                            // background: "#F4F4F4",
                            textAlign: "center"
                        }}>
                            Clusterio 2.0 web interface https://github.com/clusterio
            </Footer>
                    </Layout>
                </Layout>
            </Router>
        );
    }
}

export default withRouter(SiteLayout);
