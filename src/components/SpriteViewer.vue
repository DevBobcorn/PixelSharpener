<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import InputNumber from "primevue/inputnumber";
import Panel from "primevue/panel";

const props = defineProps<{
  previewSrc?: string;
  palette: string[];
  width: number;
  height: number;
}>();

const spritePreviewElement = ref<HTMLElement | null>(null);
const spritePreviewSize = ref({ width: 0, height: 0 });
let spritePreviewResizeObserver: ResizeObserver | null = null;

const paletteSwatches = computed(() =>
  props.palette.map((color) => ({
    color,
    label: colorToLabel(color),
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

function colorToLabel(color: string): string {
  if (!color.startsWith("#") || color.length !== 7) {
    return color;
  }

  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);

  return `rgb(${red}, ${green}, ${blue})`;
}
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
        <h3 id="sprite-palette-heading" class="section-title">Palette List</h3>
        <ul class="palette-items">
          <li v-for="(color, index) in paletteSwatches" :key="`${color.color}-${index}`" class="palette-item">
            <span
              class="palette-swatch"
              :style="{ backgroundColor: color.color }"
              :title="color.label"
              :aria-label="color.label"
            />
          </li>
        </ul>
      </section>

      <section class="sprite-panel-section" aria-labelledby="sprite-size-heading">
        <h3 id="sprite-size-heading" class="section-title">Size</h3>
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
