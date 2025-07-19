import React, { useState, useEffect, useContext } from "react";
import { Row, Col, Button, Card, Space, Select } from "antd";
import { MapContainer, TileLayer } from "react-leaflet";
import L from "leaflet";
import { ControlContext, useInstances } from "@clusterio/web_ui";

// Import Leaflet CSS
import "leaflet/dist/leaflet.css";

interface SurfaceForceData {
	surfaces: string[];
	forces: string[];
}

export default function MinimapPage() {
	const [instances] = useInstances();
	const [selectedInstance, setSelectedInstance] = useState<number | null>(null);
	const [selectedSurface, setSelectedSurface] = useState<string>("nauvis");
	const [selectedForce, setSelectedForce] = useState<string>("player");
	const [surfaceForceData, setSurfaceForceData] = useState<SurfaceForceData>({ surfaces: [], forces: [] });
	const [refreshTiles, setRefreshTiles] = useState(0);
	const [loading, setLoading] = useState(false);
	const control = useContext(ControlContext);

	// Set default instance when instances become available
	useEffect(() => {
		if (instances.size > 0 && !selectedInstance) {
			const firstInstance = instances.values().next().value;
			if (firstInstance) {
				setSelectedInstance(firstInstance.id);
			}
		}
	}, [instances, selectedInstance]);

	// Load surface and force data on component mount
	useEffect(() => {
		loadSurfaceForceData();
	}, []);

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

	// Use default map bounds centered around origin
	const mapBounds = [
		[-512 / 256, -512 / 256],
		[512 / 256, 512 / 256],
	] as L.LatLngBoundsExpression;

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
									options={[...instances.values()].map(instance => ({
										value: instance.id,
										label: instance.name
									}))}
								/>
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
							</Space>
						}
					>
						{selectedInstance && mapBounds ? (
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
