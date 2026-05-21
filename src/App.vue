<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Button from "primevue/button";
import InputNumber from "primevue/inputnumber";
import Panel from "primevue/panel";
import Select from "primevue/select";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import Toast from "primevue/toast";
import { useToast } from "primevue/usetoast";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
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
  sourceAction: "Extracted" | "Imported" | "Remapped";
  sourceFileName: string;
  sourceFilePath?: string;
  sourceFileDirty?: boolean;
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

type SpriteTooltip = {
  text: string;
  x: number;
  y: number;
  placement: "top" | "bottom";
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

type SourceSelectionGridLine = {
  id: string;
  start: PixelPosition;
  end: PixelPosition;
};

type UniqueColor = {
  color: RgbaColor;
  count: number;
};

type PaletteRemapRow = {
  index: number;
  sourceColor: RgbaColor;
  targetColor: RgbaColor;
};

type ColorCluster = {
  active: boolean;
  color: RgbaColor;
  count: number;
  members: number[];
  nearestDistanceSquared: number;
  nearestIndex: number | null;
};

type SourceImagePointerMode = "pan" | "draw-selection" | "drag-selection-point";
type MergeMethod = "by-distance" | "by-color-count";
type ResizePaletteMode = "reduce" | "interpolate";
type SpriteContextMenuAction = "sort-palette-by-brightness" | "save" | "save-as" | "save-palette" | "remove";

type SpriteContextMenuActionPayload = {
  action: SpriteContextMenuAction;
  spriteId: number;
};

type PngChunk = {
  type: string;
  data: Uint8Array;
};

const openedSprites = ref<IndexedSprite[]>([]);
const selectedSprite = ref<IndexedSprite | null>(null);
const activeTab = ref("extract-sprite");
const fileInput = ref<HTMLInputElement | null>(null);
const sourceFileInput = ref<HTMLInputElement | null>(null);
const paletteFileInput = ref<HTMLInputElement | null>(null);
const sourcePreviewElement = ref<HTMLElement | null>(null);
const sourcePreviewImage = ref<HTMLImageElement | null>(null);
const sourceImage = ref<SourceImage | null>(null);
const sourceImagePixelPosition = ref<PixelPosition | null>(null);
const sourceImageZoom = ref(1);
const sourceImagePan = ref<PixelPosition>({ x: 0, y: 0 });
const isSourceImagePanning = ref(false);
const sourceImagePanStart = ref<PixelPosition | null>(null);
const sourceImagePanOrigin = ref<PixelPosition | null>(null);
const sourceImagePointerMode = ref<SourceImagePointerMode | null>(null);
const sourceSelection = ref<PixelPosition[] | null>(null);
const sourceSelectionDragStart = ref<PixelPosition | null>(null);
const sourceSelectionActivePointIndex = ref<number | null>(null);
const sourceGridM = ref<number | null>(16);
const sourceGridN = ref<number | null>(16);
const mergeValue = ref<number | null>(0);
const resizePaletteMode = ref<ResizePaletteMode>("reduce");
const resizeMergeValue = ref<number | null>(0);
const resizeInterpolateColorCount = ref<number | null>(1);
const resizeInterpolateAutoSmooth = ref(false);
const paletteRemapTargets = ref<RgbaColor[]>([]);
const dedupeRemappedColors = ref(true);
const showRemapPreview = ref(false);
const showResizePreview = ref(false);
const mergeMethod = ref<MergeMethod>("by-distance");
const resizeMergeMethod = ref<MergeMethod>("by-distance");
const spriteContextMenu = ref<SpriteContextMenu | null>(null);
const spriteTooltip = ref<SpriteTooltip | null>(null);
const toast = useToast();
let nextSpriteId = 1;
let unlistenSpriteContextMenuAction: (() => void) | null = null;
let unlistenDetachedSpriteContextMenuFocusChange: (() => void) | null = null;

const minSourceImageZoom = 1;
const maxSourceImageZoom = 32;
const transparentPaletteIndex = -1;
const spriteContextMenuWindowLabel = "sprite-context-menu";
const spriteContextMenuWindowMinWidth = 192;
const spriteContextMenuActionHeight = 24;
const spriteContextMenuWindowVerticalPadding = 32;
const spriteContextMenuWindowHorizontalPadding = 72;
const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const crc32Table = createCrc32Table();
const mergeMethodOptions: { label: string; value: MergeMethod }[] = [
  { label: "By Distance", value: "by-distance" },
  { label: "By Color Count", value: "by-color-count" },
];
const resizePaletteModeOptions: { label: string; value: ResizePaletteMode }[] = [
  { label: "Reduce", value: "reduce" },
  { label: "Interpolate", value: "interpolate" },
];
const isDetachedSpriteContextMenu = window.location.hash.startsWith("#sprite-context-menu");
const detachedSpriteContextMenuParams = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
const detachedSpriteContextMenuSpriteId = Number.parseInt(detachedSpriteContextMenuParams.get("spriteId") ?? "", 10);
const detachedSpriteContextMenuCanSaveToSource = detachedSpriteContextMenuParams.get("canSaveToSource") === "1";

const sourceImageTransformStyle = computed(() => ({
  height: sourceImage.value ? `${sourceImage.value.height * sourceImageZoom.value}px` : undefined,
  transform: `translate(-50%, -50%) translate(${sourceImagePan.value.x}px, ${sourceImagePan.value.y}px)`,
  width: sourceImage.value ? `${sourceImage.value.width * sourceImageZoom.value}px` : undefined,
}));

const sourceSelectionPolygonPoints = computed(() => sourceSelection.value?.map(({ x, y }) => `${x},${y}`).join(" ") ?? "");
const sourceSelectionControlPointRadius = computed(() => 6 / sourceImageZoom.value);
const mergeValueLabel = computed(() => (mergeMethod.value === "by-distance" ? "Distance" : "Color Count"));
const resizeMergeValueLabel = computed(() => (resizeMergeMethod.value === "by-distance" ? "Distance" : "Color Count"));
const selectedSpritePaletteColorCount = computed(() => selectedSprite.value?.palette.length ?? 0);
const canApplyPaletteResize = computed(() => {
  if (!selectedSprite.value) {
    return false;
  }

  if (isResizePaletteReducing.value) {
    return true;
  }

  return (resizeInterpolateColorCount.value ?? 0) > 0;
});
const isResizePaletteReducing = computed(() => resizePaletteMode.value === "reduce");
const isResizePaletteInterpolating = computed(() => resizePaletteMode.value === "interpolate");
const paletteRemapRows = computed<PaletteRemapRow[]>(() => {
  const sprite = selectedSprite.value;
  if (!sprite) {
    return [];
  }

  return sprite.palette.map((sourceColor, index) => ({
    index,
    sourceColor,
    targetColor: paletteRemapTargets.value[index] ?? sourceColor,
  }));
});
const canApplyPaletteRemap = computed(() => {
  const sprite = selectedSprite.value;
  return Boolean(sprite && paletteRemapTargets.value.length === sprite.palette.length);
});
const updatePalettePreview = computed<{
  src?: string;
  palette: RgbaColor[];
  indexes: number[];
  width: number;
  height: number;
}>(() => {
  const sprite = selectedSprite.value;
  if (!sprite) {
    return {
      src: undefined,
      palette: [],
      indexes: [],
      width: 1,
      height: 1,
    };
  }

  if (!showRemapPreview.value || !canApplyPaletteRemap.value) {
    return {
      src: sprite.src,
      palette: sprite.palette,
      indexes: sprite.indexes,
      width: sprite.width,
      height: sprite.height,
    };
  }

  const { palette, indexes } = remapSpritePalette(sprite, paletteRemapTargets.value, dedupeRemappedColors.value);
  return {
    src: renderIndexedSpriteToDataUri(sprite.width, sprite.height, palette, indexes),
    palette,
    indexes,
    width: sprite.width,
    height: sprite.height,
  };
});
const resizePalettePreview = computed<{
  src?: string;
  palette: RgbaColor[];
  indexes: number[];
  width: number;
  height: number;
}>(() => {
  const sprite = selectedSprite.value;
  if (!sprite) {
    return {
      src: undefined,
      palette: [],
      indexes: [],
      width: 1,
      height: 1,
    };
  }

  if (!showResizePreview.value) {
    return {
      src: sprite.src,
      palette: sprite.palette,
      indexes: sprite.indexes,
      width: sprite.width,
      height: sprite.height,
    };
  }

  if (isResizePaletteReducing.value) {
    const reducedData = reduceIndexedSpritePalette(sprite);
    return {
      src: renderIndexedSpriteToDataUri(sprite.width, sprite.height, reducedData.palette, reducedData.indexes),
      palette: reducedData.palette,
      indexes: reducedData.indexes,
      width: sprite.width,
      height: sprite.height,
    };
  }

  const interpolatedData = interpolateIndexedSpritePalette(
    sprite,
    resizeInterpolateColorCount.value,
    resizeInterpolateAutoSmooth.value,
  );
  return {
    src: sprite.src,
    palette: interpolatedData.palette,
    indexes: interpolatedData.indexes,
    width: sprite.width,
    height: sprite.height,
  };
});
const sourceSelectionGridLines = computed<SourceSelectionGridLine[]>(() => {
  if (!sourceSelection.value || sourceSelection.value.length !== 4) {
    return [];
  }

  const [topLeft, topRight, bottomRight, bottomLeft] = sourceSelection.value;

  return [
    ...createSourceSelectionGridLines("vertical", sourceGridM.value, (ratio) => ({
      start: interpolatePosition(topLeft, topRight, ratio),
      end: interpolatePosition(bottomLeft, bottomRight, ratio),
    })),
    ...createSourceSelectionGridLines("horizontal", sourceGridN.value, (ratio) => ({
      start: interpolatePosition(topLeft, bottomLeft, ratio),
      end: interpolatePosition(topRight, bottomRight, ratio),
    })),
  ];
});

onMounted(() => {
  window.addEventListener("contextmenu", preventDefaultContextMenu);

  if (!isDetachedSpriteContextMenu) {
    window.addEventListener("click", closeSpriteContextMenu);
    registerSpriteContextMenuActionListener();
  } else {
    registerDetachedSpriteContextMenuFocusListener();
  }

  window.addEventListener("keydown", closeSpriteContextMenuOnEscape);
});

onBeforeUnmount(() => {
  window.removeEventListener("contextmenu", preventDefaultContextMenu);
  window.removeEventListener("click", closeSpriteContextMenu);
  window.removeEventListener("keydown", closeSpriteContextMenuOnEscape);
  unlistenSpriteContextMenuAction?.();
  unlistenDetachedSpriteContextMenuFocusChange?.();
});

watch(
  () => (selectedSprite.value ? `${selectedSprite.value.id}:${selectedSprite.value.palette.map(colorToKey).join("|")}` : ""),
  () => {
    syncPaletteRemapTargets(selectedSprite.value);
  },
  { immediate: true },
);

function colorToCss(color: RgbaColor): string {
  if (color.alpha === 255) {
    return colorToHex(color);
  }

  return `rgba(${color.red}, ${color.green}, ${color.blue}, ${(color.alpha / 255).toFixed(3)})`;
}

function colorToHex(color: RgbaColor): string {
  return `#${toHex(color.red)}${toHex(color.green)}${toHex(color.blue)}`;
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
    const color = paletteIndex === transparentPaletteIndex ? null : palette[paletteIndex];
    const offset = pixelIndex * 4;

    imageData.data[offset] = color?.red ?? 0;
    imageData.data[offset + 1] = color?.green ?? 0;
    imageData.data[offset + 2] = color?.blue ?? 0;
    imageData.data[offset + 3] = color?.alpha ?? 0;
  });

  context.putImageData(imageData, 0, 0);

  return canvas.toDataURL("image/png");
}

