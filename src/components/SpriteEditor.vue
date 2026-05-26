<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Panel from "primevue/panel";
import Button from "primevue/button";

type PaletteSwatch = {
  color: string;
  label: string;
};

type PaintPayload = {
  x: number;
  y: number;
};

type ShiftSelectionColorPayload = {
  offsets: number[];
  delta: number;
};

type SelectionMode = "replace" | "add" | "subtract";

const transparentPaletteIndex = -1;

const props = defineProps<{
  previewSrc?: string;
  palette: PaletteSwatch[];
  indexes: number[];
  width: number;
  height: number;
  tool: "pencil" | "brush" | "eraser" | "selection";
}>();

const emit = defineEmits<{
  paintStart: [];
  paint: [payload: PaintPayload];
  paintEnd: [];
  shiftSelectionColor: [payload: ShiftSelectionColorPayload];
}>();

const editorViewportElement = ref<HTMLElement | null>(null);
const editorCanvasElement = ref<HTMLCanvasElement | null>(null);
const viewportSize = ref({ width: 0, height: 0 });
const hoveredPixel = ref<{ x: number; y: number } | null>(null);
const isPainting = ref(false);
const isSelecting = ref(false);
const selectionStartPixel = ref<{ x: number; y: number } | null>(null);
const selectionCurrentPixel = ref<{ x: number; y: number } | null>(null);
const selectionMode = ref<SelectionMode>("replace");
const selectedPixelOffsets = ref(new Set<number>());
const selectionContextMenu = ref<{ x: number; y: number } | null>(null);
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

const selectionPreviewFrameStyle = computed(() => {
  const start = selectionStartPixel.value;
  const current = selectionCurrentPixel.value;
  if (!isSelecting.value || !start || !current) {
    return undefined;
  }

  const scale = previewScale.value;
  const left = Math.min(start.x, current.x);
  const top = Math.min(start.y, current.y);
  const width = Math.abs(current.x - start.x) + 1;
  const height = Math.abs(current.y - start.y) + 1;

  return {
    left: `${left * scale}px`,
    top: `${top * scale}px`,
    width: `${Math.max(1, width * scale)}px`,
    height: `${Math.max(1, height * scale)}px`,
  };
});

const selectionOutlineSegments = computed(() => {
  if (selectedPixelOffsets.value.size === 0 || props.width <= 0) {
    return [] as { x1: number; y1: number; x2: number; y2: number }[];
  }

  const horizontalEdges = new Map<number, Array<{ start: number; end: number }>>();
  const verticalEdges = new Map<number, Array<{ start: number; end: number }>>();
  const selected = selectedPixelOffsets.value;

  const addHorizontalEdge = (y: number, start: number, end: number): void => {
    const edges = horizontalEdges.get(y) ?? [];
    edges.push({ start, end });
    horizontalEdges.set(y, edges);
  };

  const addVerticalEdge = (x: number, start: number, end: number): void => {
    const edges = verticalEdges.get(x) ?? [];
    edges.push({ start, end });
    verticalEdges.set(x, edges);
  };

  const hasSelected = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= props.width || y >= props.height) {
      return false;
    }

    return selected.has(y * props.width + x);
  };

  for (const offset of selected) {
    const x = offset % props.width;
    const y = Math.floor(offset / props.width);

    if (!hasSelected(x, y - 1)) {
      addHorizontalEdge(y, x, x + 1);
    }
    if (!hasSelected(x, y + 1)) {
      addHorizontalEdge(y + 1, x, x + 1);
    }
    if (!hasSelected(x - 1, y)) {
      addVerticalEdge(x, y, y + 1);
    }
    if (!hasSelected(x + 1, y)) {
      addVerticalEdge(x + 1, y, y + 1);
    }
  }

  const mergedSegments: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const scale = previewScale.value;
  const epsilon = 0.00001;
  const mergeRanges = (ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> => {
    if (ranges.length === 0) {
      return [];
    }

    const sorted = [...ranges].sort((left, right) => left.start - right.start || left.end - right.end);
    const merged: Array<{ start: number; end: number }> = [sorted[0]];
    for (let index = 1; index < sorted.length; index += 1) {
      const current = sorted[index];
      const previous = merged[merged.length - 1];
      if (current.start <= previous.end + epsilon) {
        previous.end = Math.max(previous.end, current.end);
      } else {
        merged.push({ ...current });
      }
    }

    return merged;
  };

  for (const [y, ranges] of horizontalEdges) {
    for (const mergedRange of mergeRanges(ranges)) {
      mergedSegments.push({
        x1: mergedRange.start * scale,
        y1: y * scale,
        x2: mergedRange.end * scale,
        y2: y * scale,
      });
    }
  }

  for (const [x, ranges] of verticalEdges) {
    for (const mergedRange of mergeRanges(ranges)) {
      mergedSegments.push({
        x1: x * scale,
        y1: mergedRange.start * scale,
        x2: x * scale,
        y2: mergedRange.end * scale,
      });
    }
  }

  return mergedSegments;
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
  window.addEventListener("click", closeSelectionContextMenu);
  window.addEventListener("keydown", closeSelectionContextMenuOnEscape);
  renderCanvas();
});

