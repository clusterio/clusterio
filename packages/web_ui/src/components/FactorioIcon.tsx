import { PrototypeMetadataEntry } from "../store/export_prototype_metadata_store";

export default function FactorioIcon(props: { modPackId: number | undefined, prototype?: PrototypeMetadataEntry }) {
	return <span
		className="factorio-icon"
		data-mod-pack={props.modPackId}
		data-type={props.prototype?.base_type}
		data-name={props.prototype?.name}
		data-unknown={props.prototype ? undefined : "true"}
	/>;
}