function createIndexedPng(sprite: IndexedSprite): Uint8Array {
  const hasTransparentPixels = sprite.indexes.includes(transparentPaletteIndex);
  const exportPalette = [...sprite.palette];
  let transparentIndex: number | null = null;

  if (hasTransparentPixels) {
    if (exportPalette.length >= 256) {
      throw new Error("Indexed PNG export supports up to 255 colors when transparent pixels are present.");
    }

    transparentIndex = exportPalette.length;
    exportPalette.push({ red: 0, green: 0, blue: 0, alpha: 0 });
  }

  if (exportPalette.length === 0) {
    transparentIndex = 0;
    exportPalette.push({ red: 0, green: 0, blue: 0, alpha: 0 });
  }

  if (exportPalette.length > 256) {
    throw new Error("Indexed PNG export supports up to 256 palette colors.");
  }

  const indexedPixels = createIndexedPngPixelData(sprite, transparentIndex);
  const chunks = [
    pngSignature,
    createPngChunk("IHDR", createPngHeaderData(sprite.width, sprite.height)),
    createPngChunk("PLTE", createPngPaletteData(exportPalette)),
  ];

  if (exportPalette.some((color) => color.alpha !== 255)) {
    chunks.push(createPngChunk("tRNS", new Uint8Array(exportPalette.map((color) => color.alpha))));
  }

  chunks.push(createPngChunk("IDAT", zlibStore(indexedPixels)));
  chunks.push(createPngChunk("IEND", new Uint8Array()));

  return concatUint8Arrays(chunks);
}

function createIndexedPngPixelData(sprite: IndexedSprite, transparentIndex: number | null): Uint8Array {
  const rowLength = sprite.width + 1;
  const data = new Uint8Array(rowLength * sprite.height);

  for (let y = 0; y < sprite.height; y += 1) {
    const rowOffset = y * rowLength;
    data[rowOffset] = 0;

    for (let x = 0; x < sprite.width; x += 1) {
      const spriteIndex = y * sprite.width + x;
      const paletteIndex = sprite.indexes[spriteIndex];

      if (paletteIndex === transparentPaletteIndex) {
        if (transparentIndex === null) {
          throw new Error("Unable to export transparent pixel without a transparent palette entry.");
        }

        data[rowOffset + x + 1] = transparentIndex;
        continue;
      }

      if (paletteIndex < 0 || paletteIndex > 255 || paletteIndex >= sprite.palette.length) {
        throw new Error("Sprite contains a pixel with an invalid palette index.");
      }

      data[rowOffset + x + 1] = paletteIndex;
    }
  }

  return data;
}

function createPngHeaderData(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13);
  writeUint32(data, 0, width);
  writeUint32(data, 4, height);
  data[8] = 8;
  data[9] = 3;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;

  return data;
}

function createPngPaletteData(palette: RgbaColor[]): Uint8Array {
  const data = new Uint8Array(palette.length * 3);

  palette.forEach((color, index) => {
    const offset = index * 3;
    data[offset] = color.red;
    data[offset + 1] = color.green;
    data[offset + 2] = color.blue;
  });

  return data;
}

function createPngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = asciiToBytes(type);
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  writeUint32(chunk, 8 + data.length, crc32(concatUint8Arrays([typeBytes, data])));

  return chunk;
}

function zlibStore(data: Uint8Array): Uint8Array {
  const blockCount = Math.max(1, Math.ceil(data.length / 65535));
  const output = new Uint8Array(2 + blockCount * 5 + data.length + 4);
  let outputOffset = 0;
  let dataOffset = 0;

  output[outputOffset++] = 0x78;
  output[outputOffset++] = 0x01;

  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    const blockLength = Math.min(65535, data.length - dataOffset);
    const isFinalBlock = blockIndex === blockCount - 1;

    output[outputOffset++] = isFinalBlock ? 1 : 0;
    output[outputOffset++] = blockLength & 0xff;
    output[outputOffset++] = (blockLength >> 8) & 0xff;
    output[outputOffset++] = (~blockLength) & 0xff;
    output[outputOffset++] = ((~blockLength) >> 8) & 0xff;
    output.set(data.subarray(dataOffset, dataOffset + blockLength), outputOffset);
    outputOffset += blockLength;
    dataOffset += blockLength;
  }

  writeUint32(output, outputOffset, adler32(data));

  return output;
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);

  for (let index = 0; index < table.length; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

function crc32(data: Uint8Array): number {
  let value = 0xffffffff;

  data.forEach((byte) => {
    value = crc32Table[(value ^ byte) & 0xff] ^ (value >>> 8);
  });

  return (value ^ 0xffffffff) >>> 0;
}

function adler32(data: Uint8Array): number {
  let first = 1;
  let second = 0;

  data.forEach((byte) => {
    first = (first + byte) % 65521;
    second = (second + first) % 65521;
  });

  return ((second << 16) | first) >>> 0;
}

function asciiToBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

function concatUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(arrays.reduce((total, array) => total + array.length, 0));
  let offset = 0;

  arrays.forEach((array) => {
    result.set(array, offset);
    offset += array.length;
  });

  return result;
}

function writeUint32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

function readUint32(data: Uint8Array, offset: number): number {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}

async function importSprites(): Promise<void> {
  closeSpriteContextMenu();

  if (isRunningInTauri()) {
    await importSpritesFromTauriDialog();
    return;
  }

  fileInput.value?.click();
}

async function importSpritesFromTauriDialog(): Promise<void> {
  try {
    const selectedPaths = await open({
      title: "Import Sprites",
      multiple: true,
      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "gif", "bmp", "webp", "avif"] }],
    });
    const paths = normalizeSelectedPaths(selectedPaths);
    if (paths.length === 0) {
      return;
    }

    const importedSprites = await Promise.all(paths.map((path) => pathToIndexedSprite(path)));
    openedSprites.value.push(...importedSprites);
    selectedSprite.value = importedSprites[0] ?? null;
  } catch (error) {
    showErrorToast("Import failed", error instanceof Error ? error.message : "Unable to import sprite.");
    fileInput.value?.click();
  }
}

function normalizeSelectedPaths(selectedPaths: string | string[] | null): string[] {
  if (!selectedPaths) {
    return [];
  }

  return (Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths]).filter((path) => path.trim().length > 0);
}

async function pathToIndexedSprite(path: string): Promise<IndexedSprite> {
  const bytes = await invoke<number[]>("read_file", { path });
  const fileName = getFileNameFromPath(path);
  const file = new File([new Uint8Array(bytes)], fileName, { type: getImageMimeType(fileName) });
  const sprite = await fileToIndexedSprite(file);
  applySpriteSourcePath(sprite, path);
  return sprite;
}

function getFileNameFromPath(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function getImageMimeType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const mimeByExtension: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
  };

  return mimeByExtension[extension] ?? "image/png";
}

function applySpriteSourcePath(sprite: IndexedSprite, path: string): void {
  sprite.sourceAction = "Imported";
  sprite.sourceFilePath = path;
  sprite.sourceFileName = getFileNameFromPath(path);
  sprite.sourceFileDirty = false;
}

function uploadSourceImage(): void {
  closeSpriteContextMenu();
  sourceFileInput.value?.click();
}

function showWarningToast(summary: string, detail: string): void {
  toast.add({
    severity: "warn",
    summary,
    detail,
    life: 3000,
  });
}

function showErrorToast(summary: string, detail: string): void {
  toast.add({
    severity: "error",
    summary,
    detail,
    life: 4000,
  });
}

function cloneColor(color: RgbaColor): RgbaColor {
  return {
    red: color.red,
    green: color.green,
    blue: color.blue,
    alpha: color.alpha,
  };
}

function syncPaletteRemapTargets(sprite: IndexedSprite | null): void {
  paletteRemapTargets.value = sprite ? sprite.palette.map(cloneColor) : [];
}

function handleRemapColorInput(index: number, event: Event): void {
  const input = event.target as HTMLInputElement | null;
  if (!input) {
    return;
  }

  updateRemapTargetColor(index, input.value);
}

function updateRemapTargetColor(index: number, value: string): void {
  const rgb = hexToRgb(value);
  const target = paletteRemapTargets.value[index];
  if (!rgb || !target) {
    return;
  }

  target.red = rgb.red;
  target.green = rgb.green;
  target.blue = rgb.blue;
}

function hexToRgb(value: string): Pick<RgbaColor, "red" | "green" | "blue"> | null {
  const hex = value.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(hex)) {
    return null;
  }

  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function remapSelectedSpritePalette(): void {
  const sprite = selectedSprite.value;
  if (!sprite || !canApplyPaletteRemap.value) {
    showWarningToast("Sprite required", "Select a sprite before remapping its palette.");
    return;
  }

  applyPaletteRemapToSprite(sprite, paletteRemapTargets.value);
  syncPaletteRemapTargets(sprite);
}

function remapSelectedSpritePaletteToNew(): void {
  const sprite = selectedSprite.value;
  if (!sprite || !canApplyPaletteRemap.value) {
    showWarningToast("Sprite required", "Select a sprite before creating a remapped copy.");
    return;
  }

  const remappedSprite = createRemappedSprite(sprite, paletteRemapTargets.value);
  openedSprites.value.push(remappedSprite);
  selectedSprite.value = remappedSprite;
}

