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

const props = defineProps<{
  previewSrc?: string;
  palette: PaletteSwatch[];
  width: number;
  height: number;
}>();

const spritePreviewElement = ref<HTMLElement | null>(null);
const spritePreviewSize = ref({ width: 0, height: 0 });
let spritePreviewResizeObserver: ResizeObserver | null = null;

const paletteSwatches = computed<IndexedPaletteSwatch[]>(() =>
  props.palette.map((color, index) => ({
    ...color,
    tooltip: `${index}: ${color.label}`,
  })),
);

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

</script>

<template>
  <section class="sprite-viewer">
    <Panel header="Sprite" class="sprite-panel">
      <section class="sprite-panel-section sprite-preview-section">
        <div ref="spritePreviewElement" class="sprite-preview-placeholder">
          <img
            v-if="previewSrc"
            :src="previewSrc"
            alt="Extracted sprite preview"
            class="sprite-preview-image"
            :style="spritePreviewImageStyle"
          />
          <span v-else>Extracted sprite</span>
        </div>
      </section>

      <section class="sprite-panel-section" aria-labelledby="sprite-palette-heading">
        <h3 id="sprite-palette-heading" class="section-title">Palette List ({{ paletteSwatches.length }})</h3>
        <ul class="palette-items">
          <li v-for="(color, index) in paletteSwatches" :key="`${color.color}-${index}`" class="palette-item">
            <span class="palette-swatch-wrapper">
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
  </section>
</template>
