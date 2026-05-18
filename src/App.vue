<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
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
};

const openedSprites = ref<IndexedSprite[]>([]);
const selectedSprite = ref<IndexedSprite | null>(null);
const activeTab = ref("extract-sprite");
const fileInput = ref<HTMLInputElement | null>(null);
const sourceFileInput = ref<HTMLInputElement | null>(null);
const sourceImage = ref<SourceImage | null>(null);
const importError = ref("");
const sourceImportError = ref("");
const spriteContextMenu = ref<SpriteContextMenu | null>(null);
let nextSpriteId = 1;

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
  if (!file) {
    return;
  }

  try {
    sourceImage.value = {
      name: file.name,
      src: await fileToDataUrl(file),
    };
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
              <div class="source-image-placeholder">
                <img
                  v-if="sourceImage"
                  :src="sourceImage.src"
                  :alt="sourceImage.name"
                  class="preview-fit-image"
                />
                <span v-else>Upload a source image</span>
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