function resizeSelectedSpritePalette(): void {
  const sprite = selectedSprite.value;
  if (!sprite || !canApplyPaletteResize.value) {
    showWarningToast("Sprite required", "Select a sprite before resizing its palette.");
    return;
  }

  if (isResizePaletteInterpolating.value) {
    const interpolatedData = interpolateIndexedSpritePalette(
      sprite,
      resizeInterpolateColorCount.value,
      resizeInterpolateAutoSmooth.value,
    );
    sprite.palette = interpolatedData.palette;
    sprite.indexes = interpolatedData.indexes;
    sprite.src = renderIndexedSpriteToDataUri(sprite.width, sprite.height, sprite.palette, sprite.indexes);
    markSpriteAsDirty(sprite);
    return;
  }

  const reducedData = reduceIndexedSpritePalette(sprite);
  sprite.palette = reducedData.palette;
  sprite.indexes = reducedData.indexes;
  sprite.src = renderIndexedSpriteToDataUri(sprite.width, sprite.height, sprite.palette, sprite.indexes);
  markSpriteAsDirty(sprite);
}

function resizeSelectedSpritePaletteToNew(): void {
  const sprite = selectedSprite.value;
  if (!sprite || !canApplyPaletteResize.value) {
    showWarningToast("Sprite required", "Select a sprite before creating a resized copy.");
    return;
  }

  if (isResizePaletteInterpolating.value) {
    const interpolatedData = interpolateIndexedSpritePalette(
      sprite,
      resizeInterpolateColorCount.value,
      resizeInterpolateAutoSmooth.value,
    );
    const interpolatedSprite: IndexedSprite = {
      ...sprite,
      id: nextSpriteId++,
      name: `${sprite.name} interpolate`,
      sourceAction: "Remapped",
      palette: interpolatedData.palette,
      indexes: interpolatedData.indexes,
      src: renderIndexedSpriteToDataUri(sprite.width, sprite.height, interpolatedData.palette, interpolatedData.indexes),
    };
    openedSprites.value.push(interpolatedSprite);
    selectedSprite.value = interpolatedSprite;
    return;
  }

  const reducedData = reduceIndexedSpritePalette(sprite);
  const reducedSprite: IndexedSprite = {
    ...sprite,
    id: nextSpriteId++,
    name: `${sprite.name} resize`,
    sourceAction: "Remapped",
    palette: reducedData.palette,
    indexes: reducedData.indexes,
    src: renderIndexedSpriteToDataUri(sprite.width, sprite.height, reducedData.palette, reducedData.indexes),
  };
  openedSprites.value.push(reducedSprite);
  selectedSprite.value = reducedSprite;
}

function reduceIndexedSpritePalette(
  sprite: IndexedSprite,
): {
  palette: RgbaColor[];
  indexes: number[];
} {
  const colorsByPixel: RgbaColor[] = [];
  sprite.indexes.forEach((paletteIndex) => {
    if (paletteIndex === transparentPaletteIndex) {
      return;
    }

    const color = sprite.palette[paletteIndex];
    if (color) {
      colorsByPixel.push(color);
    }
  });

  if (colorsByPixel.length === 0) {
    return {
      palette: sprite.palette.map(cloneColor),
      indexes: [...sprite.indexes],
    };
  }

  const reducedColors = reduceSpriteColors(colorsByPixel, resizeMergeMethod.value, resizeMergeValue.value);
  const reducedPalette: RgbaColor[] = [];
  const reducedPaletteLookup = new Map<string, number>();
  const reducedIndexes: number[] = [];
  let reducedColorIndex = 0;

  sprite.indexes.forEach((paletteIndex) => {
    if (paletteIndex === transparentPaletteIndex) {
      reducedIndexes.push(transparentPaletteIndex);
      return;
    }

    const color = reducedColors[reducedColorIndex] ?? sprite.palette[paletteIndex];
    reducedColorIndex += 1;

    const key = colorToKey(color);
    let nextPaletteIndex = reducedPaletteLookup.get(key);
    if (nextPaletteIndex === undefined) {
      nextPaletteIndex = reducedPalette.length;
      reducedPaletteLookup.set(key, nextPaletteIndex);
      reducedPalette.push(cloneColor(color));
    }

    reducedIndexes.push(nextPaletteIndex);
  });

  return {
    palette: reducedPalette,
    indexes: reducedIndexes,
  };
}

function interpolateIndexedSpritePalette(
  sprite: IndexedSprite,
  addCount: number | null,
  autoSmooth: boolean,
): {
  palette: RgbaColor[];
  indexes: number[];
} {
  const additionalColorCount = Math.max(0, Math.floor(addCount ?? 0));
  if (additionalColorCount <= 0 || sprite.palette.length < 2) {
    return {
      palette: sprite.palette.map(cloneColor),
      indexes: [...sprite.indexes],
    };
  }

  const segmentCount = sprite.palette.length - 1;
  const baseInsertCountPerSegment = Math.floor(additionalColorCount / segmentCount);
  const segmentRemainder = additionalColorCount % segmentCount;
  const insertCounts = Array.from({ length: segmentCount }, (_, segmentIndex) =>
    baseInsertCountPerSegment + (segmentIndex < segmentRemainder ? 1 : 0),
  );
  const interpolatedPalette: RgbaColor[] = [];
  const remappedPaletteIndexByOriginal = new Map<number, number>();

  for (let paletteIndex = 0; paletteIndex < sprite.palette.length; paletteIndex += 1) {
    remappedPaletteIndexByOriginal.set(paletteIndex, interpolatedPalette.length);
    interpolatedPalette.push(cloneColor(sprite.palette[paletteIndex]));

    if (paletteIndex >= segmentCount) {
      continue;
    }

    const startColor = sprite.palette[paletteIndex];
    const endColor = sprite.palette[paletteIndex + 1];
    const insertCount = insertCounts[paletteIndex];
    for (let insertedIndex = 1; insertedIndex <= insertCount; insertedIndex += 1) {
      const ratio = insertedIndex / (insertCount + 1);
      interpolatedPalette.push(interpolateColor(startColor, endColor, ratio));
    }
  }

  const remappedIndexes = autoSmooth
    ? createAutoSmoothedIndexes(sprite, remappedPaletteIndexByOriginal, insertCounts)
    : sprite.indexes.map((paletteIndex) =>
        paletteIndex === transparentPaletteIndex ? transparentPaletteIndex : (remappedPaletteIndexByOriginal.get(paletteIndex) ?? paletteIndex),
      );

  return {
    palette: interpolatedPalette,
    indexes: remappedIndexes,
  };
}

function createAutoSmoothedIndexes(
  sprite: IndexedSprite,
  remappedPaletteIndexByOriginal: Map<number, number>,
  insertCounts: number[],
): number[] {
  const { width, height } = sprite;
  const smoothedIndexes: number[] = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = y * width + x;
      const sourcePaletteIndex = sprite.indexes[pixelIndex];
      if (sourcePaletteIndex === transparentPaletteIndex) {
        smoothedIndexes.push(transparentPaletteIndex);
        continue;
      }

      // Blend palette-index position with neighborhood to push edge pixels
      // into interpolated colors while preserving large flat regions.
      let weightedSum = sourcePaletteIndex * 2;
      let weight = 2;
      const neighborOffsets = [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ];
      neighborOffsets.forEach(([dx, dy]) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          return;
        }

        const neighborPaletteIndex = sprite.indexes[ny * width + nx];
        if (neighborPaletteIndex === transparentPaletteIndex) {
          return;
        }

        weightedSum += neighborPaletteIndex;
        weight += 1;
      });

      const averagedPosition = weightedSum / weight;
      const smoothedPosition = sourcePaletteIndex + (averagedPosition - sourcePaletteIndex) * 0.5;
      smoothedIndexes.push(
        mapPalettePositionToInterpolatedIndex(smoothedPosition, sprite.palette.length, remappedPaletteIndexByOriginal, insertCounts),
      );
    }
  }

  return smoothedIndexes;
}

function mapPalettePositionToInterpolatedIndex(
  position: number,
  paletteLength: number,
  remappedPaletteIndexByOriginal: Map<number, number>,
  insertCounts: number[],
): number {
  const clampedPosition = Math.min(Math.max(position, 0), Math.max(0, paletteLength - 1));
  const lowerIndex = Math.floor(clampedPosition);
  const upperIndex = Math.ceil(clampedPosition);
  const lowerMappedIndex = remappedPaletteIndexByOriginal.get(lowerIndex) ?? lowerIndex;

  if (lowerIndex === upperIndex || lowerIndex >= insertCounts.length) {
    return lowerMappedIndex;
  }

  const ratio = clampedPosition - lowerIndex;
  const insertedCount = insertCounts[lowerIndex];
  const step = Math.round(ratio * (insertedCount + 1));
  if (step <= 0) {
    return lowerMappedIndex;
  }

  const upperMappedIndex = remappedPaletteIndexByOriginal.get(upperIndex) ?? upperIndex;
  if (step >= insertedCount + 1) {
    return upperMappedIndex;
  }

  return lowerMappedIndex + step;
}

function interpolateColor(start: RgbaColor, end: RgbaColor, ratio: number): RgbaColor {
  return {
    red: Math.round(start.red + (end.red - start.red) * ratio),
    green: Math.round(start.green + (end.green - start.green) * ratio),
    blue: Math.round(start.blue + (end.blue - start.blue) * ratio),
    alpha: Math.round(start.alpha + (end.alpha - start.alpha) * ratio),
  };
}

function loadPaletteImageForRemap(): void {
  const sprite = selectedSprite.value;
  if (!sprite) {
    showWarningToast("Sprite required", "Select a sprite before loading remap colors.");
    return;
  }

  paletteFileInput.value?.click();
}

async function handlePaletteImageUpload(event: Event): Promise<void> {
  const sprite = selectedSprite.value;
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  if (!sprite || !file) {
    input.value = "";
    return;
  }

  try {
    const loadedColors = await extractPaletteColorsFromImage(file);
    const expectedCount = sprite.palette.length;
    const usableCount = Math.min(expectedCount, loadedColors.length);

    if (loadedColors.length !== expectedCount) {
      showWarningToast(
        "Palette size mismatch",
        `Loaded ${loadedColors.length} colors, expected ${expectedCount}. Extra colors are discarded and missing colors are unchanged.`,
      );
    }

    for (let index = 0; index < usableCount; index += 1) {
      const loadedColor = loadedColors[index];
      const target = paletteRemapTargets.value[index];
      if (!target) {
        continue;
      }

      target.red = loadedColor.red;
      target.green = loadedColor.green;
      target.blue = loadedColor.blue;
    }
  } catch (error) {
    showErrorToast("Load failed", error instanceof Error ? error.message : "Unable to load palette image.");
  } finally {
    input.value = "";
  }
}

async function extractPaletteColorsFromImage(file: File): Promise<RgbaColor[]> {
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
    throw new Error("Unable to read palette image pixels.");
  }

  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const colors: RgbaColor[] = [];

  for (let offset = 0; offset < pixels.length; offset += 4) {
    colors.push({
      red: pixels[offset],
      green: pixels[offset + 1],
      blue: pixels[offset + 2],
      alpha: 255,
    });
  }

  return colors;
}

