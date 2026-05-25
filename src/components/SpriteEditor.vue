<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Panel from "primevue/panel";

type PaletteSwatch = {
  color: string;
  label: string;
};

type PaintPayload = {
  x: number;
  y: number;
};

const transparentPaletteIndex = -1;

const props = defineProps<{
  previewSrc?: string;
  palette: PaletteSwatch[];
  indexes: number[];
  width: number;
  height: number;
  tool: "pencil" | "brush" | "eraser";
}>();

const emit = defineEmits<{
  paintStart: [];
  paint: [payload: PaintPayload];
  paintEnd: [];
}>();

const editorViewportElement = ref<HTMLElement | null>(null);
const editorCanvasElement = ref<HTMLCanvasElement | null>(null);
const viewportSize = ref({ width: 0, height: 0 });
const hoveredPixel = ref<{ x: number; y: number } | null>(null);
const isPainting = ref(false);
let resizeObserver: ResizeObserver | null = null;

const previewScale = computed(() => {
  if (props.width <= 0 || props.height <= 0 || viewportSize.value.width <= 0 || viewportSize.value.height <= 0) {
    return 1;
  }

  return Math.max(1, Math.floor(Math.min(viewportSize.value.width / props.width, viewportSize.value.height / props.height)));
});

const canvasStyle = computed(() => ({
  width: `${props.width * previewScale.value}px`,
  height: `${props.height * previewScale.value}px`,
  cursor: props.tool === "eraser" ? "cell" : "crosshair",
}));

const pixelHoverFrameStyle = computed(() => {
  if (!hoveredPixel.value) {
    return undefined;
  }

  const scale = previewScale.value;
  return {
    left: `${hoveredPixel.value.x * scale}px`,
    top: `${hoveredPixel.value.y * scale}px`,
    width: `${scale}px`,
    height: `${scale}px`,
  };
});

onMounted(() => {
  if (!editorViewportElement.value) {
    return;
  }

  resizeObserver = new ResizeObserver(([entry]) => {
    viewportSize.value = {
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    };
  });
  resizeObserver.observe(editorViewportElement.value);
  renderCanvas();
});

onBeforeUnmount(() => {
  if (isPainting.value) {
    emit("paintEnd");
    isPainting.value = false;
  }

  resizeObserver?.disconnect();
});

watch(
  () => [props.indexes, props.palette, props.width, props.height, previewScale.value],
  () => {
    renderCanvas();
  },
  { deep: true, flush: "post" },
);

function renderCanvas(): void {
  const canvas = editorCanvasElement.value;
  if (!canvas) {
    return;
  }

  const scale = previewScale.value;
  canvas.width = Math.max(1, props.width * scale);
  canvas.height = Math.max(1, props.height * scale);

  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  context.clearRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < props.height; y += 1) {
    for (let x = 0; x < props.width; x += 1) {
      const paletteIndex = props.indexes[y * props.width + x] ?? transparentPaletteIndex;
      if (paletteIndex === transparentPaletteIndex) {
        continue;
      }

      const color = props.palette[paletteIndex]?.color;
      if (!color) {
        continue;
      }

      context.fillStyle = color;
      context.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

function startPaint(event: PointerEvent): void {
  if (event.button !== 0) {
    return;
  }

  const viewport = editorViewportElement.value;
  if (!viewport) {
    return;
  }

  event.preventDefault();
  viewport.setPointerCapture(event.pointerId);
  isPainting.value = true;
  emit("paintStart");
  updateHoveredPixel(event);
  paintFromEvent(event);
}

function continuePaint(event: PointerEvent): void {
  updateHoveredPixel(event);

  if (!isPainting.value) {
    return;
  }

  event.preventDefault();
  paintFromEvent(event);
}

function stopPaint(event: PointerEvent): void {
  const viewport = editorViewportElement.value;
  if (viewport?.hasPointerCapture(event.pointerId)) {
    viewport.releasePointerCapture(event.pointerId);
  }

  if (!isPainting.value) {
    return;
  }

  isPainting.value = false;
  emit("paintEnd");
}

function clearHoveredPixel(): void {
  hoveredPixel.value = null;
}

function updateHoveredPixel(event: PointerEvent): void {
  hoveredPixel.value = getPixelFromEvent(event);
}

function paintFromEvent(event: PointerEvent): void {
  const position = getPixelFromEvent(event);
  if (!position) {
    return;
  }

  emit("paint", {
    x: position.x,
    y: position.y,
  });
}

function getPixelFromEvent(event: PointerEvent): { x: number; y: number } | null {
  const canvas = editorCanvasElement.value;
  if (!canvas || props.width <= 0 || props.height <= 0) {
    return null;
  }

  const bounds = canvas.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) {
    return null;
  }

  const localX = event.clientX - bounds.left;
  const localY = event.clientY - bounds.top;
  if (localX < 0 || localY < 0 || localX >= bounds.width || localY >= bounds.height) {
    return null;
  }

  const scale = previewScale.value;
  return {
    x: Math.min(props.width - 1, Math.max(0, Math.floor(localX / scale))),
    y: Math.min(props.height - 1, Math.max(0, Math.floor(localY / scale))),
  };
}
</script>

<template>
  <section class="sprite-editor">
    <Panel header="Sprite Editor" class="sprite-panel">
      <section
        ref="editorViewportElement"
        class="sprite-preview-placeholder sprite-editor-canvas-wrap"
        @pointerdown="startPaint"
        @pointermove="continuePaint"
        @pointerup="stopPaint"
        @pointercancel="stopPaint"
        @pointerleave="clearHoveredPixel"
        @contextmenu.prevent
      >
        <div v-if="previewSrc" class="sprite-editor-canvas-content">
          <canvas
            ref="editorCanvasElement"
            class="sprite-editor-canvas"
            :style="canvasStyle"
            aria-label="Sprite editor canvas"
          />
          <span
            v-if="hoveredPixel"
            class="sprite-pixel-hover-frame"
            :style="pixelHoverFrameStyle"
            aria-hidden="true"
          />
        </div>
        <span v-else>Select a sprite to edit</span>
      </section>
    </Panel>
  </section>
</template>
