<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import Panel from "primevue/panel";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import SpriteViewer from "./components/SpriteViewer.vue";

type RgbaColor = {
  red: number;
  green: number;
  blue: number;
  alpha: number;
};

type IndexedSprite = {
  id: number;
  name: string;
  src: string;
  width: number;
  height: number;
  palette: RgbaColor[];
  indexes: number[];
};

type SpriteContextMenu = {
  sprite: IndexedSprite;
  x: number;
  y: number;
};

type SourceImage = {
  name: string;
  src: string;
  width: number;
  height: number;
};

type PixelPosition = {
  x: number;
  y: number;
};

type SourceImageView = {
  zoom: number;
  pan: PixelPosition;
};

const openedSprites = ref<IndexedSprite[]>([]);
const selectedSprite = ref<IndexedSprite | null>(null);
const activeTab = ref("extract-sprite");
const fileInput = ref<HTMLInputElement | null>(null);
const sourceFileInput = ref<HTMLInputElement | null>(null);
const sourcePreviewImage = ref<HTMLImageElement | null>(null);
const sourceImage = ref<SourceImage | null>(null);
const sourceImagePixelPosition = ref<PixelPosition | null>(null);
const sourceImageZoom = ref(1);
const sourceImagePan = ref<PixelPosition>({ x: 0, y: 0 });
const isSourceImagePanning = ref(false);
const sourceImagePanStart = ref<PixelPosition | null>(null);
const sourceImagePanOrigin = ref<PixelPosition | null>(null);
const importError = ref("");
const sourceImportError = ref("");
const spriteContextMenu = ref<SpriteContextMenu | null>(null);
let nextSpriteId = 1;

const minSourceImageZoom = 1;
const maxSourceImageZoom = 32;

const sourceImageTransformStyle = computed(() => ({
  height: sourceImage.value ? `${sourceImage.value.height * sourceImageZoom.value}px` : undefined,
  transform: `translate(-50%, -50%) translate(${sourceImagePan.value.x}px, ${sourceImagePan.value.y}px)`,
  width: sourceImage.value ? `${sourceImage.value.width * sourceImageZoom.value}px` : undefined,
}));

onMounted(() => {
  window.addEventListener("click", closeSpriteContextMenu);
  window.addEventListener("keydown", closeSpriteContextMenuOnEscape);
});

onBeforeUnmount(() => {
  window.removeEventListener("click", closeSpriteContextMenu);
  window.removeEventListener("keydown", closeSpriteContextMenuOnEscape);
});