function createRemappedSprite(sprite: IndexedSprite, targets: RgbaColor[]): IndexedSprite {
  const { palette, indexes } = remapSpritePalette(sprite, targets, dedupeRemappedColors.value);

  return {
    ...sprite,
    id: nextSpriteId++,
    name: `${sprite.name} remap`,
    sourceAction: "Remapped",
    palette,
    indexes,
    src: renderIndexedSpriteToDataUri(sprite.width, sprite.height, palette, indexes),
  };
}

function applyPaletteRemapToSprite(sprite: IndexedSprite, targets: RgbaColor[]): void {
  const { palette, indexes } = remapSpritePalette(sprite, targets, dedupeRemappedColors.value);
  sprite.palette = palette;
  sprite.indexes = indexes;
  sprite.src = renderIndexedSpriteToDataUri(sprite.width, sprite.height, palette, indexes);
  markSpriteAsDirty(sprite);
}

function remapSpritePalette(
  sprite: IndexedSprite,
  targets: RgbaColor[],
  shouldDedupe: boolean,
): { palette: RgbaColor[]; indexes: number[] } {
  if (!shouldDedupe) {
    return {
      palette: sprite.palette.map((sourceColor, sourceIndex) => cloneColor(targets[sourceIndex] ?? sourceColor)),
      indexes: [...sprite.indexes],
    };
  }

  const remappedPalette: RgbaColor[] = [];
  const remappedPaletteLookup = new Map<string, number>();
  const remappedIndexByOriginal = new Map<number, number>();

  sprite.palette.forEach((sourceColor, sourceIndex) => {
    const remappedColor = cloneColor(targets[sourceIndex] ?? sourceColor);
    const key = colorToKey(remappedColor);
    let remappedIndex = remappedPaletteLookup.get(key);

    if (remappedIndex === undefined) {
      remappedIndex = remappedPalette.length;
      remappedPaletteLookup.set(key, remappedIndex);
      remappedPalette.push(remappedColor);
    }

    remappedIndexByOriginal.set(sourceIndex, remappedIndex);
  });

  const remappedIndexes = sprite.indexes.map((paletteIndex) =>
    paletteIndex === transparentPaletteIndex ? transparentPaletteIndex : (remappedIndexByOriginal.get(paletteIndex) ?? transparentPaletteIndex),
  );

  return {
    palette: remappedPalette,
    indexes: remappedIndexes,
  };
}

function extractSpriteFromSource(): void {
  if (!sourceImage.value || !sourcePreviewImage.value) {
    showWarningToast("Source image required", "Upload a source image before extracting a sprite.");
    return;
  }

  if (!sourceSelection.value || sourceSelection.value.length !== 4) {
    showWarningToast("Grid required", "Draw a grid on the source image before extracting a sprite.");
    return;
  }

  const width = getSourceGridPixelCount(sourceGridM.value);
  const height = getSourceGridPixelCount(sourceGridN.value);
  const sampledColors = sampleSourceSelectionColors(sourcePreviewImage.value, sourceSelection.value, width, height);

  if (!sampledColors) {
    showErrorToast("Extraction failed", "Unable to read source image pixels.");
    return;
  }

  const reducedColors = reduceSpriteColors(sampledColors, mergeMethod.value, mergeValue.value);
  const extractedSprite = createIndexedSpriteFromColors(
    `${sourceImage.value.name.replace(/\.[^.]+$/, "") || "Source"} extract ${nextSpriteId}`,
    sourceImage.value.name,
    width,
    height,
    reducedColors,
  );

  openedSprites.value.push(extractedSprite);
  selectedSprite.value = extractedSprite;
}

async function handleSourceImageUpload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

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
    sourceSelection.value = null;
    resetSourceImageView();
  } catch (error) {
    showErrorToast("Upload failed", error instanceof Error ? error.message : "Unable to upload source image.");
  } finally {
    input.value = "";
  }
}

async function handleSpriteImport(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);

  if (files.length === 0) {
    return;
  }

  try {
    const importedSprites = await Promise.all(files.map(fileToIndexedSprite));

    openedSprites.value.push(...importedSprites);
    selectedSprite.value = importedSprites[0];
  } catch (error) {
    showErrorToast("Import failed", error instanceof Error ? error.message : "Unable to import sprite.");
  } finally {
    input.value = "";
  }
}