onBeforeUnmount(() => {
  if (isPainting.value) {
    emit("paintEnd");
    isPainting.value = false;
  }

  resizeObserver?.disconnect();
  window.removeEventListener("click", closeSelectionContextMenu);
  window.removeEventListener("keydown", closeSelectionContextMenuOnEscape);
});

watch(
  () => [props.indexes, props.palette, props.width, props.height, previewScale.value],
  () => {
    renderCanvas();
  },
  { deep: true, flush: "post" },
);

watch(
  () => [props.previewSrc, props.width, props.height],
  () => {
    selectedPixelOffsets.value = new Set<number>();
    selectionStartPixel.value = null;
    selectionCurrentPixel.value = null;
    isSelecting.value = false;
    closeSelectionContextMenu();
    renderCanvas();
  },
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
  closeSelectionContextMenu();

  if (props.tool === "selection") {
    startSelection(event);
    return;
  }

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
  if (isSelecting.value) {
    continueSelection(event);
    return;
  }

  updateHoveredPixel(event);

  if (!isPainting.value) {
    return;
  }

  event.preventDefault();
  paintFromEvent(event);
}

function stopPaint(event: PointerEvent): void {
  if (isSelecting.value) {
    stopSelection(event);
  }

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
  if (isSelecting.value) {
    return;
  }

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

function startSelection(event: PointerEvent): void {
  if (event.button !== 0) {
    return;
  }

  const viewport = editorViewportElement.value;
  if (!viewport) {
    return;
  }

  const start = getPixelFromEvent(event, true);
  if (!start) {
    return;
  }

  event.preventDefault();
  viewport.setPointerCapture(event.pointerId);

  isSelecting.value = true;
  selectionMode.value = getSelectionModeFromEvent(event);
  selectionStartPixel.value = start;
  selectionCurrentPixel.value = start;
  hoveredPixel.value = start;
}

function continueSelection(event: PointerEvent): void {
  const position = getPixelFromEvent(event, true);
  if (!position) {
    return;
  }

  event.preventDefault();
  selectionCurrentPixel.value = position;
  hoveredPixel.value = position;
}

function stopSelection(event: PointerEvent): void {
  const start = selectionStartPixel.value;
  const end = selectionCurrentPixel.value ?? getPixelFromEvent(event, true);
  if (start && end) {
    applySelectionRectangle(start, end, selectionMode.value);
  }

  isSelecting.value = false;
  selectionStartPixel.value = null;
  selectionCurrentPixel.value = null;
}

function handleSelectionContextMenu(event: MouseEvent): void {
  event.preventDefault();
  const selected = selectedPixelOffsets.value;
  if (selected.size === 0) {
    closeSelectionContextMenu();
    return;
  }

  const position = getPixelFromClientPosition(event.clientX, event.clientY, false);
  if (!position) {
    closeSelectionContextMenu();
    return;
  }

  const offset = position.y * props.width + position.x;
  if (!selected.has(offset)) {
    closeSelectionContextMenu();
    return;
  }

  selectionContextMenu.value = {
    x: event.clientX,
    y: event.clientY,
  };
}

function shiftSelectedColors(delta: number): void {
  const offsets = Array.from(selectedPixelOffsets.value);
  if (offsets.length === 0) {
    return;
  }

  emit("shiftSelectionColor", {
    offsets,
    delta,
  });
  closeSelectionContextMenu();
}

function closeSelectionContextMenu(): void {
  selectionContextMenu.value = null;
}

function closeSelectionContextMenuOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeSelectionContextMenu();
  }
}

