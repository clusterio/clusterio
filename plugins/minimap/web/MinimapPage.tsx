import React, { useState, useEffect, useContext } from "react";
import { Row, Col, Button, Card, Space, Select } from "antd";
import { MapContainer, TileLayer } from "react-leaflet";
import L from "leaflet";
import { ControlContext } from "@clusterio/web_ui";
import { GetInstanceBoundsRequest } from "../messages";

// Import Leaflet CSS
import "leaflet/dist/leaflet.css";

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

interface SurfaceForceData {
	surfaces: string[];
	forces: string[];
}

export default function MinimapPage() {
	const [instances, setInstances] = useState<Instance[]>([]);
	const [selectedInstance, setSelectedInstance] = useState<number | null>(null);
	const [selectedSurface, setSelectedSurface] = useState<string>("nauvis");
	const [selectedForce, setSelectedForce] = useState<string>("player");
	const [surfaceForceData, setSurfaceForceData] = useState<SurfaceForceData>({ surfaces: [], forces: [] });
	const [refreshTiles, setRefreshTiles] = useState(0);
	const [loading, setLoading] = useState(false);
	const control = useContext(ControlContext);

	// Load instance bounds on component mount
	useEffect(() => {
		loadInstances();
		loadSurfaceForceData();
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

	const loadSurfaceForceData = async () => {
		try {
			const response = await fetch(`${window.location.origin}/api/minimap/surfaces`);
			console.log(response);
			const data = await response.json();
			setSurfaceForceData(data);
			
			// Set default selections if available
			if (data.surfaces.length > 0 && !selectedSurface) {
				setSelectedSurface(data.surfaces.includes("nauvis") ? "nauvis" : data.surfaces[0]);
			}
			if (data.forces.length > 0 && !selectedForce) {
				setSelectedForce(data.forces.includes("player") ? "player" : data.forces[0]);
			}
		} catch (err) {
			console.error("Failed to load surface/force data:", err);
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
							<Space wrap>
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
								<Select
									style={{ width: 150 }}
									placeholder="Select surface"
									value={selectedSurface}
									onChange={setSelectedSurface}
								>
									{surfaceForceData.surfaces.map(surface => (
										<Select.Option key={surface} value={surface}>
											{surface}
										</Select.Option>
									))}
								</Select>
								<Select
									style={{ width: 150 }}
									placeholder="Select force"
									value={selectedForce}
									onChange={setSelectedForce}
								>
									{surfaceForceData.forces.map(force => (
										<Select.Option key={force} value={force}>
											{force}
										</Select.Option>
									))}
								</Select>

								<Button onClick={loadInstances} loading={loading}>
									Reload Instances
								</Button>
							</Space>
						}
					>
						{selectedInstanceData && mapBounds ? (
							<div 
								style={{ 
									height: "700px", 
									width: "100%"
								}}
								className="minimap-container"
							>
								<style>
									{`/* Avoid blurry rendering when zooming in */
									.minimap-container .leaflet-container .leaflet-overlay-pane svg,
									.minimap-container .leaflet-container .leaflet-marker-pane img,
									.minimap-container .leaflet-container .leaflet-shadow-pane img,
									.minimap-container .leaflet-container .leaflet-tile-pane img,
									.minimap-container .leaflet-container img.leaflet-image-layer {
										image-rendering: pixelated;
									}
									`}
								</style>
								<MapContainer
									bounds={mapBounds}
									style={{ height: "100%", width: "100%", backgroundColor: "#1a1a1a" }}
									attributionControl={false}
									maxZoom={18}
									minZoom={7}
									crs={L.CRS.Simple}
								>
									{/* Chart layer with surface and force data */}
									<TileLayer
										url={`${window.location.origin}/api/minimap/chart/${selectedInstance}/${selectedSurface}/${selectedForce}/{z}/{x}/{y}.png?refresh=${refreshTiles}`}
										maxNativeZoom={10}
										minNativeZoom={10}
										opacity={1}
										tileSize={512}
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