async function fileToIndexedSprite(file: File): Promise<IndexedSprite> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name} is not an image file.`);
  }

  const indexedPngSprite = await fileToIndexedPngSprite(file);
  if (indexedPngSprite) {
    return indexedPngSprite;
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

    if (color.alpha !== 255) {
      indexes.push(transparentPaletteIndex);
      continue;
    }

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
    sourceAction: "Imported",
    sourceFileName: file.name,
    sourceFileDirty: false,
    width: canvas.width,
    height: canvas.height,
    palette,
    indexes,
    src: renderIndexedSpriteToDataUri(canvas.width, canvas.height, palette, indexes),
  };
}

async function fileToIndexedPngSprite(file: File): Promise<IndexedSprite | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isPng(bytes)) {
    return null;
  }

  const chunks = parsePngChunks(bytes);
  const ihdr = chunks.find((chunk) => chunk.type === "IHDR")?.data;
  const paletteChunk = chunks.find((chunk) => chunk.type === "PLTE")?.data;

  if (!ihdr || !paletteChunk) {
    return null;
  }

  const width = readUint32(ihdr, 0);
  const height = readUint32(ihdr, 4);
  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const compressionMethod = ihdr[10];
  const filterMethod = ihdr[11];
  const interlaceMethod = ihdr[12];

  if (colorType !== 3) {
    return null;
  }

  if (![1, 2, 4, 8].includes(bitDepth)) {
    throw new Error(`${file.name} uses an unsupported indexed PNG bit depth.`);
  }

  if (compressionMethod !== 0 || filterMethod !== 0 || interlaceMethod !== 0) {
    throw new Error(`${file.name} uses unsupported indexed PNG encoding options.`);
  }

  const sourcePalette = createPaletteFromPngChunks(paletteChunk, chunks.find((chunk) => chunk.type === "tRNS")?.data);
  const palette: RgbaColor[] = [];
  const paletteIndexBySourceIndex = new Map<number, number>();

  sourcePalette.forEach((color, sourceIndex) => {
    if (color.alpha !== 255) {
      return;
    }

    paletteIndexBySourceIndex.set(sourceIndex, palette.length);
    palette.push(color);
  });

  const compressedData = concatUint8Arrays(chunks.filter((chunk) => chunk.type === "IDAT").map((chunk) => chunk.data));
  const filteredRows = await inflateZlib(compressedData);
  const rowByteLength = Math.ceil((width * bitDepth) / 8);
  const rows = unfilterPngRows(filteredRows, height, rowByteLength);
  const sourceIndexes = unpackIndexedPngPixels(rows, width, height, bitDepth, rowByteLength);
  const indexes = sourceIndexes.map((sourceIndex) => paletteIndexBySourceIndex.get(sourceIndex) ?? transparentPaletteIndex);

  return {
    id: nextSpriteId++,
    name: file.name.replace(/\.[^.]+$/, "") || `Sprite ${nextSpriteId}`,
    sourceAction: "Imported",
    sourceFileName: file.name,
    sourceFileDirty: false,
    width,
    height,
    palette,
    indexes,
    src: renderIndexedSpriteToDataUri(width, height, palette, indexes),
  };
}

function isPng(bytes: Uint8Array): boolean {
  return pngSignature.every((byte, index) => bytes[index] === byte);
}

function parsePngChunks(bytes: Uint8Array): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = pngSignature.length;

  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;

    if (dataEnd + 4 > bytes.length) {
      throw new Error("PNG file is truncated.");
    }

    chunks.push({ type, data: bytes.slice(dataStart, dataEnd) });
    offset = dataEnd + 4;

    if (type === "IEND") {
      break;
    }
  }

  return chunks;
}

function createPaletteFromPngChunks(paletteData: Uint8Array, transparencyData?: Uint8Array): RgbaColor[] {
  const palette: RgbaColor[] = [];

  for (let offset = 0; offset + 2 < paletteData.length; offset += 3) {
    const index = offset / 3;
    palette.push({
      red: paletteData[offset],
      green: paletteData[offset + 1],
      blue: paletteData[offset + 2],
      alpha: transparencyData?.[index] ?? 255,
    });
  }

  return palette;
}

async function inflateZlib(data: Uint8Array): Promise<Uint8Array> {
  const dataBuffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(dataBuffer).set(data);

  const stream = new Blob([dataBuffer]).stream().pipeThrough(new DecompressionStream("deflate"));
  const buffer = await new Response(stream).arrayBuffer();

  return new Uint8Array(buffer);
}

function unfilterPngRows(data: Uint8Array, height: number, rowByteLength: number): Uint8Array {
  const expectedLength = height * (rowByteLength + 1);
  if (data.length < expectedLength) {
    throw new Error("Indexed PNG pixel data is truncated.");
  }

  const rows = new Uint8Array(rowByteLength * height);
  const bytesPerPixel = 1;

  for (let y = 0; y < height; y += 1) {
    const sourceRowOffset = y * (rowByteLength + 1);
    const targetRowOffset = y * rowByteLength;
    const filterType = data[sourceRowOffset];

    for (let x = 0; x < rowByteLength; x += 1) {
      const raw = data[sourceRowOffset + x + 1];
      const left = x >= bytesPerPixel ? rows[targetRowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? rows[targetRowOffset + x - rowByteLength] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? rows[targetRowOffset + x - rowByteLength - bytesPerPixel] : 0;

      rows[targetRowOffset + x] = (raw + getPngFilterPrediction(filterType, left, up, upLeft)) & 0xff;
    }
  }

  return rows;
}

function getPngFilterPrediction(filterType: number, left: number, up: number, upLeft: number): number {
  if (filterType === 0) {
    return 0;
  }

  if (filterType === 1) {
    return left;
  }

  if (filterType === 2) {
    return up;
  }

  if (filterType === 3) {
    return Math.floor((left + up) / 2);
  }

  if (filterType === 4) {
    return paethPredictor(left, up, upLeft);
  }

  throw new Error("Indexed PNG uses an unsupported filter type.");
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);

  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }

  return upDistance <= upLeftDistance ? up : upLeft;
}

function unpackIndexedPngPixels(
  rows: Uint8Array,
  width: number,
  height: number,
  bitDepth: number,
  rowByteLength: number,
): number[] {
  const indexes: number[] = [];
  const pixelsPerByte = 8 / bitDepth;
  const mask = (1 << bitDepth) - 1;

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowByteLength;

    for (let x = 0; x < width; x += 1) {
      const byte = rows[rowOffset + Math.floor(x / pixelsPerByte)];
      const shift = (pixelsPerByte - 1 - (x % pixelsPerByte)) * bitDepth;

      indexes.push((byte >> shift) & mask);
    }
  }

  return indexes;
}

function createIndexedSpriteFromColors(
  name: string,
  sourceFileName: string,
  width: number,
  height: number,
  colors: RgbaColor[],
): IndexedSprite {
  const palette: RgbaColor[] = [];
  const paletteLookup = new Map<string, number>();
  const indexes: number[] = [];

  colors.forEach((color) => {
    const key = colorToKey(color);
    let paletteIndex = paletteLookup.get(key);

    if (paletteIndex === undefined) {
      paletteIndex = palette.length;
      paletteLookup.set(key, paletteIndex);
      palette.push(color);
    }

    indexes.push(paletteIndex);
  });

  return {
    id: nextSpriteId++,
    name,
    sourceAction: "Extracted",
    sourceFileName,
    width,
    height,
    palette,
    indexes,
    src: renderIndexedSpriteToDataUri(width, height, palette, indexes),
  };
}

function reduceSpriteColors(colors: RgbaColor[], method: MergeMethod, value: number | null): RgbaColor[] {
  const { uniqueColors, sampleUniqueIndexes } = getUniqueColors(colors);

  if (uniqueColors.length <= 1) {
    return colors;
  }

  const targetColorCount = Math.max(1, Math.floor(value ?? 1));
  const distanceThreshold = Math.max(0, value ?? 0);

  if (method === "by-color-count" && targetColorCount >= uniqueColors.length) {
    return colors;
  }

  if (method === "by-distance" && distanceThreshold <= 0) {
    return colors;
  }

  const clusters = uniqueColors.map<ColorCluster>((uniqueColor, index) => ({
    active: true,
    color: uniqueColor.color,
    count: uniqueColor.count,
    members: [index],
    nearestDistanceSquared: Number.POSITIVE_INFINITY,
    nearestIndex: null,
  }));
  let activeClusterCount = clusters.length;

  initializeNearestColorClusters(clusters);

  while (activeClusterCount > 1) {
    const closestClusterIndex = getClosestColorClusterIndex(clusters);
    if (closestClusterIndex === null) {
      break;
    }

    const closestCluster = clusters[closestClusterIndex];
    const nearestIndex = closestCluster.nearestIndex;
    if (nearestIndex === null) {
      break;
    }

    if (method === "by-distance" && closestCluster.nearestDistanceSquared >= distanceThreshold * distanceThreshold) {
      break;
    }

    if (method === "by-color-count" && activeClusterCount <= targetColorCount) {
      break;
    }

    mergeColorClusters(clusters, closestClusterIndex, nearestIndex);
    activeClusterCount -= 1;
  }

  const reducedUniqueColors = uniqueColors.map(({ color }) => color);
  clusters.forEach((cluster) => {
    if (!cluster.active) {
      return;
    }

    cluster.members.forEach((memberIndex) => {
      reducedUniqueColors[memberIndex] = cluster.color;
    });
  });

  return sampleUniqueIndexes.map((uniqueIndex) => reducedUniqueColors[uniqueIndex]);
}

function getUniqueColors(colors: RgbaColor[]): {
  uniqueColors: UniqueColor[];
  sampleUniqueIndexes: number[];
} {
  const uniqueColors: UniqueColor[] = [];
  const colorLookup = new Map<string, number>();
  const sampleUniqueIndexes: number[] = [];

  colors.forEach((color) => {
    const key = colorToKey(color);
    let uniqueIndex = colorLookup.get(key);

    if (uniqueIndex === undefined) {
      uniqueIndex = uniqueColors.length;
      colorLookup.set(key, uniqueIndex);
      uniqueColors.push({ color, count: 0 });
    }

    uniqueColors[uniqueIndex].count += 1;
    sampleUniqueIndexes.push(uniqueIndex);
  });

  return { uniqueColors, sampleUniqueIndexes };
}

function colorToKey(color: RgbaColor): string {
  return `${color.red},${color.green},${color.blue},${color.alpha}`;
}

function initializeNearestColorClusters(clusters: ColorCluster[]): void {
  clusters.forEach((_, index) => {
    updateNearestColorCluster(clusters, index);
  });
}

function getClosestColorClusterIndex(clusters: ColorCluster[]): number | null {
  let closestClusterIndex: number | null = null;
  let closestDistanceSquared = Number.POSITIVE_INFINITY;

  clusters.forEach((cluster, index) => {
    if (!cluster.active || cluster.nearestIndex === null) {
      return;
    }

    if (cluster.nearestDistanceSquared < closestDistanceSquared) {
      closestDistanceSquared = cluster.nearestDistanceSquared;
      closestClusterIndex = index;
    }
  });

  return closestClusterIndex;
}

function mergeColorClusters(clusters: ColorCluster[], targetIndex: number, sourceIndex: number): void {
  const target = clusters[targetIndex];
  const source = clusters[sourceIndex];
  const mergedCount = target.count + source.count;

  target.color = {
    red: Math.round((target.color.red * target.count + source.color.red * source.count) / mergedCount),
    green: Math.round((target.color.green * target.count + source.color.green * source.count) / mergedCount),
    blue: Math.round((target.color.blue * target.count + source.color.blue * source.count) / mergedCount),
    alpha: Math.round((target.color.alpha * target.count + source.color.alpha * source.count) / mergedCount),
  };
  target.count = mergedCount;
  target.members.push(...source.members);
  source.active = false;
  source.nearestIndex = null;
  source.nearestDistanceSquared = Number.POSITIVE_INFINITY;

  refreshNearestColorClusters(clusters, targetIndex, sourceIndex);
}

function refreshNearestColorClusters(clusters: ColorCluster[], mergedIndex: number, inactiveIndex: number): void {
  updateNearestColorCluster(clusters, mergedIndex);

  clusters.forEach((cluster, index) => {
    if (!cluster.active || index === mergedIndex) {
      return;
    }

    if (cluster.nearestIndex === inactiveIndex || cluster.nearestIndex === mergedIndex) {
      updateNearestColorCluster(clusters, index);
      return;
    }

    const distanceToMergedCluster = getColorDistanceSquared(cluster.color, clusters[mergedIndex].color);
    if (distanceToMergedCluster < cluster.nearestDistanceSquared) {
      cluster.nearestDistanceSquared = distanceToMergedCluster;
      cluster.nearestIndex = mergedIndex;
    }
  });
}

function updateNearestColorCluster(clusters: ColorCluster[], clusterIndex: number): void {
  const cluster = clusters[clusterIndex];
  cluster.nearestDistanceSquared = Number.POSITIVE_INFINITY;
  cluster.nearestIndex = null;

  if (!cluster.active) {
    return;
  }

  clusters.forEach((candidate, candidateIndex) => {
    if (!candidate.active || candidateIndex === clusterIndex) {
      return;
    }

    const distanceSquared = getColorDistanceSquared(cluster.color, candidate.color);
    if (distanceSquared < cluster.nearestDistanceSquared) {
      cluster.nearestDistanceSquared = distanceSquared;
      cluster.nearestIndex = candidateIndex;
    }
  });
}

function getColorDistanceSquared(first: RgbaColor, second: RgbaColor): number {
  const redDistance = first.red - second.red;
  const greenDistance = first.green - second.green;
  const blueDistance = first.blue - second.blue;
  const alphaDistance = first.alpha - second.alpha;

  return (
    redDistance * redDistance +
    greenDistance * greenDistance +
    blueDistance * blueDistance +
    alphaDistance * alphaDistance
  );
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

function handleSourcePreviewPointerDown(event: PointerEvent): void {
  if (!sourceImage.value) {
    return;
  }

  if (event.button === 1 || event.button === 2) {
    startSourceImagePan(event);
    return;
  }

  if (event.button !== 0) {
    return;
  }

  const startPosition = getSourceImagePixelPosition(event, undefined, { clampToImage: true });
  if (!startPosition) {
    return;
  }

  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  sourceImagePointerMode.value = "draw-selection";
  sourceSelectionDragStart.value = startPosition;
  sourceSelection.value = createSourceSelectionRectangle(startPosition, startPosition);
  updateSourceImagePixelPosition(event);
}

function startSourceImagePan(event: PointerEvent): void {
  event.preventDefault();
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  sourceImagePointerMode.value = "pan";
  isSourceImagePanning.value = true;
  sourceImagePanStart.value = { x: event.clientX, y: event.clientY };
  sourceImagePanOrigin.value = { ...sourceImagePan.value };
  updateSourceImagePixelPosition(event);
}

function startSourceSelectionPointDrag(event: PointerEvent, pointIndex: number): void {
  if (!sourceImage.value || event.button !== 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  sourcePreviewElement.value?.setPointerCapture(event.pointerId);
  sourceImagePointerMode.value = "drag-selection-point";
  sourceSelectionActivePointIndex.value = pointIndex;
  updateSourceSelectionPoint(event);
}

function handleSourcePreviewPointerMove(event: PointerEvent): void {
  let view: SourceImageView | undefined;

  if (sourceImagePointerMode.value === "pan" && sourceImagePanStart.value && sourceImagePanOrigin.value) {
    const newPan = {
      x: sourceImagePanOrigin.value.x + event.clientX - sourceImagePanStart.value.x,
      y: sourceImagePanOrigin.value.y + event.clientY - sourceImagePanStart.value.y,
    };

    sourceImagePan.value = newPan;
    view = { zoom: sourceImageZoom.value, pan: newPan };
  }

  if (sourceImagePointerMode.value === "draw-selection" && sourceSelectionDragStart.value) {
    const endPosition = getSourceImagePixelPosition(event, undefined, { clampToImage: true });
    if (endPosition) {
      sourceSelection.value = createSourceSelectionRectangle(sourceSelectionDragStart.value, endPosition);
    }
  }

  if (sourceImagePointerMode.value === "drag-selection-point") {
    updateSourceSelectionPoint(event);
  }

  updateSourceImagePixelPosition(event, view);
}

function endSourcePreviewPointerDrag(event: PointerEvent): void {
  const previewElement = sourcePreviewElement.value ?? (event.currentTarget as HTMLElement);
  if (previewElement.hasPointerCapture(event.pointerId)) {
    previewElement.releasePointerCapture(event.pointerId);
  }

  if (sourceImagePointerMode.value === "draw-selection" && sourceSelection.value && !hasSourceSelectionArea(sourceSelection.value)) {
    sourceSelection.value = null;
  }

  sourceImagePointerMode.value = null;
  isSourceImagePanning.value = false;
  sourceImagePanStart.value = null;
  sourceImagePanOrigin.value = null;
  sourceSelectionDragStart.value = null;
  sourceSelectionActivePointIndex.value = null;
  updateSourceImagePixelPosition(event);
}

function handleSourcePreviewPointerLeave(event: PointerEvent): void {
  if (sourceImagePointerMode.value) {
    updateSourceImagePixelPosition(event);
    return;
  }

  clearSourceImagePixelPosition();
}

function createSourceSelectionRectangle(start: PixelPosition, end: PixelPosition): PixelPosition[] {
  return [
    { x: start.x, y: start.y },
    { x: end.x, y: start.y },
    { x: end.x, y: end.y },
    { x: start.x, y: end.y },
  ];
}

function hasSourceSelectionArea(points: PixelPosition[]): boolean {
  const xs = points.map(({ x }) => x);
  const ys = points.map(({ y }) => y);

  return Math.max(...xs) - Math.min(...xs) >= 1 && Math.max(...ys) - Math.min(...ys) >= 1;
}

function createSourceSelectionGridLines(
  axis: "vertical" | "horizontal",
  count: number | null,
  createLine: (ratio: number) => Omit<SourceSelectionGridLine, "id">,
): SourceSelectionGridLine[] {
  const totalLineCount = Math.max(0, Math.floor(count ?? 0));
  const interiorLineCount = Math.max(0, totalLineCount - 2);

  return Array.from({ length: interiorLineCount }, (_, index) => ({
    id: `${axis}-${index}`,
    ...createLine((index + 1) / (totalLineCount - 1)),
  }));
}

function interpolatePosition(start: PixelPosition, end: PixelPosition, ratio: number): PixelPosition {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

function getSourceGridPixelCount(count: number | null): number {
  return Math.max(2, Math.floor(count ?? 2));
}

function sampleSourceSelectionColors(
  image: HTMLImageElement,
  selection: PixelPosition[],
  width: number,
  height: number,
): RgbaColor[] | null {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;

  if (canvas.width === 0 || canvas.height === 0) {
    return null;
  }

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return null;
  }

  context.drawImage(image, 0, 0);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const colors: RgbaColor[] = [];
  const [topLeft, topRight, bottomRight, bottomLeft] = selection;

  for (let y = 0; y < height; y += 1) {
    const verticalRatio = y / (height - 1);
    const horizontalLineStart = interpolatePosition(topLeft, bottomLeft, verticalRatio);
    const horizontalLineEnd = interpolatePosition(topRight, bottomRight, verticalRatio);

    for (let x = 0; x < width; x += 1) {
      const horizontalRatio = x / (width - 1);
      const verticalLineStart = interpolatePosition(topLeft, topRight, horizontalRatio);
      const verticalLineEnd = interpolatePosition(bottomLeft, bottomRight, horizontalRatio);
      const samplePosition =
        getLineIntersection(verticalLineStart, verticalLineEnd, horizontalLineStart, horizontalLineEnd) ??
        interpolatePosition(horizontalLineStart, horizontalLineEnd, horizontalRatio);
      const sampleX = clamp(Math.floor(samplePosition.x), 0, canvas.width - 1);
      const sampleY = clamp(Math.floor(samplePosition.y), 0, canvas.height - 1);
      const offset = (sampleY * canvas.width + sampleX) * 4;

      colors.push({
        red: pixels[offset],
        green: pixels[offset + 1],
        blue: pixels[offset + 2],
        alpha: pixels[offset + 3],
      });
    }
  }

  return colors;
}

function getLineIntersection(
  firstStart: PixelPosition,
  firstEnd: PixelPosition,
  secondStart: PixelPosition,
  secondEnd: PixelPosition,
): PixelPosition | null {
  const firstDeltaX = firstEnd.x - firstStart.x;
  const firstDeltaY = firstEnd.y - firstStart.y;
  const secondDeltaX = secondEnd.x - secondStart.x;
  const secondDeltaY = secondEnd.y - secondStart.y;
  const determinant = firstDeltaX * secondDeltaY - firstDeltaY * secondDeltaX;

  if (Math.abs(determinant) < Number.EPSILON) {
    return null;
  }

  const offsetX = secondStart.x - firstStart.x;
  const offsetY = secondStart.y - firstStart.y;
  const firstRatio = (offsetX * secondDeltaY - offsetY * secondDeltaX) / determinant;

  return {
    x: firstStart.x + firstDeltaX * firstRatio,
    y: firstStart.y + firstDeltaY * firstRatio,
  };
}

function updateSourceSelectionPoint(event: PointerEvent): void {
  const pointIndex = sourceSelectionActivePointIndex.value;
  const position = getSourceImagePixelPosition(event, undefined, { clampToImage: true });

  if (pointIndex === null || !position || !sourceSelection.value) {
    return;
  }

  sourceSelection.value = sourceSelection.value.map((point, index) => (index === pointIndex ? position : point));
}

function updateSourceImagePixelPosition(event: PointerEvent | WheelEvent, pendingView?: SourceImageView): void {
  sourceImagePixelPosition.value = getSourceImagePixelPosition(event, pendingView);
}

function getSourceImagePixelPosition(
  event: PointerEvent | WheelEvent,
  pendingView?: SourceImageView,
  options: { clampToImage?: boolean } = {},
): PixelPosition | null {
  const image = sourcePreviewImage.value;

  if (!image) {
    return null;
  }

  const bounds = pendingView
    ? getSourceImageProjectedBounds(event.currentTarget as HTMLElement, pendingView)
    : image.getBoundingClientRect();
  const { naturalWidth, naturalHeight } = image;

  if (naturalWidth === 0 || naturalHeight === 0 || bounds.width === 0 || bounds.height === 0) {
    return null;
  }

  const scaleX = bounds.width / naturalWidth;
  const scaleY = bounds.height / naturalHeight;
  const localX = event.clientX - bounds.left;
  const localY = event.clientY - bounds.top;

  if (!options.clampToImage && (localX < 0 || localY < 0 || localX >= bounds.width || localY >= bounds.height)) {
    return null;
  }

  return {
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
  sourceImagePointerMode.value = null;
  isSourceImagePanning.value = false;
  sourceImagePanStart.value = null;
  sourceImagePanOrigin.value = null;
  sourceSelectionDragStart.value = null;
  sourceSelectionActivePointIndex.value = null;
  clearSourceImagePixelPosition();
}

async function openSpriteContextMenu(event: MouseEvent, sprite: IndexedSprite): Promise<void> {
  selectedSprite.value = sprite;

  if (isRunningInTauri()) {
    await openDetachedSpriteContextMenu(event, sprite);
    return;
  }

  spriteContextMenu.value = {
    sprite,
    x: event.clientX,
    y: event.clientY,
  };
}

async function openDetachedSpriteContextMenu(event: MouseEvent, sprite: IndexedSprite): Promise<void> {
  await closeDetachedSpriteContextMenuWindow();
  const canSaveToSource = canSaveSpriteToSource(sprite);
  const menuWidth = getDetachedSpriteContextMenuWidth(canSaveToSource);
  const menuHeight = getDetachedSpriteContextMenuHeight(canSaveToSource);
  const menuPosition = getDetachedSpriteContextMenuPosition(event, menuWidth, menuHeight);

  const menuWindow = new WebviewWindow(spriteContextMenuWindowLabel, {
    url: `/#sprite-context-menu?spriteId=${sprite.id}&canSaveToSource=${canSaveToSource ? "1" : "0"}`,
    title: "Sprite Menu",
    x: menuPosition.x,
    y: menuPosition.y,
    width: menuWidth,
    height: menuHeight,
    decorations: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focus: true,
  });

  menuWindow.once("tauri://error", () => {
    spriteContextMenu.value = {
      sprite,
      x: event.clientX,
      y: event.clientY,
    };
  });
}