function getSelectionModeFromEvent(event: PointerEvent): SelectionMode {
  if (event.ctrlKey) {
    return "subtract";
  }

  if (event.shiftKey) {
    return "add";
  }

  return "replace";
}

function applySelectionRectangle(start: { x: number; y: number }, end: { x: number; y: number }, mode: SelectionMode): void {
  const left = Math.max(0, Math.min(start.x, end.x));
  const right = Math.min(props.width - 1, Math.max(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const bottom = Math.min(props.height - 1, Math.max(start.y, end.y));

  const nextSelection = mode === "replace" ? new Set<number>() : new Set<number>(selectedPixelOffsets.value);
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      const offset = y * props.width + x;
      if (mode === "subtract") {
        nextSelection.delete(offset);
      } else {
        nextSelection.add(offset);
      }
    }
  }

  selectedPixelOffsets.value = nextSelection;
  renderCanvas();
}

function getPixelFromEvent(event: PointerEvent, clampToBounds = false): { x: number; y: number } | null {
  const canvas = editorCanvasElement.value;
  if (!canvas || props.width <= 0 || props.height <= 0) {
    return null;
  }

  const bounds = canvas.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) {
    return null;
  }

  return getPixelFromClientPosition(event.clientX, event.clientY, clampToBounds);
}

function getPixelFromClientPosition(clientX: number, clientY: number, clampToBounds = false): { x: number; y: number } | null {
  const canvas = editorCanvasElement.value;
  if (!canvas || props.width <= 0 || props.height <= 0) {
    return null;
  }

  const bounds = canvas.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) {
    return null;
  }

  const localX = clientX - bounds.left;
  const localY = clientY - bounds.top;
  if (!clampToBounds && (localX < 0 || localY < 0 || localX >= bounds.width || localY >= bounds.height)) {
    return null;
  }

  const scale = previewScale.value;
  const boundedX = clamp(localX, 0, bounds.width - 0.0001);
  const boundedY = clamp(localY, 0, bounds.height - 0.0001);
  return {
    x: Math.min(props.width - 1, Math.max(0, Math.floor(boundedX / scale))),
    y: Math.min(props.height - 1, Math.max(0, Math.floor(boundedY / scale))),
  };
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
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
        @contextmenu="handleSelectionContextMenu"
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
          <span
            v-if="selectionPreviewFrameStyle"
            class="sprite-selection-preview-frame"
            :style="selectionPreviewFrameStyle"
            aria-hidden="true"
          />
          <svg
            v-if="selectionOutlineSegments.length > 0"
            class="sprite-selection-outline"
            :width="Math.max(1, props.width * previewScale)"
            :height="Math.max(1, props.height * previewScale)"
            aria-hidden="true"
          >
            <line
              v-for="(segment, index) in selectionOutlineSegments"
              :key="`${index}:${segment.x1}:${segment.y1}:${segment.x2}:${segment.y2}`"
              class="sprite-selection-outline-segment"
              :x1="segment.x1"
              :y1="segment.y1"
              :x2="segment.x2"
              :y2="segment.y2"
            />
          </svg>
        </div>
        <span v-if="!previewSrc">Select a sprite to edit</span>
        <div
          v-if="selectionContextMenu"
          class="sprite-context-menu sprite-selection-context-menu"
          :style="{ left: `${selectionContextMenu.x}px`, top: `${selectionContextMenu.y}px` }"
          role="menu"
          @click.stop
          @pointerdown.stop
          @pointerup.stop
          @contextmenu.prevent.stop
        >
          <Button
            type="button"
            role="menuitem"
            text
            label="Shift color by 1"
            class="sprite-context-menu-action"
            @pointerdown.stop
            @click.stop="shiftSelectedColors(1)"
          />
          <Button
            type="button"
            role="menuitem"
            text
            label="Shift color by -1"
            class="sprite-context-menu-action"
            @pointerdown.stop
            @click.stop="shiftSelectedColors(-1)"
          />
        </div>
      </section>
    </Panel>
  </section>
</template>
