import React, { useState, useEffect, useContext } from "react";
import { Row, Col, Button, Card, Space, Select } from "antd";
import { MapContainer, TileLayer } from "react-leaflet";
import L from "leaflet";
import { ControlContext } from "@clusterio/web_ui";
import { GetInstanceBoundsRequest, RefreshTileDataRequest } from "../messages";

interface Instance {
	instanceId: number;
	name: string;
	bounds: {
		x1: number;
		y1: number;
		x2: number;
		y2: number;
	};
}

export default function MinimapPage() {
	const [instances, setInstances] = useState<Instance[]>([]);
	const [selectedInstance, setSelectedInstance] = useState<number | null>(null);
	const [refreshTiles, setRefreshTiles] = useState(0);
	const [loading, setLoading] = useState(false);
	const control = useContext(ControlContext);

	// Load instance bounds on component mount
	useEffect(() => {
		loadInstances();
	}, []);

	const loadInstances = async () => {
		try {
			setLoading(true);
			const response = await control.send(new GetInstanceBoundsRequest());
			setInstances(response.instances);
			
			if (response.instances.length > 0 && !selectedInstance) {
				setSelectedInstance(response.instances[0].instanceId);
			}
		} catch (err) {
			console.error("Failed to load instances:", err);
		} finally {
			setLoading(false);
		}
	};

	const refreshTileData = async () => {
		if (!selectedInstance) return;

		try {
			setLoading(true);
			await control.send(new RefreshTileDataRequest(selectedInstance));
			
			// Force tile refresh by incrementing the refresh parameter
			setRefreshTiles(prev => prev + 1);
		} catch (err) {
			console.error("Failed to refresh tile data:", err);
		} finally {
			setLoading(false);
		}
	};

	const selectedInstanceData = instances.find(inst => inst.instanceId === selectedInstance);

	const mapBounds = selectedInstanceData ? [
		[selectedInstanceData.bounds.y1 / 256, selectedInstanceData.bounds.x1 / 256],
		[selectedInstanceData.bounds.y2 / 256, selectedInstanceData.bounds.x2 / 256],
	] as L.LatLngBoundsExpression : undefined;

	return (
		<div style={{ padding: "20px" }}>
			<Row gutter={[16, 16]}>
				<Col span={24}>
					<Card 
						title="Factorio Instance Minimap" 
						extra={
							<Space>
								<Select
									style={{ width: 200 }}
									placeholder="Select instance"
									value={selectedInstance}
									onChange={setSelectedInstance}
									loading={loading}
								>
									{instances.map(instance => (
										<Select.Option key={instance.instanceId} value={instance.instanceId}>
											{instance.name}
										</Select.Option>
									))}
								</Select>
								<Button 
									type="primary" 
									onClick={refreshTileData}
									loading={loading}
									disabled={!selectedInstance}
								>
									Refresh Map
								</Button>
								<Button onClick={loadInstances} loading={loading}>
									Reload Instances
								</Button>
							</Space>
						}
					>
						{selectedInstanceData && mapBounds ? (
							<div style={{ height: "700px", width: "100%" }}>
								<MapContainer
									bounds={mapBounds}
									style={{ height: "100%", width: "100%", backgroundColor: "#1a1a1a" }}
									attributionControl={false}
									maxZoom={18}
									minZoom={7}
									crs={L.CRS.Simple}
								>
									{/* Terrain layer */}
									<TileLayer
										url={`${window.location.origin}/api/minimap/tiles/{z}/{x}/{y}.png?refresh=${refreshTiles}`}
										maxNativeZoom={10}
										minNativeZoom={7}
										opacity={1}
									/>
									{/* Entity layer */}
									<TileLayer
										url={`${window.location.origin}/api/minimap/entities/{z}/{x}/{y}.png?refresh=${refreshTiles}`}
										maxNativeZoom={10}
										minNativeZoom={7}
										opacity={0.8}
									/>
								</MapContainer>
							</div>
						) : (
							<div 
								style={{ 
									height: "400px", 
									display: "flex", 
									alignItems: "center", 
									justifyContent: "center",
									backgroundColor: "#f5f5f5",
									border: "1px dashed #d9d9d9",
									borderRadius: "6px",
								}}
							>
								<div style={{ textAlign: "center" }}>
									<h3>No Instance Selected</h3>
									<p>Select a running instance to view its minimap</p>
								</div>
							</div>
						)}
					</Card>
				</Col>
			</Row>
		</div>
	);
} 