function getDetachedSpriteContextMenuHeight(canSaveToSource: boolean): number {
  const actionCount = canSaveToSource ? 5 : 4;
  return actionCount * spriteContextMenuActionHeight + spriteContextMenuWindowVerticalPadding;
}

function getDetachedSpriteContextMenuWidth(canSaveToSource: boolean): number {
  const labels = [
    "Sort Palette by Brightness",
    ...(canSaveToSource ? ["Save"] : []),
    "Save as",
    "Save Palette",
    "Remove",
  ];
  const widestLabel = Math.max(...labels.map(measureDetachedSpriteContextMenuLabelWidth));

  return Math.max(spriteContextMenuWindowMinWidth, Math.ceil(widestLabel + spriteContextMenuWindowHorizontalPadding));
}

function measureDetachedSpriteContextMenuLabelWidth(label: string): number {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) {
    return label.length * 8;
  }

  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const bodyFontFamily = getComputedStyle(document.body).fontFamily || "sans-serif";
  context.font = `${0.78 * rootFontSize}px ${bodyFontFamily}`;

  return context.measureText(label).width;
}

function getDetachedSpriteContextMenuPosition(event: MouseEvent, menuWidth: number, menuHeight: number): PixelPosition {
  const screenBounds = getAvailableScreenBounds();
  const margin = 4;

  return {
    x: clamp(
      event.screenX,
      screenBounds.x + margin,
      screenBounds.x + screenBounds.width - menuWidth - margin,
    ),
    y: clamp(
      event.screenY,
      screenBounds.y + margin,
      screenBounds.y + screenBounds.height - menuHeight - margin,
    ),
  };
}

function getAvailableScreenBounds(): { x: number; y: number; width: number; height: number } {
  const currentScreen = window.screen as Screen & {
    availLeft?: number;
    availTop?: number;
  };

  return {
    x: currentScreen.availLeft ?? 0,
    y: currentScreen.availTop ?? 0,
    width: currentScreen.availWidth,
    height: currentScreen.availHeight,
  };
}

function preventDefaultContextMenu(event: MouseEvent): void {
  event.preventDefault();
}

async function closeDetachedSpriteContextMenuWindow(): Promise<void> {
  if (!isRunningInTauri()) {
    return;
  }

  const menuWindow = await WebviewWindow.getByLabel(spriteContextMenuWindowLabel);
  await menuWindow?.close();
}

async function registerSpriteContextMenuActionListener(): Promise<void> {
  if (!isRunningInTauri()) {
    return;
  }

  unlistenSpriteContextMenuAction = await getCurrentWindow().listen<SpriteContextMenuActionPayload>(
    "sprite-context-menu-action",
    ({ payload }) => {
      void handleSpriteContextMenuAction(payload);
    },
  );
}

async function registerDetachedSpriteContextMenuFocusListener(): Promise<void> {
  if (!isRunningInTauri()) {
    return;
  }

  unlistenDetachedSpriteContextMenuFocusChange = await getCurrentWindow().onFocusChanged(({ payload: isFocused }) => {
    if (!isFocused) {
      void closeCurrentDetachedSpriteContextMenu();
    }
  });
}

