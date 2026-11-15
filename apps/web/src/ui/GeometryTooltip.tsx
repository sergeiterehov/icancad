import { useViewModel } from '../stores/documentStore';
import { useUiStore } from '../stores/uiStore';
import { FeatureIcon } from './featureIcons';

/**
 * The operation the pointer is over, named next to the geometry it made. It only
 * speaks while operations are being picked: that is when the pointer answers the
 * question the panel is asking. The component subscribes on its own, so the
 * viewport does not re-render while the pointer travels over the model.
 */
export function GeometryTooltip() {
  const hover = useUiStore((state) => state.hoveredFeature);
  const picking = useUiStore((state) => state.pickingArrayOperations);
  const project = useViewModel();
  if (!hover || !picking) return null;
  const feature = project.features.find((candidate) => candidate.id === hover.featureId);
  if (!feature) return null;
  return (
    <div
      className="geometry-tooltip"
      data-testid="geometry-tooltip"
      style={{ left: hover.x + 16, top: hover.y + 18 }}
    >
      <FeatureIcon feature={feature} size={13} />
      <span className="geometry-tooltip-name">{feature.name}</span>
    </div>
  );
}
