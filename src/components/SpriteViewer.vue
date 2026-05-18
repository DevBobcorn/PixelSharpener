<script setup lang="ts">
import { computed, ref } from "vue";
import InputNumber from "primevue/inputnumber";
import Panel from "primevue/panel";

defineProps<{
  previewSrc?: string;
}>();

const palette = ref(["#2B2B2B", "#7A7A7A", "#D9D9D9"]);
const width = ref(16);
const height = ref(16);

const paletteSwatches = computed(() =>
  palette.value.map((hex) => ({
    hex,
    rgb: hexToRgb(hex),
  })),
);

function hexToRgb(hex: string): string {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized
        .split("")
        .map((digit) => `${digit}${digit}`)
        .join("")
    : normalized;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  return `rgb(${red}, ${green}, ${blue})`;
}
</script>

<template>
  <section class="sprite-viewer">
    <Panel header="Sprite Preview" class="preview-panel">
      <div class="sprite-preview-placeholder">
        <img v-if="previewSrc" :src="previewSrc" alt="Extracted sprite preview" class="preview-fit-image" />
        <span v-else>Extracted sprite</span>
      </div>
    </Panel>

    <Panel header="Palette List" class="palette-panel">
      <ul class="palette-items">
        <li v-for="color in paletteSwatches" :key="color.hex" class="palette-item">
          <span
            class="palette-swatch"
            :style="{ backgroundColor: color.hex }"
            :title="color.rgb"
            :aria-label="`${color.hex} ${color.rgb}`"
          />
        </li>
      </ul>
    </Panel>

    <Panel header="Size">
      <div class="size-fields">
        <label>
          <span>Width</span>
          <InputNumber v-model="width" :min="1" showButtons />
        </label>
        <label>
          <span>Height</span>
          <InputNumber v-model="height" :min="1" showButtons />
        </label>
      </div>
    </Panel>
  </section>
</template>