async function handleSpriteContextMenuAction(payload: SpriteContextMenuActionPayload): Promise<void> {
  const sprite = openedSprites.value.find((item) => item.id === payload.spriteId);
  if (!sprite) {
    return;
  }

  if (payload.action === "sort-palette-by-brightness") {
    sortSpritePaletteByBrightness(sprite);
    return;
  }

  if (payload.action === "save") {
    await saveSpriteToSourcePath(sprite);
    return;
  }

  if (payload.action === "save-as") {
    await saveSpriteAsIndexedPng(sprite);
    return;
  }

  if (payload.action === "save-palette") {
    await saveSpritePaletteAsIndexedPng(sprite);
    return;
  }

  removeSprite(sprite);
}

function closeSpriteContextMenu(): void {
  spriteContextMenu.value = null;
  void closeDetachedSpriteContextMenuWindow();
}

function closeSpriteContextMenuOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") {
    if (isDetachedSpriteContextMenu) {
      void closeCurrentDetachedSpriteContextMenu();
      return;
    }

    closeSpriteContextMenu();
  }
}

async function closeCurrentDetachedSpriteContextMenu(): Promise<void> {
  if (!isRunningInTauri()) {
    return;
  }

  await getCurrentWindow().close();
}

async function sendDetachedSpriteContextMenuAction(action: SpriteContextMenuAction): Promise<void> {
  if (!Number.isFinite(detachedSpriteContextMenuSpriteId) || !isRunningInTauri()) {
    return;
  }

  await getCurrentWindow().emitTo("main", "sprite-context-menu-action", {
    action,
    spriteId: detachedSpriteContextMenuSpriteId,
  });
  await closeCurrentDetachedSpriteContextMenu();
}

