<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import InputNumber from "primevue/inputnumber";
import Panel from "primevue/panel";

type PaletteSwatch = {
  color: string;
  label: string;
};

type IndexedPaletteSwatch = PaletteSwatch & {
  tooltip: string;
};

type HoveredPixel = {
  x: number;
  y: number;
};

type PixelTooltip = {
  text: string;
  x: number;
  y: number;
  placement: "top" | "bottom";
};

const transparentPaletteIndex = -1;

const props = withDefaults(
  defineProps<{
    previewSrc?: string;
    palette: PaletteSwatch[];
    indexes: number[];
    width: number;
    height: number;
    mergedPaletteIndices?: number[];
    insertedPaletteIndices?: number[];
  }>(),
  {
    mergedPaletteIndices: () => [],
    insertedPaletteIndices: () => [],
  },
);

const spritePreviewElement = ref<HTMLElement | null>(null);
const spritePreviewContent = ref<HTMLElement | null>(null);
const spritePreviewSize = ref({ width: 0, height: 0 });
const hoveredPixel = ref<HoveredPixel | null>(null);
const pixelTooltip = ref<PixelTooltip | null>(null);
let spritePreviewResizeObserver: ResizeObserver | null = null;

const paletteSwatches = computed<IndexedPaletteSwatch[]>(() =>
  props.palette.map((color, index) => ({
    ...color,
    tooltip: `${index}: ${color.label}`,
  })),
);

const mergedPaletteIndexSet = computed(() => new Set(props.mergedPaletteIndices));
const insertedPaletteIndexSet = computed(() => new Set(props.insertedPaletteIndices));

const spritePreviewScale = computed(() => {
  if (props.width <= 0 || props.height <= 0 || spritePreviewSize.value.width <= 0 || spritePreviewSize.value.height <= 0) {
    return 1;
  }

  return Math.max(
    1,
    Math.floor(Math.min(spritePreviewSize.value.width / props.width, spritePreviewSize.value.height / props.height)),
  );
});

const spritePreviewImageStyle = computed(() => ({
  width: `${props.width * spritePreviewScale.value}px`,
  height: `${props.height * spritePreviewScale.value}px`,
}));

const spritePixelHoverStyle = computed(() => {
  if (!hoveredPixel.value) {
    return undefined;
  }

  const scale = spritePreviewScale.value;

  return {
    left: `${hoveredPixel.value.x * scale}px`,
    top: `${hoveredPixel.value.y * scale}px`,
    width: `${scale}px`,
    height: `${scale}px`,
  };
});

onMounted(() => {
  if (!spritePreviewElement.value) {
    return;
  }

  spritePreviewResizeObserver = new ResizeObserver(([entry]) => {
    spritePreviewSize.value = {
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    };
  });
  spritePreviewResizeObserver.observe(spritePreviewElement.value);
});

onBeforeUnmount(() => {
  spritePreviewResizeObserver?.disconnect();
});

function getPixelTooltipText(paletteIndex: number): string {
  if (paletteIndex === transparentPaletteIndex) {
    return `${paletteIndex}: transparent`;
  }

  const swatch = props.palette[paletteIndex];
  if (!swatch) {
    return `${paletteIndex}: unknown`;
  }

  return `${paletteIndex}: ${swatch.label}`;
}

function updateHoveredPixel(event: PointerEvent): void {
  const content = spritePreviewContent.value;
  if (!content || !props.previewSrc || props.width <= 0 || props.height <= 0) {
    return;
  }

  const scale = spritePreviewScale.value;
  const bounds = content.getBoundingClientRect();
  const localX = event.clientX - bounds.left;
  const localY = event.clientY - bounds.top;

  if (localX < 0 || localY < 0 || localX >= bounds.width || localY >= bounds.height) {
    clearHoveredPixel();
    return;
  }

  const pixelX = Math.min(props.width - 1, Math.max(0, Math.floor(localX / scale)));
  const pixelY = Math.min(props.height - 1, Math.max(0, Math.floor(localY / scale)));
  const paletteIndex = props.indexes[pixelY * props.width + pixelX] ?? transparentPaletteIndex;

  hoveredPixel.value = { x: pixelX, y: pixelY };

  const margin = 8;
  const maxTooltipWidth = Math.min(288, window.innerWidth - margin * 2);
  const pixelCenterX = bounds.left + (pixelX + 0.5) * scale;
  const pixelCenterY = bounds.top + (pixelY + 0.5) * scale;
  const placement = pixelCenterY >= 40 ? "top" : "bottom";

  pixelTooltip.value = {
    text: getPixelTooltipText(paletteIndex),
    x: clamp(pixelCenterX, margin + maxTooltipWidth / 2, window.innerWidth - margin - maxTooltipWidth / 2),
    y: placement === "top" ? pixelCenterY - 6 : pixelCenterY + 6,
    placement,
  };
}

function clearHoveredPixel(): void {
  hoveredPixel.value = null;
  pixelTooltip.value = null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
</script>

<template>
  <section class="sprite-viewer">
    <Panel header="Sprite" class="sprite-panel">
      <section class="sprite-panel-section sprite-preview-section">
        <div
          ref="spritePreviewElement"
          class="sprite-preview-placeholder"
          @pointerleave="clearHoveredPixel"
        >
          <div
            v-if="previewSrc"
            ref="spritePreviewContent"
            class="sprite-preview-content"
            @pointermove="updateHoveredPixel"
          >
            <img
              :src="previewSrc"
              alt="Sprite preview"
              class="sprite-preview-image"
              :style="spritePreviewImageStyle"
              draggable="false"
            />
            <span
              v-if="hoveredPixel"
              class="sprite-pixel-hover-frame"
              :style="spritePixelHoverStyle"
              aria-hidden="true"
            />
          </div>
          <span v-else>Sprite Preview</span>
        </div>
      </section>

      <section class="sprite-panel-section" aria-labelledby="sprite-palette-heading">
        <h3 id="sprite-palette-heading" class="section-title">Palette List ({{ paletteSwatches.length }})</h3>
        <ul class="palette-items">
          <li v-for="(color, index) in paletteSwatches" :key="`${color.color}-${index}`" class="palette-item">
            <span
              class="palette-swatch-wrapper"
              :class="{
                'is-merged-palette': mergedPaletteIndexSet.has(index),
                'is-inserted-palette': insertedPaletteIndexSet.has(index),
              }"
            >
              <span class="palette-swatch" :style="{ backgroundColor: color.color }" :aria-label="color.tooltip" />
              <span class="palette-swatch-tooltip" role="tooltip">{{ color.tooltip }}</span>
            </span>
          </li>
        </ul>
      </section>

      <section class="sprite-panel-section">
        <div class="size-fields">
          <label>
            <span>Width</span>
            <InputNumber :model-value="width" :min="1" disabled />
          </label>
          <label>
            <span>Height</span>
            <InputNumber :model-value="height" :min="1" disabled />
          </label>
        </div>
      </section>
    </Panel>
    <span
      v-if="pixelTooltip"
      class="sprite-preview-pixel-tooltip"
      :class="{ 'is-below': pixelTooltip.placement === 'bottom' }"
      :style="{ left: `${pixelTooltip.x}px`, top: `${pixelTooltip.y}px` }"
      role="tooltip"
    >
      {{ pixelTooltip.text }}
    </span>
  </section>
</template>