function colorToCss(color: RgbaColor): string {
  if (color.alpha === 255) {
    return `#${toHex(color.red)}${toHex(color.green)}${toHex(color.blue)}`;
  }

  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${(color.alpha / 255).toFixed(3)})`;
}

function toHex(value: number): string {
  return value.toString(16).padStart(2, "0").toUpperCase();
}

function renderIndexedSpriteToDataUri(
  width: number,
  height: number,
  palette: RgbaColor[],
  indexes: number[],
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }

  const imageData = context.createImageData(width, height);

  indexes.forEach((paletteIndex, pixelIndex) => {
    const color = palette[paletteIndex];
    const offset = pixelIndex * 4;

    imageData.data[offset] = color.red;
    imageData.data[offset + 1] = color.green;
    imageData.data[offset + 2] = color.blue;
    imageData.data[offset + 3] = color.alpha;
  });

  context.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}

function importSprites(): void {
  closeSpriteContextMenu();
  fileInput.value?.click();
}

function uploadSourceImage(): void {
  closeSpriteContextMenu();
  sourceFileInput.value?.click();
}

async function handleSourceImageUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  sourceImportError.value = "";
  sourceImagePixelPosition.value = null;
  if (!file) {
    return;
  }

  try {
    const [src, image] = await Promise.all([fileToDataUrl(file), loadImage(file)]);

    sourceImage.value = {
      name: file.name,
      src,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    resetSourceImageView();
  } catch (error) {
    sourceImportError.value = error instanceof Error ? error.message : "Unable to upload source image.";
  } finally {
    input.value = "";
  }
}

async function handleSpriteImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);

  importError.value = "";
  if (files.length === 0) {
    return;
  }

  try {
    const importedSprites = await Promise.all(files.map(fileToIndexedSprite));

    openedSprites.value.push(...importedSprites);
    selectedSprite.value = importedSprites[0];
  } catch (error) {
    importError.value = error instanceof Error ? error.message : "Unable to import sprite.";
  } finally {
    input.value = "";
  }
}

async function fileToIndexedSprite(file: File): Promise<IndexedSprite> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} is not an image file.`);
  }

  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  if (canvas.width === 0 || canvas.height === 0) {
    throw new Error(`${file.name} does not contain readable image dimensions.`);
  }

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Unable to read sprite image pixels.");
  }

  context.drawImage(image, 0, 0);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const palette: RgbaColor[] = [];
  const paletteLookup = new Map<string, number>();
  const indexes: number[] = [];

  for (let offset = 0; offset < pixels.length; offset += 4) {
    const color: RgbaColor = {
      red: pixels[offset],
      green: pixels[offset + 1],
      blue: pixels[offset + 2],
      alpha: pixels[offset + 3],
    };
    const key = `${color.red},${color.green},${color.blue},${color.alpha}`;
    let paletteIndex = paletteLookup.get(key);

    if (paletteIndex === undefined) {
      paletteIndex = palette.length;
      paletteLookup.set(key, paletteIndex);
      palette.push(color);
    }

    indexes.push(paletteIndex);
  }

  return {
    id: nextSpriteId++,
    name: file.name.replace(/\.[^.]+$/, "") || `Sprite ${nextSpriteId}`,
    width: canvas.width,
    height: canvas.height,
    palette,
    indexes,
    src: renderIndexedSpriteToDataUri(canvas.width, canvas.height, palette, indexes),
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Unable to load ${file.name}.`));
    };
    image.src = objectUrl;
  });
}

function fileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    return Promise.reject(new Error(`${file.name} is not an image file.`));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error(`Unable to read ${file.name}.`));
    };
    reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function handleSourcePreviewWheel(event: WheelEvent): void {
  if (!sourceImage.value) {
    return;
  }

  event.preventDefault();

  const oldZoom = sourceImageZoom.value;
  const zoomDelta = event.deltaY < 0 ? 1 : -1;
  const newZoom = clamp(oldZoom + zoomDelta, minSourceImageZoom, maxSourceImageZoom);

  if (newZoom === oldZoom) {
    return;
  }

  const previewBounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const pointerFromCenter = {
    x: event.clientX - previewBounds.left - previewBounds.width / 2,
    y: event.clientY - previewBounds.top - previewBounds.height / 2,
  };
  const zoomRatio = newZoom / oldZoom;
  const newPan = {
    x: sourceImagePan.value.x + (1 - zoomRatio) * (pointerFromCenter.x - sourceImagePan.value.x),
    y: sourceImagePan.value.y + (1 - zoomRatio) * (pointerFromCenter.y - sourceImagePan.value.y),
  };

  sourceImagePan.value = newPan;
  sourceImageZoom.value = newZoom;
  updateSourceImagePixelPosition(event, { zoom: newZoom, pan: newPan });
}

function startSourceImagePan(event: PointerEvent): void {
  if (!sourceImage.value || event.button !== 0) {
    return;
  }

  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  isSourceImagePanning.value = true;
  sourceImagePanStart.value = { x: event.clientX, y: event.clientY };
  sourceImagePanOrigin.value = { ...sourceImagePan.value };
  updateSourceImagePixelPosition(event);
}

function handleSourcePreviewPointerMove(event: PointerEvent): void {
  let view: SourceImageView | undefined;

  if (isSourceImagePanning.value && sourceImagePanStart.value && sourceImagePanOrigin.value) {
    const newPan = {
      x: sourceImagePanOrigin.value.x + event.clientX - sourceImagePanStart.value.x,
      y: sourceImagePanOrigin.value.y + event.clientY - sourceImagePanStart.value.y,
    };

    sourceImagePan.value = newPan;
    view = { zoom: sourceImageZoom.value, pan: newPan };
  }

  updateSourceImagePixelPosition(event, view);
}

function endSourceImagePan(event: PointerEvent): void {
  if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }

  isSourceImagePanning.value = false;
  sourceImagePanStart.value = null;
  sourceImagePanOrigin.value = null;
  updateSourceImagePixelPosition(event);
}

function handleSourcePreviewPointerLeave(event: PointerEvent): void {
  if (isSourceImagePanning.value) {
    updateSourceImagePixelPosition(event);
    return;
  }

  clearSourceImagePixelPosition();
}

function updateSourceImagePixelPosition(event: PointerEvent | WheelEvent, pendingView?: SourceImageView): void {
  const image = sourcePreviewImage.value;

  if (!image) {
    sourceImagePixelPosition.value = null;
    return;
  }

  const bounds = pendingView
    ? getSourceImageProjectedBounds(event.currentTarget as HTMLElement, pendingView)
    : image.getBoundingClientRect();
  const { naturalWidth, naturalHeight } = image;

  if (naturalWidth === 0 || naturalHeight === 0 || bounds.width === 0 || bounds.height === 0) {
    sourceImagePixelPosition.value = null;
    return;
  }

  const scaleX = bounds.width / naturalWidth;
  const scaleY = bounds.height / naturalHeight;
  const localX = event.clientX - bounds.left;
  const localY = event.clientY - bounds.top;

  if (localX < 0 || localY < 0 || localX >= bounds.width || localY >= bounds.height) {
    sourceImagePixelPosition.value = null;
    return;
  }

  sourceImagePixelPosition.value = {
    x: clamp(localX / scaleX, 0, naturalWidth),
    y: clamp(localY / scaleY, 0, naturalHeight),
  };
}

function getSourceImageProjectedBounds(previewElement: HTMLElement, view: SourceImageView): DOMRectReadOnly {
  const previewBounds = previewElement.getBoundingClientRect();
  const imageWidth = (sourceImage.value?.width ?? 0) * view.zoom;
  const imageHeight = (sourceImage.value?.height ?? 0) * view.zoom;

  return new DOMRectReadOnly(
    previewBounds.left + previewBounds.width / 2 - imageWidth / 2 + view.pan.x,
    previewBounds.top + previewBounds.height / 2 - imageHeight / 2 + view.pan.y,
    imageWidth,
    imageHeight,
  );
}

function clearSourceImagePixelPosition(): void {
  sourceImagePixelPosition.value = null;
}

function resetSourceImageView(): void {
  sourceImageZoom.value = 1;
  sourceImagePan.value = { x: 0, y: 0 };
  isSourceImagePanning.value = false;
  sourceImagePanStart.value = null;
  sourceImagePanOrigin.value = null;
  clearSourceImagePixelPosition();
}

function openSpriteContextMenu(event: MouseEvent, sprite: IndexedSprite): void {
  selectedSprite.value = sprite;
  spriteContextMenu.value = {
    sprite,
    x: event.clientX,
    y: event.clientY,
  };
}

function closeSpriteContextMenu(): void {
  spriteContextMenu.value = null;
}

function closeSpriteContextMenuOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    closeSpriteContextMenu();
  }
}

function removeSprite(sprite: IndexedSprite): void {
  const spriteIndex = openedSprites.value.findIndex((item) => item.id === sprite.id);
  if (spriteIndex === -1) {
    return;
  }

  openedSprites.value.splice(spriteIndex, 1);

  if (selectedSprite.value?.id === sprite.id) {
    selectedSprite.value = openedSprites.value[spriteIndex] ?? openedSprites.value[spriteIndex - 1] ?? null;
  }

  closeSpriteContextMenu();
}
</script>

<template>
  <main class="app-shell">
    <section class="main-panel">
      <Tabs v-model:value="activeTab" class="main-tabs">
        <TabList>
          <Tab value="extract-sprite">Extract Sprite</Tab>
          <Tab value="update-palette">Update Palette</Tab>
          <Tab value="edit-sprite">Edit Sprite</Tab>
        </TabList>

        <TabPanels>
          <TabPanel value="extract-sprite">
          <section class="extract-layout">
            <Panel header="Source Image" class="source-panel">
              <div
                class="source-image-placeholder"
                :class="{
                  'has-source-image': sourceImage,
                  'is-panning': isSourceImagePanning,
                }"
                @wheel="handleSourcePreviewWheel"
                @pointerdown="startSourceImagePan"
                @pointermove="handleSourcePreviewPointerMove"
                @pointerup="endSourceImagePan"
                @pointercancel="endSourceImagePan"
                @pointerleave="handleSourcePreviewPointerLeave"
              >
                <img
                  v-if="sourceImage"
                  ref="sourcePreviewImage"
                  :src="sourceImage.src"
                  :alt="sourceImage.name"
                  class="preview-fit-image source-preview-image"
                  :style="sourceImageTransformStyle"
                  draggable="false"
                />
                <span v-if="sourceImagePixelPosition" class="source-pixel-position">
                  X: {{ sourceImagePixelPosition.x.toFixed(2) }}, Y:
                  {{ sourceImagePixelPosition.y.toFixed(2) }}
                </span>
                <span v-if="!sourceImage">Upload a source image</span>
              </div>
              <div class="source-controls">
                <input
                  ref="sourceFileInput"
                  type="file"
                  class="visually-hidden"
                  accept="image/*"
                  @change="handleSourceImageUpload"
                />
                <button type="button" class="source-upload-button" @click="uploadSourceImage">
                  Upload Source Image
                </button>
                <p v-if="sourceImportError" class="import-error">{{ sourceImportError }}</p>
              </div>
            </Panel>

            <SpriteViewer
              :preview-src="selectedSprite?.src"
              :palette="selectedSprite ? selectedSprite.palette.map(colorToCss) : []"
              :width="selectedSprite?.width ?? 1"
              :height="selectedSprite?.height ?? 1"
            />
          </section>
          </TabPanel>

          <TabPanel value="update-palette">
            <div class="empty-tab">Update Palette content placeholder</div>
          </TabPanel>

          <TabPanel value="edit-sprite">
            <div class="empty-tab">Edit Sprite content placeholder</div>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>

    <aside class="right-sidebar">
      <h2 class="sidebar-title">Sprites</h2>
      <ul class="sprite-image-list">
        <li v-for="sprite in openedSprites" :key="sprite.id">
          <button
            type="button"
            class="sprite-image-item"
            :class="{ 'is-active': selectedSprite?.id === sprite.id }"
            @click="selectedSprite = sprite"
            @contextmenu.prevent="openSpriteContextMenu($event, sprite)"
            :aria-label="`Open ${sprite.name}`"
          >
            <img :src="sprite.src" :alt="sprite.name" class="sprite-thumb" />
          </button>
        </li>
      </ul>
      <div
        v-if="spriteContextMenu"
        class="sprite-context-menu"
        :style="{ left: `${spriteContextMenu.x}px`, top: `${spriteContextMenu.y}px` }"
        role="menu"
        @click.stop
      >
        <button type="button" role="menuitem" @click="removeSprite(spriteContextMenu.sprite)">
          Remove
        </button>
      </div>
      <div class="sidebar-actions">
        <input
          ref="fileInput"
          type="file"
          class="visually-hidden"
          accept="image/*"
          multiple
          @change="handleSpriteImport"
        />
        <button type="button" class="import-button" @click="importSprites">
          Import
        </button>
        <p v-if="importError" class="import-error">{{ importError }}</p>
      </div>
    </aside>
  </main>
</template>