async function saveSpriteAsIndexedPng(sprite: IndexedSprite): Promise<void> {
  try {
    const png = createIndexedPng(sprite);

    if (isRunningInTauri()) {
      const path = await save({
        title: "Save Sprite",
        defaultPath: `${sanitizeFileName(sprite.name) || "sprite"}.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });

      if (!path) {
        return;
      }

      await invoke("save_file", { path, bytes: Array.from(png) });
      applySpriteSourcePath(sprite, path);
      markSpriteAsClean(sprite);
      closeSpriteContextMenu();
      return;
    }

    downloadSpritePng(sprite, png);
    markSpriteAsClean(sprite);
    closeSpriteContextMenu();
  } catch (error) {
    showErrorToast("Save failed", error instanceof Error ? error.message : "Unable to save sprite.");
  }
}

async function saveSpriteToSourcePath(sprite: IndexedSprite): Promise<void> {
  if (!canSaveSpriteToSource(sprite)) {
    showWarningToast("Save unavailable", "This sprite has no original import path to save back to.");
    return;
  }

  try {
    const png = createIndexedPng(sprite);
    await invoke("save_file", { path: sprite.sourceFilePath, bytes: Array.from(png) });
    markSpriteAsClean(sprite);
    closeSpriteContextMenu();
  } catch (error) {
    showErrorToast("Save failed", error instanceof Error ? error.message : "Unable to save sprite.");
  }
}

async function saveSpritePaletteAsIndexedPng(sprite: IndexedSprite): Promise<void> {
  try {
    const opaquePalette = sprite.palette.filter((color) => color.alpha === 255);
    if (opaquePalette.length === 0) {
      showWarningToast("No opaque colors", "Palette export requires at least one fully opaque color.");
      return;
    }

    const paletteSprite: IndexedSprite = {
      id: sprite.id,
      name: `${sprite.name} palette`,
      sourceAction: sprite.sourceAction,
      sourceFileName: sprite.sourceFileName,
      width: opaquePalette.length,
      height: 1,
      palette: opaquePalette,
      indexes: opaquePalette.map((_, index) => index),
      src: "",
    };
    const png = createIndexedPng(paletteSprite);

    if (isRunningInTauri()) {
      const path = await save({
        title: "Save Palette",
        defaultPath: `${sanitizeFileName(sprite.name) || "sprite"}_palette.png`,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });

      if (!path) {
        return;
      }

      await invoke("save_file", { path, bytes: Array.from(png) });
      closeSpriteContextMenu();
      return;
    }

    downloadSpritePng({ ...paletteSprite, name: `${sprite.name}_palette` }, png);
    closeSpriteContextMenu();
  } catch (error) {
    showErrorToast("Save failed", error instanceof Error ? error.message : "Unable to save sprite palette.");
  }
}

function downloadSpritePng(sprite: IndexedSprite, png: Uint8Array): void {
  const pngBuffer = new ArrayBuffer(png.byteLength);
  const link = document.createElement("a");

  new Uint8Array(pngBuffer).set(png);

  const url = URL.createObjectURL(new Blob([pngBuffer], { type: "image/png" }));
  link.href = url;
  link.download = `${sanitizeFileName(sprite.name) || "sprite"}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
}

function getSpriteTooltip(sprite: IndexedSprite): string {
  const base = `${sprite.id}: ${sprite.sourceAction} from ${sprite.sourceFileName}`;
  return sprite.sourceFilePath ? `${base} (${sprite.sourceFilePath})` : base;
}

function canSaveSpriteToSource(sprite: IndexedSprite): boolean {
  return sprite.sourceAction === "Imported" && Boolean(sprite.sourceFilePath?.trim());
}

function markSpriteAsDirty(sprite: IndexedSprite): void {
  if (canSaveSpriteToSource(sprite)) {
    sprite.sourceFileDirty = true;
  }
}

function markSpriteAsClean(sprite: IndexedSprite): void {
  if (canSaveSpriteToSource(sprite)) {
    sprite.sourceFileDirty = false;
  }
}

function getSpriteSourceIndicatorIcon(sprite: IndexedSprite): string {
  return sprite.sourceFileDirty ? "pi-exclamation-circle" : "pi-check-circle";
}

function showSpriteTooltip(event: MouseEvent | FocusEvent, sprite: IndexedSprite): void {
  const element = event.currentTarget;
  if (!(element instanceof HTMLElement)) {
    return;
  }

  const margin = 8;
  const maxTooltipWidth = Math.min(288, window.innerWidth - margin * 2);
  const bounds = element.getBoundingClientRect();
  const placement = bounds.top >= 40 ? "top" : "bottom";

  spriteTooltip.value = {
    text: getSpriteTooltip(sprite),
    x: clamp(bounds.left + bounds.width / 2, margin + maxTooltipWidth / 2, window.innerWidth - margin - maxTooltipWidth / 2),
    y: placement === "top" ? bounds.top - 6 : bounds.bottom + 6,
    placement,
  };
}

function hideSpriteTooltip(): void {
  spriteTooltip.value = null;
}

function isRunningInTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function sortSpritePaletteByBrightness(sprite: IndexedSprite): void {
  const paletteEntries = sprite.palette.map((color, index) => ({
    color,
    index,
    brightness: getColorBrightness(color),
  }));
  const sortedPaletteEntries = [...paletteEntries].sort((first, second) => {
    const brightnessDifference = first.brightness - second.brightness;

    return brightnessDifference === 0 ? first.index - second.index : brightnessDifference;
  });
  const newIndexByOldIndex = new Map<number, number>();

  sortedPaletteEntries.forEach(({ index }, newIndex) => {
    newIndexByOldIndex.set(index, newIndex);
  });

  sprite.palette = sortedPaletteEntries.map(({ color }) => color);
  sprite.indexes = sprite.indexes.map((index) => newIndexByOldIndex.get(index) ?? index);
  sprite.src = renderIndexedSpriteToDataUri(sprite.width, sprite.height, sprite.palette, sprite.indexes);
  markSpriteAsDirty(sprite);
  closeSpriteContextMenu();
}

function getColorBrightness(color: RgbaColor): number {
  return color.red * 0.2126 + color.green * 0.7152 + color.blue * 0.0722;
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
  <Toast />
  <main v-if="isDetachedSpriteContextMenu" class="detached-sprite-context-menu" @contextmenu.prevent>
    <Button
      type="button"
      text
      label="Sort Palette by Brightness"
      class="sprite-context-menu-action"
      @click="sendDetachedSpriteContextMenuAction('sort-palette-by-brightness')"
    />
    <Button
      v-if="detachedSpriteContextMenuCanSaveToSource"
      type="button"
      text
      label="Save"
      class="sprite-context-menu-action"
      @click="sendDetachedSpriteContextMenuAction('save')"
    />
    <Button
      type="button"
      text
      label="Save as"
      class="sprite-context-menu-action"
      @click="sendDetachedSpriteContextMenuAction('save-as')"
    />
    <Button
      type="button"
      text
      label="Save Palette"
      class="sprite-context-menu-action"
      @click="sendDetachedSpriteContextMenuAction('save-palette')"
    />
    <Button
      type="button"
      text
      label="Remove"
      class="sprite-context-menu-action"
      @click="sendDetachedSpriteContextMenuAction('remove')"
    />
  </main>
  <main v-else class="app-shell">
    <section class="main-panel">
      <Tabs v-model:value="activeTab" class="main-tabs">
        <TabList>
          <Tab value="extract-sprite">Extract Sprite</Tab>
          <Tab value="update-palette">Update Palette</Tab>
          <Tab value="resize-palette">Resize Palette</Tab>
        </TabList>

        <TabPanels>
          <TabPanel value="extract-sprite">
          <section class="extract-layout">
            <Panel header="Source Image" class="source-panel">
              <div
                ref="sourcePreviewElement"
                class="source-image-placeholder"
                :class="{
                  'has-source-image': sourceImage,
                  'is-panning': isSourceImagePanning,
                }"
                @wheel="handleSourcePreviewWheel"
                @pointerdown="handleSourcePreviewPointerDown"
                @pointermove="handleSourcePreviewPointerMove"
                @pointerup="endSourcePreviewPointerDrag"
                @pointercancel="endSourcePreviewPointerDrag"
                @pointerleave="handleSourcePreviewPointerLeave"
                @contextmenu.prevent
              >
                <div
                  v-if="sourceImage"
                  class="source-image-transform-layer"
                  :style="sourceImageTransformStyle"
                >
                  <img
                    ref="sourcePreviewImage"
                    :src="sourceImage.src"
                    :alt="sourceImage.name"
                    class="source-preview-image"
                    draggable="false"
                  />
                  <svg
                    v-if="sourceSelection"
                    class="source-selection-overlay"
                    :viewBox="`0 0 ${sourceImage.width} ${sourceImage.height}`"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <polygon class="source-selection-shape" :points="sourceSelectionPolygonPoints" />
                    <line
                      v-for="line in sourceSelectionGridLines"
                      :key="line.id"
                      class="source-selection-grid-line"
                      :x1="line.start.x"
                      :y1="line.start.y"
                      :x2="line.end.x"
                      :y2="line.end.y"
                      vector-effect="non-scaling-stroke"
                    />
                    <circle
                      v-for="(point, pointIndex) in sourceSelection"
                      :key="pointIndex"
                      class="source-selection-control-point"
                      :cx="point.x"
                      :cy="point.y"
                      :r="sourceSelectionControlPointRadius"
                      vector-effect="non-scaling-stroke"
                      @pointerdown="startSourceSelectionPointDrag($event, pointIndex)"
                    />
                  </svg>
                </div>
                <span v-if="sourceImagePixelPosition" class="source-pixel-position">
                  X: {{ sourceImagePixelPosition.x.toFixed(2) }}, Y:
                  {{ sourceImagePixelPosition.y.toFixed(2) }}
                </span>
                <span v-if="!sourceImage">Upload a source image</span>
              </div>
              <div class="source-controls">
                <div class="source-grid-controls" aria-label="Source image grid controls">
                  <label>
                    <span>Vertical Lines</span>
                    <InputNumber v-model="sourceGridM" :min="2" :max="256" show-buttons />
                  </label>
                  <label>
                    <span>Horizontal Lines</span>
                    <InputNumber v-model="sourceGridN" :min="2" :max="256" show-buttons />
                  </label>
                </div>
                <div class="source-merge-controls" aria-label="Source image merge controls">
                  <label>
                    <span>{{ mergeValueLabel }}</span>
                    <InputNumber v-model="mergeValue" :min="mergeMethod === 'by-color-count' ? 1 : 0" show-buttons />
                  </label>
                  <label>
                    <span>Merge Method</span>
                    <Select
                      v-model="mergeMethod"
                      :options="mergeMethodOptions"
                      option-label="label"
                      option-value="value"
                    />
                  </label>
                </div>
                <input
                  ref="sourceFileInput"
                  type="file"
                  class="visually-hidden"
                  accept="image/*"
                  @change="handleSourceImageUpload"
                />
                <div class="source-action-buttons">
                  <Button type="button" label="Upload Source" @click="uploadSourceImage" />
                  <Button type="button" label="Extract Sprite" @click="extractSpriteFromSource" />
                </div>
              </div>
            </Panel>

            <SpriteViewer
              :preview-src="selectedSprite?.src"
              :palette="selectedSprite ? selectedSprite.palette.map((color) => ({ color: colorToCss(color), label: colorToHex(color) })) : []"
              :indexes="selectedSprite?.indexes ?? []"
              :width="selectedSprite?.width ?? 1"
              :height="selectedSprite?.height ?? 1"
            />
          </section>
          </TabPanel>

          <TabPanel value="update-palette">
            <section class="update-palette-layout">
              <SpriteViewer
                :preview-src="updatePalettePreview.src"
                :palette="updatePalettePreview.palette.map((color) => ({ color: colorToCss(color), label: colorToHex(color) }))"
                :indexes="updatePalettePreview.indexes"
                :width="updatePalettePreview.width"
                :height="updatePalettePreview.height"
              />

              <Panel header="Color Mapping" class="palette-remap-panel">
                <div v-if="selectedSprite" class="palette-remap-content">
                  <ul class="palette-remap-list" aria-label="Palette color remap list">
                    <li v-for="row in paletteRemapRows" :key="row.index" class="palette-remap-row">
                      <div class="palette-remap-color">
                        <span class="palette-remap-swatch" :style="{ backgroundColor: colorToCss(row.sourceColor) }" />
                        <span class="palette-remap-label">{{ row.index }}: {{ colorToHex(row.sourceColor) }}</span>
                      </div>
                      <span class="palette-remap-arrow" aria-hidden="true">→</span>
                      <div class="palette-remap-target">
                        <input
                          type="color"
                          class="palette-remap-input"
                          :value="colorToHex(row.targetColor)"
                          @input="handleRemapColorInput(row.index, $event)"
                        />
                        <span class="palette-remap-label">{{ colorToHex(row.targetColor) }}</span>
                      </div>
                    </li>
                  </ul>
                  <div class="palette-remap-controls">
                    <input
                      ref="paletteFileInput"
                      type="file"
                      class="visually-hidden"
                      accept="image/*"
                      @change="handlePaletteImageUpload"
                    />
                    <Button type="button" label="Load Palette" :disabled="!canApplyPaletteRemap" @click="loadPaletteImageForRemap" />
                    <label class="palette-remap-toggle">
                      <input v-model="showRemapPreview" type="checkbox" />
                      <span>Preview</span>
                    </label>
                    <label class="palette-remap-toggle">
                      <input v-model="dedupeRemappedColors" type="checkbox" />
                      <span>Dedupe remapped colors</span>
                    </label>
                    <div class="palette-remap-actions">
                      <Button type="button" label="Remap" :disabled="!canApplyPaletteRemap" @click="remapSelectedSpritePalette" />
                      <Button
                        type="button"
                        label="Remap to New"
                        :disabled="!canApplyPaletteRemap"
                        @click="remapSelectedSpritePaletteToNew"
                      />
                    </div>
                  </div>
                </div>
                <div v-else class="empty-tab palette-remap-empty">Select a sprite to update palette</div>
              </Panel>
            </section>
          </TabPanel>

          <TabPanel value="resize-palette">
            <section class="update-palette-layout">
              <SpriteViewer
                :preview-src="resizePalettePreview.src"
                :palette="resizePalettePreview.palette.map((color) => ({ color: colorToCss(color), label: colorToHex(color) }))"
                :indexes="resizePalettePreview.indexes"
                :width="resizePalettePreview.width"
                :height="resizePalettePreview.height"
              />

              <Panel header="Palette Resizing" class="palette-remap-panel">
                <div v-if="selectedSprite" class="palette-remap-content">
                  <div class="source-merge-controls" aria-label="Palette resizing controls">
                    <label>
                      <span>Original Color Count</span>
                      <InputNumber :model-value="selectedSpritePaletteColorCount" disabled />
                    </label>
                    <label>
                      <span>Mode</span>
                      <Select
                        v-model="resizePaletteMode"
                        :options="resizePaletteModeOptions"
                        option-label="label"
                        option-value="value"
                      />
                    </label>
                  </div>

                  <div class="palette-resize-options">
                    <Panel v-if="isResizePaletteReducing" header="Reduce Colors" class="palette-resize-options-panel">
                      <div class="source-merge-controls" aria-label="Reduce color merge controls">
                        <label>
                          <span>{{ resizeMergeValueLabel }}</span>
                          <InputNumber v-model="resizeMergeValue" :min="resizeMergeMethod === 'by-color-count' ? 1 : 0" show-buttons />
                        </label>
                        <label>
                          <span>Merge Method</span>
                          <Select
                            v-model="resizeMergeMethod"
                            :options="mergeMethodOptions"
                            option-label="label"
                            option-value="value"
                          />
                        </label>
                      </div>
                    </Panel>

                    <Panel v-else-if="isResizePaletteInterpolating" header="Interpolate Colors" class="palette-resize-options-panel">
                      <div class="source-merge-controls" aria-label="Interpolate color controls">
                        <label>
                          <span>Add Colors</span>
                          <InputNumber v-model="resizeInterpolateColorCount" :min="1" :max="255" show-buttons />
                        </label>
                        <label class="palette-remap-toggle">
                          <input v-model="resizeInterpolateAutoSmooth" type="checkbox" />
                          <span>Auto Smooth</span>
                        </label>
                      </div>
                    </Panel>
                  </div>

                  <div class="palette-remap-controls">
                    <label class="palette-remap-toggle">
                      <input v-model="showResizePreview" type="checkbox" />
                      <span>Preview</span>
                    </label>
                    <div class="palette-remap-actions">
                      <Button type="button" label="Resize" :disabled="!canApplyPaletteResize" @click="resizeSelectedSpritePalette" />
                      <Button
                        type="button"
                        label="Resize to New"
                        :disabled="!canApplyPaletteResize"
                        @click="resizeSelectedSpritePaletteToNew"
                      />
                    </div>
                  </div>
                </div>
                <div v-else class="empty-tab palette-remap-empty">Select a sprite to resize palette</div>
              </Panel>
            </section>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </section>

    <aside class="right-sidebar">
      <ul class="sprite-image-list" @scroll="hideSpriteTooltip">
        <li v-for="sprite in openedSprites" :key="sprite.id">
          <button
            type="button"
            class="sprite-image-item"
            :class="{ 'is-active': selectedSprite?.id === sprite.id }"
            @click="selectedSprite = sprite"
            @mouseenter="showSpriteTooltip($event, sprite)"
            @mouseleave="hideSpriteTooltip"
            @focus="showSpriteTooltip($event, sprite)"
            @blur="hideSpriteTooltip"
            @contextmenu.prevent="openSpriteContextMenu($event, sprite)"
            :aria-label="`Open ${sprite.name}. ${getSpriteTooltip(sprite)}`"
          >
            <img :src="sprite.src" :alt="sprite.name" class="sprite-thumb" />
            <span
              v-if="canSaveSpriteToSource(sprite)"
              class="sprite-source-path-indicator pi"
              :class="getSpriteSourceIndicatorIcon(sprite)"
              aria-hidden="true"
            />
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
        <Button
          type="button"
          role="menuitem"
          text
          label="Sort Palette by Brightness"
          class="sprite-context-menu-action"
          @click="sortSpritePaletteByBrightness(spriteContextMenu.sprite)"
        />
        <Button
          v-if="canSaveSpriteToSource(spriteContextMenu.sprite)"
          type="button"
          role="menuitem"
          text
          label="Save"
          class="sprite-context-menu-action"
          @click="saveSpriteToSourcePath(spriteContextMenu.sprite)"
        />
        <Button
          type="button"
          role="menuitem"
          text
          label="Save as"
          class="sprite-context-menu-action"
          @click="saveSpriteAsIndexedPng(spriteContextMenu.sprite)"
        />
        <Button
          type="button"
          role="menuitem"
          text
          label="Save Palette"
          class="sprite-context-menu-action"
          @click="saveSpritePaletteAsIndexedPng(spriteContextMenu.sprite)"
        />
        <Button
          type="button"
          role="menuitem"
          text
          label="Remove"
          class="sprite-context-menu-action"
          @click="removeSprite(spriteContextMenu.sprite)"
        />
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
        <Button type="button" label="Import" @click="importSprites" />
      </div>
    </aside>
    <span
      v-if="spriteTooltip"
      class="sprite-image-tooltip"
      :class="{ 'is-below': spriteTooltip.placement === 'bottom' }"
      :style="{ left: `${spriteTooltip.x}px`, top: `${spriteTooltip.y}px` }"
      role="tooltip"
    >
      {{ spriteTooltip.text }}
    </span>
  </main>
</template>
