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
import SpriteEditor from "./components/SpriteEditor.vue";
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
  undoStack: SpriteHistoryEntry[];
  redoStack: SpriteHistoryEntry[];
};

type SpriteSnapshot = {
  palette: RgbaColor[];
  indexes: number[];
};

type SpriteHistoryEntry = {
  snapshot: SpriteSnapshot;
  operationName: string;
};

type SpriteHistoryTimelineEntry = {
  timelineIndex: number;
  kind: "undo" | "current" | "redo";
  label: string;
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

type AutoSmoothSettings = {
  centerWeight?: number | null;
  neighborWeight?: number | null;
  blendStrength?: number | null;
  includeDiagonalNeighbors?: boolean;
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
type EditTool = "pencil" | "brush" | "eraser";
type SpriteContextMenuAction =
  | "undo"
  | "redo"
  | "sort-palette-by-brightness"
  | "save"
  | "save-as"
  | "save-palette"
  | "remove";

type SpriteEditorPaintPayload = {
  x: number;
  y: number;
};

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
const resizeInterpolateSmoothCenterWeight = ref<number | null>(2);
const resizeInterpolateSmoothNeighborWeight = ref<number | null>(1);
const resizeInterpolateSmoothBlendStrength = ref<number | null>(0.5);
const resizeInterpolateSmoothIncludeDiagonalNeighbors = ref(false);
const editTool = ref<EditTool>("pencil");
const editStrokeRadius = ref(1);
const editForegroundPaletteIndex = ref(0);
const activeEditStrokeSnapshot = ref<SpriteSnapshot | null>(null);
const activeEditStrokeSpriteId = ref<number | null>(null);
const paletteRemapTargets = ref<RgbaColor[]>([]);
const dedupeRemappedColors = ref(true);
const showRemapPreview = ref(false);
const showResizePreview = ref(false);
const mergeMethod = ref<MergeMethod>("by-distance");
const resizeMergeMethod = ref<MergeMethod>("by-distance");
const spriteContextMenu = ref<SpriteContextMenu | null>(null);
const spriteTooltip = ref<SpriteTooltip | null>(null);
const spriteFileDropActive = ref(false);
const spriteFileDropDepth = ref(0);
const toast = useToast();
let nextSpriteId = 1;
let unlistenSpriteContextMenuAction: (() => void) | null = null;
let unlistenDetachedSpriteContextMenuFocusChange: (() => void) | null = null;
let unlistenSpriteFileDrop: (() => void) | null = null;

const minSourceImageZoom = 1;
const maxSourceImageZoom = 32;
const transparentPaletteIndex = -1;
const spriteImageExtensions = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "webp"]);
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
const detachedSpriteContextMenuCanUndo = detachedSpriteContextMenuParams.get("canUndo") === "1";
const detachedSpriteContextMenuCanRedo = detachedSpriteContextMenuParams.get("canRedo") === "1";

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
const editPaletteSwatches = computed<{ label: string; value: number; color: string }[]>(() => {
  const sprite = selectedSprite.value;
  if (!sprite) {
    return [];
  }

  return sprite.palette.map((color, index) => ({
    label: `${index}: ${colorToHex(color)}`,
    value: index,
    color: colorToCss(color),
  }));
});
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
  mergedPaletteIndices: number[];
  insertedPaletteIndices: number[];
}>(() => {
  const sprite = selectedSprite.value;
  if (!sprite) {
    return {
      src: undefined,
      palette: [],
      indexes: [],
      width: 1,
      height: 1,
      mergedPaletteIndices: [],
      insertedPaletteIndices: [],
    };
  }

  if (!showResizePreview.value) {
    return {
      src: sprite.src,
      palette: sprite.palette,
      indexes: sprite.indexes,
      width: sprite.width,
      height: sprite.height,
      mergedPaletteIndices: [],
      insertedPaletteIndices: [],
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
      mergedPaletteIndices: reducedData.mergedPaletteIndices,
      insertedPaletteIndices: [],
    };
  }

  const interpolatedData = interpolateIndexedSpritePalette(
    sprite,
    resizeInterpolateColorCount.value,
    resizeInterpolateAutoSmooth.value,
    getResizeInterpolateAutoSmoothSettings(),
  );
  return {
    src: renderIndexedSpriteToDataUri(sprite.width, sprite.height, interpolatedData.palette, interpolatedData.indexes),
    palette: interpolatedData.palette,
    indexes: interpolatedData.indexes,
    width: sprite.width,
    height: sprite.height,
    mergedPaletteIndices: [],
    insertedPaletteIndices: interpolatedData.insertedPaletteIndices,
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
const selectedSpriteHistoryCurrentIndex = computed(() => selectedSprite.value?.undoStack.length ?? -1);
const selectedSpriteHistoryTimeline = computed<SpriteHistoryTimelineEntry[]>(() => {
  const sprite = selectedSprite.value;
  if (!sprite) {
    return [];
  }

  const currentIndex = sprite.undoStack.length;
  const entries: SpriteHistoryTimelineEntry[] = sprite.undoStack.map((entry, timelineIndex) => ({
    timelineIndex,
    kind: "undo",
    label: `Undo ${currentIndex - timelineIndex}: ${entry.operationName}`,
  }));

  entries.push({
    timelineIndex: currentIndex,
    kind: "current",
    label: "Current",
  });

  [...sprite.redoStack].reverse().forEach((entry, redoOffset) => {
    entries.push({
      timelineIndex: currentIndex + redoOffset + 1,
      kind: "redo",
      label: `Redo ${redoOffset + 1}: ${entry.operationName}`,
    });
  });

  return entries;
});

onMounted(() => {
  window.addEventListener("contextmenu", preventDefaultContextMenu);

  if (!isDetachedSpriteContextMenu) {
    window.addEventListener("click", closeSpriteContextMenu);
    registerSpriteContextMenuActionListener();
    void registerSpriteFileDropListener();
  } else {
    registerDetachedSpriteContextMenuFocusListener();
  }

  window.addEventListener("keydown", closeSpriteContextMenuOnEscape);
});

onBeforeUnmount(() => {
  finalizeActiveEditStroke();
  window.removeEventListener("contextmenu", preventDefaultContextMenu);
  window.removeEventListener("click", closeSpriteContextMenu);
  window.removeEventListener("keydown", closeSpriteContextMenuOnEscape);
  unlistenSpriteContextMenuAction?.();
  unlistenDetachedSpriteContextMenuFocusChange?.();
  unlistenSpriteFileDrop?.();
});

watch(
  () => (selectedSprite.value ? `${selectedSprite.value.id}:${selectedSprite.value.palette.map(colorToKey).join("|")}` : ""),
  () => {
    syncPaletteRemapTargets(selectedSprite.value);
    syncEditorPaletteSelection(selectedSprite.value);
  },
  { immediate: true },
);

watch(
  () => selectedSprite.value?.id ?? null,
  () => {
    finalizeActiveEditStroke();
  },
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
    await importSpritesFromPaths(normalizeSelectedPaths(selectedPaths));
  } catch (error) {
    showErrorToast("Import failed", error instanceof Error ? error.message : "Unable to import sprite.");
    fileInput.value?.click();
  }
}

async function importSpritesFromPaths(paths: string[]): Promise<void> {
  closeSpriteContextMenu();

  const imagePaths = filterImagePaths(paths);
  if (imagePaths.length === 0) {
    return;
  }

  try {
    const importedSprites = await Promise.all(imagePaths.map((path) => pathToIndexedSprite(path)));
    openedSprites.value.push(...importedSprites);
    selectedSprite.value = importedSprites[0] ?? null;
  } catch (error) {
    showErrorToast("Import failed", error instanceof Error ? error.message : "Unable to import sprite.");
  }
}

async function importSpritesFromFiles(files: File[]): Promise<void> {
  closeSpriteContextMenu();

  const imageFiles = files.filter(isImageFile);
  if (imageFiles.length === 0) {
    return;
  }

  try {
    const importedSprites = await Promise.all(imageFiles.map(fileToIndexedSprite));
    openedSprites.value.push(...importedSprites);
    selectedSprite.value = importedSprites[0] ?? null;
  } catch (error) {
    showErrorToast("Import failed", error instanceof Error ? error.message : "Unable to import sprite.");
  }
}

function filterImagePaths(paths: string[]): string[] {
  return paths.filter(isImagePath);
}

function isImagePath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase() ?? "";
  return spriteImageExtensions.has(extension);
}

function isImageFile(file: File): boolean {
  if (file.type.startsWith("image/")) {
    return true;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return spriteImageExtensions.has(extension);
}

function hasImageFilesInDataTransfer(event: DragEvent): boolean {
  const items = event.dataTransfer?.items;
  if (!items) {
    return false;
  }

  return Array.from(items).some((item) => {
    if (item.kind !== "file") {
      return false;
    }

    if (item.type.startsWith("image/")) {
      return true;
    }

    const file = item.getAsFile();
    return file ? isImageFile(file) : false;
  });
}

function handleWindowDragEnter(event: DragEvent): void {
  if (isRunningInTauri() || !hasImageFilesInDataTransfer(event)) {
    return;
  }

  event.preventDefault();
  spriteFileDropDepth.value += 1;
  spriteFileDropActive.value = true;
}

function handleWindowDragOver(event: DragEvent): void {
  if (isRunningInTauri() || !hasImageFilesInDataTransfer(event)) {
    return;
  }

  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function handleWindowDragLeave(): void {
  if (isRunningInTauri()) {
    return;
  }

  spriteFileDropDepth.value = Math.max(0, spriteFileDropDepth.value - 1);
  if (spriteFileDropDepth.value === 0) {
    spriteFileDropActive.value = false;
  }
}

async function handleWindowDrop(event: DragEvent): Promise<void> {
  if (isRunningInTauri()) {
    return;
  }

  event.preventDefault();
  spriteFileDropDepth.value = 0;
  spriteFileDropActive.value = false;

  const files = Array.from(event.dataTransfer?.files ?? []);
  await importSpritesFromFiles(files);
}

async function registerSpriteFileDropListener(): Promise<void> {
  if (!isRunningInTauri()) {
    return;
  }

  unlistenSpriteFileDrop = await getCurrentWindow().onDragDropEvent((event) => {
    const payload = event.payload;
    if (payload.type === "enter") {
      spriteFileDropActive.value = filterImagePaths(payload.paths).length > 0;
      return;
    }

    if (payload.type === "leave") {
      spriteFileDropActive.value = false;
      return;
    }

    if (payload.type === "drop") {
      spriteFileDropActive.value = false;
      void importSpritesFromPaths(payload.paths);
    }
  });
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

function syncEditorPaletteSelection(sprite: IndexedSprite | null): void {
  const maxPaletteIndex = (sprite?.palette.length ?? 0) - 1;
  editForegroundPaletteIndex.value = clamp(editForegroundPaletteIndex.value, transparentPaletteIndex, maxPaletteIndex);

  if (!sprite || sprite.palette.length === 0) {
    editForegroundPaletteIndex.value = transparentPaletteIndex;
    return;
  }

  if (editForegroundPaletteIndex.value === transparentPaletteIndex) {
    editForegroundPaletteIndex.value = 0;
  }
}

function setEditTool(tool: EditTool): void {
  editTool.value = tool;
}

function setEditPaletteIndex(paletteIndex: number): void {
  const sprite = selectedSprite.value;
  const maxPaletteIndex = (sprite?.palette.length ?? 0) - 1;
  editForegroundPaletteIndex.value = clamp(paletteIndex, transparentPaletteIndex, maxPaletteIndex);
}

function isSelectedEditPalette(paletteIndex: number): boolean {
  return editForegroundPaletteIndex.value === paletteIndex;
}

function handleEditSwatchPointerDown(event: PointerEvent, paletteIndex: number): void {
  if (event.button !== 0) {
    return;
  }

  setEditPaletteIndex(paletteIndex);
}

function editPaletteColor(index: number): void {
  const sprite = selectedSprite.value;
  if (!sprite) {
    return;
  }

  const color = sprite.palette[index];
  if (!color) {
    return;
  }

  const input = document.createElement("input");
  input.type = "color";
  input.value = colorToHex(color);
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.append(input);

  input.addEventListener(
    "input",
    () => {
      const rgb = hexToRgb(input.value);
      if (!rgb) {
        return;
      }

      commitSpriteMutation(sprite, "Edit Palette Color", () => {
        color.red = rgb.red;
        color.green = rgb.green;
        color.blue = rgb.blue;
      });
    },
    { once: true },
  );

  input.addEventListener(
    "change",
    () => {
      input.remove();
    },
    { once: true },
  );

  input.addEventListener(
    "blur",
    () => {
      input.remove();
    },
    { once: true },
  );

  input.click();
}

function addSpritePaletteColor(): void {
  const sprite = selectedSprite.value;
  if (!sprite) {
    return;
  }

  if (sprite.palette.length >= 256) {
    showWarningToast("Palette full", "Sprite palette already has the maximum of 256 colors.");
    return;
  }

  let newIndex = -1;
  commitSpriteMutation(sprite, "Add Palette Color", () => {
    sprite.palette.push({ red: 255, green: 255, blue: 255, alpha: 255 });
    newIndex = sprite.palette.length - 1;
  });
  if (newIndex === -1) {
    return;
  }

  editForegroundPaletteIndex.value = newIndex;
}

function applySpriteEditorPaint(payload: SpriteEditorPaintPayload): void {
  const sprite = selectedSprite.value;
  if (!sprite) {
    return;
  }

  if (activeEditStrokeSpriteId.value === sprite.id && activeEditStrokeSnapshot.value) {
    mutateSpriteByPaintPayload(sprite, payload);
    sprite.src = renderIndexedSpriteToDataUri(sprite.width, sprite.height, sprite.palette, sprite.indexes);
    markSpriteAsDirty(sprite);
    return;
  }

  commitSpriteMutation(sprite, getPaintStrokeOperationName(), () => {
    mutateSpriteByPaintPayload(sprite, payload);
  });
}

function startSpriteEditStroke(): void {
  finalizeActiveEditStroke();

  const sprite = selectedSprite.value;
  if (!sprite) {
    return;
  }

  activeEditStrokeSnapshot.value = createSpriteSnapshot(sprite);
  activeEditStrokeSpriteId.value = sprite.id;
}

function endSpriteEditStroke(): void {
  finalizeActiveEditStroke();
}

function finalizeActiveEditStroke(): void {
  const spriteId = activeEditStrokeSpriteId.value;
  const snapshot = activeEditStrokeSnapshot.value;
  activeEditStrokeSpriteId.value = null;
  activeEditStrokeSnapshot.value = null;

  if (spriteId === null || !snapshot) {
    return;
  }

  const sprite = openedSprites.value.find((item) => item.id === spriteId);
  if (!sprite || !hasSpriteChanged(sprite, snapshot)) {
    return;
  }

  sprite.undoStack.push(createSpriteHistoryEntry(snapshot, getPaintStrokeOperationName()));
  sprite.redoStack = [];
  markSpriteAsDirty(sprite);
}

function mutateSpriteByPaintPayload(sprite: IndexedSprite, payload: SpriteEditorPaintPayload): void {
  const radius = Math.max(0, Math.floor(editStrokeRadius.value) - 1);
  if (editTool.value === "eraser") {
    paintSpriteCircle(sprite, payload.x, payload.y, radius, transparentPaletteIndex);
    return;
  }

  if (editForegroundPaletteIndex.value === transparentPaletteIndex) {
    return;
  }

  if (editTool.value === "pencil") {
    paintSpriteCircle(sprite, payload.x, payload.y, radius, editForegroundPaletteIndex.value);
    return;
  }

  paintSpriteBrush(sprite, payload.x, payload.y, radius, editForegroundPaletteIndex.value);
}

function getPaintStrokeOperationName(): string {
  const toolLabelByType: Record<EditTool, string> = {
    pencil: "Pencil",
    brush: "Brush",
    eraser: "Eraser",
  };

  return `Paint Stroke (${toolLabelByType[editTool.value]})`;
}

function paintSpritePixel(sprite: IndexedSprite, x: number, y: number, paletteIndex: number): void {
  if (x < 0 || y < 0 || x >= sprite.width || y >= sprite.height) {
    return;
  }

  if (paletteIndex !== transparentPaletteIndex && (paletteIndex < 0 || paletteIndex >= sprite.palette.length)) {
    return;
  }

  sprite.indexes[y * sprite.width + x] = paletteIndex;
}

function paintSpriteCircle(sprite: IndexedSprite, centerX: number, centerY: number, radius: number, paletteIndex: number): void {
  forEachCirclePixel(centerX, centerY, radius, (x, y) => {
    paintSpritePixel(sprite, x, y, paletteIndex);
  });
}

function paintSpriteBrush(sprite: IndexedSprite, centerX: number, centerY: number, radius: number, targetPaletteIndex: number): void {
  if (targetPaletteIndex === transparentPaletteIndex) {
    paintSpriteCircle(sprite, centerX, centerY, radius, transparentPaletteIndex);
    return;
  }

  const targetColor = sprite.palette[targetPaletteIndex];
  if (!targetColor) {
    return;
  }

  const innerRadius = Math.max(0, radius - 1);

  forEachCirclePixel(centerX, centerY, radius, (x, y, distance) => {
    const pixelOffset = y * sprite.width + x;
    const existingPaletteIndex = sprite.indexes[pixelOffset] ?? transparentPaletteIndex;

    if (distance <= innerRadius || radius <= innerRadius) {
      paintSpritePixel(sprite, x, y, targetPaletteIndex);
      return;
    }

    const edgeRatio = (distance - innerRadius) / Math.max(1e-6, radius - innerRadius);
    const clampedEdgeRatio = clamp(edgeRatio, 0, 1);
    const existingColor =
      existingPaletteIndex === transparentPaletteIndex ? targetColor : (sprite.palette[existingPaletteIndex] ?? targetColor);
    const blendedColor = interpolateColor(targetColor, existingColor, clampedEdgeRatio);
    const blendedPaletteIndex = findNearestPaletteIndex(sprite.palette, blendedColor);
    paintSpritePixel(sprite, x, y, blendedPaletteIndex);
  });
}

function forEachCirclePixel(
  centerX: number,
  centerY: number,
  radius: number,
  callback: (x: number, y: number, distance: number) => void,
): void {
  const radiusSquared = radius * radius;

  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      const distanceSquared = offsetX * offsetX + offsetY * offsetY;
      if (distanceSquared > radiusSquared) {
        continue;
      }

      callback(centerX + offsetX, centerY + offsetY, Math.sqrt(distanceSquared));
    }
  }
}

function findNearestPaletteIndex(palette: RgbaColor[], color: RgbaColor): number {
  if (palette.length === 0) {
    return transparentPaletteIndex;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  palette.forEach((paletteColor, index) => {
    const distance = getColorDistanceSquared(paletteColor, color);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
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
      getResizeInterpolateAutoSmoothSettings(),
    );
    commitSpriteMutation(sprite, "Resize Palette (Interpolate)", () => {
      sprite.palette = interpolatedData.palette;
      sprite.indexes = interpolatedData.indexes;
    });
    return;
  }

  const reducedData = reduceIndexedSpritePalette(sprite);
  commitSpriteMutation(sprite, "Resize Palette (Reduce)", () => {
    sprite.palette = reducedData.palette;
    sprite.indexes = reducedData.indexes;
  });
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
      getResizeInterpolateAutoSmoothSettings(),
    );
    const interpolatedSprite: IndexedSprite = {
      ...sprite,
      id: nextSpriteId++,
      name: `${sprite.name} interpolate`,
      sourceAction: "Remapped",
      palette: interpolatedData.palette,
      indexes: interpolatedData.indexes,
      src: renderIndexedSpriteToDataUri(sprite.width, sprite.height, interpolatedData.palette, interpolatedData.indexes),
      undoStack: [],
      redoStack: [],
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
    undoStack: [],
    redoStack: [],
  };
  openedSprites.value.push(reducedSprite);
  selectedSprite.value = reducedSprite;
}

function getMergedPaletteIndices(reducedPalette: RgbaColor[], originalPalette: RgbaColor[]): number[] {
  const originalKeys = new Set(originalPalette.map(colorToKey));
  const mergedPaletteIndices: number[] = [];

  reducedPalette.forEach((color, index) => {
    if (!originalKeys.has(colorToKey(color))) {
      mergedPaletteIndices.push(index);
    }
  });

  return mergedPaletteIndices;
}

function reduceIndexedSpritePalette(
  sprite: IndexedSprite,
): {
  palette: RgbaColor[];
  indexes: number[];
  mergedPaletteIndices: number[];
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
      mergedPaletteIndices: [],
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
    mergedPaletteIndices: getMergedPaletteIndices(reducedPalette, sprite.palette),
  };
}

function allocateSegmentInsertCountsByColorDistance(palette: RgbaColor[], additionalColorCount: number): number[] {
  const segmentCount = palette.length - 1;
  const insertCounts = Array.from({ length: segmentCount }, () => 0);
  if (segmentCount <= 0 || additionalColorCount <= 0) {
    return insertCounts;
  }

  const segmentDistances = Array.from({ length: segmentCount }, (_, segmentIndex) =>
    getColorDistanceSquared(palette[segmentIndex], palette[segmentIndex + 1]),
  );
  const totalDistance = segmentDistances.reduce((sum, distance) => sum + distance, 0);
  if (totalDistance <= 0) {
    const baseInsertCountPerSegment = Math.floor(additionalColorCount / segmentCount);
    const segmentRemainder = additionalColorCount % segmentCount;
    return insertCounts.map((_, segmentIndex) => baseInsertCountPerSegment + (segmentIndex < segmentRemainder ? 1 : 0));
  }

  const fractionalCounts = segmentDistances.map((distance) => (distance / totalDistance) * additionalColorCount);
  const baseCounts = fractionalCounts.map((count) => Math.floor(count));
  let assignedCount = baseCounts.reduce((sum, count) => sum + count, 0);
  const remainderPriority = fractionalCounts
    .map((count, segmentIndex) => ({
      segmentIndex,
      remainder: count - baseCounts[segmentIndex],
    }))
    .sort((left, right) => right.remainder - left.remainder || left.segmentIndex - right.segmentIndex);

  baseCounts.forEach((count, segmentIndex) => {
    insertCounts[segmentIndex] = count;
  });

  for (let priorityIndex = 0; assignedCount < additionalColorCount; priorityIndex += 1) {
    insertCounts[remainderPriority[priorityIndex].segmentIndex] += 1;
    assignedCount += 1;
  }

  return insertCounts;
}

function interpolateIndexedSpritePalette(
  sprite: IndexedSprite,
  addCount: number | null,
  autoSmooth: boolean,
  autoSmoothSettings?: AutoSmoothSettings,
): {
  palette: RgbaColor[];
  indexes: number[];
  insertedPaletteIndices: number[];
} {
  const additionalColorCount = Math.max(0, Math.floor(addCount ?? 0));
  if (additionalColorCount <= 0 || sprite.palette.length < 2) {
    return {
      palette: sprite.palette.map(cloneColor),
      indexes: [...sprite.indexes],
      insertedPaletteIndices: [],
    };
  }

  const segmentCount = sprite.palette.length - 1;
  const insertCounts = allocateSegmentInsertCountsByColorDistance(sprite.palette, additionalColorCount);
  const interpolatedPalette: RgbaColor[] = [];
  const insertedPaletteIndices: number[] = [];
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
      insertedPaletteIndices.push(interpolatedPalette.length);
      interpolatedPalette.push(interpolateColor(startColor, endColor, ratio));
    }
  }

  const remappedIndexes = autoSmooth
    ? createAutoSmoothedIndexes(sprite, remappedPaletteIndexByOriginal, insertCounts, autoSmoothSettings)
    : sprite.indexes.map((paletteIndex) =>
        paletteIndex === transparentPaletteIndex ? transparentPaletteIndex : (remappedPaletteIndexByOriginal.get(paletteIndex) ?? paletteIndex),
      );

  return {
    palette: interpolatedPalette,
    indexes: remappedIndexes,
    insertedPaletteIndices,
  };
}

function createAutoSmoothedIndexes(
  sprite: IndexedSprite,
  remappedPaletteIndexByOriginal: Map<number, number>,
  insertCounts: number[],
  autoSmoothSettings?: AutoSmoothSettings,
): number[] {
  const centerWeight = normalizeAutoSmoothNumeric(autoSmoothSettings?.centerWeight, 2, 0);
  const neighborWeight = normalizeAutoSmoothNumeric(autoSmoothSettings?.neighborWeight, 1, 0);
  const blendStrength = normalizeAutoSmoothNumeric(autoSmoothSettings?.blendStrength, 0.5, 0, 1);
  const neighborOffsets = autoSmoothSettings?.includeDiagonalNeighbors
    ? [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [-1, -1],
        [-1, 1],
        [1, -1],
        [1, 1],
      ]
    : [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ];
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
      let weightedSum = sourcePaletteIndex * centerWeight;
      let weight = centerWeight;
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

        weightedSum += neighborPaletteIndex * neighborWeight;
        weight += neighborWeight;
      });

      if (weight <= 0) {
        smoothedIndexes.push(remappedPaletteIndexByOriginal.get(sourcePaletteIndex) ?? sourcePaletteIndex);
        continue;
      }

      const averagedPosition = weightedSum / weight;
      const smoothedPosition = sourcePaletteIndex + (averagedPosition - sourcePaletteIndex) * blendStrength;
      smoothedIndexes.push(
        mapPalettePositionToInterpolatedIndex(smoothedPosition, sprite.palette.length, remappedPaletteIndexByOriginal, insertCounts),
      );
    }
  }

  return smoothedIndexes;
}

function normalizeAutoSmoothNumeric(value: number | null | undefined, fallback: number, min: number, max = Number.POSITIVE_INFINITY): number {
  const numericValue = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, numericValue));
}

function getResizeInterpolateAutoSmoothSettings(): AutoSmoothSettings {
  return {
    centerWeight: resizeInterpolateSmoothCenterWeight.value,
    neighborWeight: resizeInterpolateSmoothNeighborWeight.value,
    blendStrength: resizeInterpolateSmoothBlendStrength.value,
    includeDiagonalNeighbors: resizeInterpolateSmoothIncludeDiagonalNeighbors.value,
  };
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
    undoStack: [],
    redoStack: [],
  };
}

function applyPaletteRemapToSprite(sprite: IndexedSprite, targets: RgbaColor[]): void {
  const { palette, indexes } = remapSpritePalette(sprite, targets, dedupeRemappedColors.value);
  commitSpriteMutation(sprite, "Remap Palette", () => {
    sprite.palette = palette;
    sprite.indexes = indexes;
  });
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

  try {
    await importSpritesFromFiles(files);
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
    undoStack: [],
    redoStack: [],
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
    undoStack: [],
    redoStack: [],
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
    undoStack: [],
    redoStack: [],
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
  const canUndo = canUndoSprite(sprite);
  const canRedo = canRedoSprite(sprite);
  const menuWidth = getDetachedSpriteContextMenuWidth(canSaveToSource);
  const menuHeight = getDetachedSpriteContextMenuHeight(canSaveToSource);
  const menuPosition = getDetachedSpriteContextMenuPosition(event, menuWidth, menuHeight);

  const menuWindow = new WebviewWindow(spriteContextMenuWindowLabel, {
    url: `/#sprite-context-menu?spriteId=${sprite.id}&canSaveToSource=${canSaveToSource ? "1" : "0"}&canUndo=${canUndo ? "1" : "0"}&canRedo=${canRedo ? "1" : "0"}`,
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
  const actionCount = canSaveToSource ? 7 : 6;
  return actionCount * spriteContextMenuActionHeight + spriteContextMenuWindowVerticalPadding;
}

function getDetachedSpriteContextMenuWidth(canSaveToSource: boolean): number {
  const labels = [
    "Undo",
    "Redo",
    "Sort Palette by Brightness",
    ...(canSaveToSource ? ["Save", "Reload"] : []),
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

  if (payload.action === "undo") {
    undoSprite(sprite);
    return;
  }

  if (payload.action === "redo") {
    redoSprite(sprite);
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

  if (payload.action === "reload") {
    await reloadSpriteFromSourcePath(sprite);
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
    return;
  }

  if (isDetachedSpriteContextMenu || isEditableKeyboardTarget(event.target)) {
    return;
  }

  const sprite = selectedSprite.value;
  if (!sprite || event.altKey) {
    return;
  }

  const isUndoShortcut = (event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z";
  if (isUndoShortcut && canUndoSprite(sprite)) {
    event.preventDefault();
    undoSprite(sprite);
    return;
  }

  const isRedoByY = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y";
  const isRedoByShiftZ = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "z";
  if ((isRedoByY || isRedoByShiftZ) && canRedoSprite(sprite)) {
    event.preventDefault();
    redoSprite(sprite);
  }
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const editableTag = target.closest("input, textarea, select");
  if (editableTag) {
    return true;
  }

  return target.isContentEditable || Boolean(target.closest("[contenteditable='true']"));
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

async function reloadSpriteFromSourcePath(sprite: IndexedSprite): Promise<void> {
  if (!canSaveSpriteToSource(sprite)) {
    showWarningToast("Reload unavailable", "This sprite has no original import path to reload from.");
    return;
  }

  const path = sprite.sourceFilePath!.trim();

  try {
    const reloadedSprite = await pathToIndexedSprite(path);
    applyReloadedSpriteData(sprite, reloadedSprite);
    markSpriteAsClean(sprite);

    if (selectedSprite.value?.id === sprite.id) {
      selectedSprite.value = sprite;
      syncEditorPaletteSelection(sprite);
    }

    closeSpriteContextMenu();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to reload sprite.";
    if (isSourceFileNotFoundError(message)) {
      showErrorToast("File not found", `The file at "${path}" is no longer available.`);
      return;
    }

    showErrorToast("Reload failed", message);
  }
}

function applyReloadedSpriteData(target: IndexedSprite, source: IndexedSprite): void {
  target.name = source.name;
  target.sourceAction = source.sourceAction;
  target.sourceFileName = source.sourceFileName;
  target.sourceFilePath = source.sourceFilePath;
  target.sourceFileDirty = false;
  target.src = source.src;
  target.width = source.width;
  target.height = source.height;
  target.palette = source.palette;
  target.indexes = source.indexes;
}

function isSourceFileNotFoundError(message: string): boolean {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("no such file or directory") ||
    normalized.includes("cannot find the file") ||
    normalized.includes("system cannot find the path") ||
    normalized.includes("os error 2")
  );
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
      undoStack: [],
      redoStack: [],
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

function canUndoSprite(sprite: IndexedSprite): boolean {
  return sprite.undoStack.length > 0;
}

function canRedoSprite(sprite: IndexedSprite): boolean {
  return sprite.redoStack.length > 0;
}

function undoSprite(sprite: IndexedSprite, options: { closeMenu?: boolean } = {}): boolean {
  const previousEntry = sprite.undoStack.pop();
  if (!previousEntry) {
    return false;
  }

  sprite.redoStack.push(createSpriteHistoryEntry(createSpriteSnapshot(sprite), previousEntry.operationName));
  applySpriteSnapshot(sprite, previousEntry.snapshot);
  markSpriteAsDirty(sprite);
  if (options.closeMenu ?? true) {
    closeSpriteContextMenu();
  }

  return true;
}

function redoSprite(sprite: IndexedSprite, options: { closeMenu?: boolean } = {}): boolean {
  const nextEntry = sprite.redoStack.pop();
  if (!nextEntry) {
    return false;
  }

  sprite.undoStack.push(createSpriteHistoryEntry(createSpriteSnapshot(sprite), nextEntry.operationName));
  applySpriteSnapshot(sprite, nextEntry.snapshot);
  markSpriteAsDirty(sprite);
  if (options.closeMenu ?? true) {
    closeSpriteContextMenu();
  }

  return true;
}

function jumpSelectedSpriteHistory(timelineIndex: number): void {
  const sprite = selectedSprite.value;
  if (!sprite) {
    return;
  }

  jumpSpriteToTimelineIndex(sprite, timelineIndex);
}

function jumpSpriteToTimelineIndex(sprite: IndexedSprite, timelineIndex: number): void {
  const totalEntries = sprite.undoStack.length + sprite.redoStack.length + 1;
  if (totalEntries <= 0) {
    return;
  }

  const targetIndex = clamp(timelineIndex, 0, totalEntries - 1);
  while (sprite.undoStack.length > targetIndex) {
    if (!undoSprite(sprite, { closeMenu: false })) {
      break;
    }
  }

  while (sprite.undoStack.length < targetIndex) {
    if (!redoSprite(sprite, { closeMenu: false })) {
      break;
    }
  }
}

function commitSpriteMutation(sprite: IndexedSprite, operationName: string, mutate: () => void): void {
  const previous = createSpriteSnapshot(sprite);
  mutate();

  if (!hasSpriteChanged(sprite, previous)) {
    return;
  }

  sprite.undoStack.push(createSpriteHistoryEntry(previous, operationName));
  sprite.redoStack = [];
  sprite.src = renderIndexedSpriteToDataUri(sprite.width, sprite.height, sprite.palette, sprite.indexes);
  markSpriteAsDirty(sprite);
}

function applySpriteSnapshot(sprite: IndexedSprite, snapshot: SpriteSnapshot): void {
  sprite.palette = snapshot.palette.map(cloneColor);
  sprite.indexes = [...snapshot.indexes];
  sprite.src = renderIndexedSpriteToDataUri(sprite.width, sprite.height, sprite.palette, sprite.indexes);
}

function createSpriteSnapshot(sprite: IndexedSprite): SpriteSnapshot {
  return {
    palette: sprite.palette.map(cloneColor),
    indexes: [...sprite.indexes],
  };
}

function createSpriteHistoryEntry(snapshot: SpriteSnapshot, operationName: string): SpriteHistoryEntry {
  return {
    snapshot,
    operationName,
  };
}

function hasSpriteChanged(sprite: IndexedSprite, snapshot: SpriteSnapshot): boolean {
  if (sprite.indexes.length !== snapshot.indexes.length || sprite.palette.length !== snapshot.palette.length) {
    return true;
  }

  for (let index = 0; index < sprite.indexes.length; index += 1) {
    if (sprite.indexes[index] !== snapshot.indexes[index]) {
      return true;
    }
  }

  for (let index = 0; index < sprite.palette.length; index += 1) {
    const currentColor = sprite.palette[index];
    const previousColor = snapshot.palette[index];
    if (
      currentColor.red !== previousColor.red ||
      currentColor.green !== previousColor.green ||
      currentColor.blue !== previousColor.blue ||
      currentColor.alpha !== previousColor.alpha
    ) {
      return true;
    }
  }

  return false;
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
  commitSpriteMutation(sprite, "Sort Palette by Brightness", () => {
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
  });
  closeSpriteContextMenu();
}

function getColorBrightness(color: RgbaColor): number {
  return color.red * 0.2126 + color.green * 0.7152 + color.blue * 0.0722;
}

function removeSprite(sprite: IndexedSprite): void {
  finalizeActiveEditStroke();

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
      label="Undo"
      class="sprite-context-menu-action"
      :disabled="!detachedSpriteContextMenuCanUndo"
      @click="sendDetachedSpriteContextMenuAction('undo')"
    />
    <Button
      type="button"
      text
      label="Redo"
      class="sprite-context-menu-action"
      :disabled="!detachedSpriteContextMenuCanRedo"
      @click="sendDetachedSpriteContextMenuAction('redo')"
    />
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
      v-if="detachedSpriteContextMenuCanSaveToSource"
      type="button"
      text
      label="Reload"
      class="sprite-context-menu-action"
      @click="sendDetachedSpriteContextMenuAction('reload')"
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
  <main
    v-else
    class="app-shell"
    :class="{ 'is-sprite-drop-target': spriteFileDropActive }"
    @dragenter="handleWindowDragEnter"
    @dragover="handleWindowDragOver"
    @dragleave="handleWindowDragLeave"
    @drop="handleWindowDrop"
  >
    <div v-if="spriteFileDropActive" class="sprite-drop-overlay" aria-hidden="true">Drop image files to import</div>
    <section class="main-panel">
      <Tabs v-model:value="activeTab" class="main-tabs">
        <TabList>
          <Tab value="extract-sprite">Extract Sprite</Tab>
          <Tab value="edit-sprite">Edit Sprite</Tab>
          <Tab value="update-palette">Update Palette</Tab>
          <Tab value="resize-palette">Resize Palette</Tab>
          <Tab value="history">History</Tab>
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

          <TabPanel value="edit-sprite">
            <section class="edit-sprite-layout">
              <Panel header="Edit Tools" class="palette-remap-panel">
                <div v-if="selectedSprite" class="palette-remap-content">
                  <div class="edit-tool-buttons">
                    <Button type="button" label="Pencil" :severity="editTool === 'pencil' ? 'primary' : 'secondary'" @click="setEditTool('pencil')" />
                    <Button type="button" label="Brush" :severity="editTool === 'brush' ? 'primary' : 'secondary'" @click="setEditTool('brush')" />
                    <Button type="button" label="Eraser" :severity="editTool === 'eraser' ? 'primary' : 'secondary'" @click="setEditTool('eraser')" />
                  </div>

                  <label class="edit-radius-control">
                    <span>Radius (Pencil/Brush): {{ editStrokeRadius }}</span>
                    <input v-model.number="editStrokeRadius" type="range" min="1" max="32" step="1" />
                  </label>

                  <div class="edit-palette-actions">
                    <Button type="button" label="Add Color" @click="addSpritePaletteColor" />
                    <span class="edit-palette-help">Click: select foreground, double click: edit color</span>
                  </div>

                  <ul class="edit-palette-list" @contextmenu.prevent>
                    <li v-for="swatch in editPaletteSwatches" :key="swatch.value">
                      <button
                        type="button"
                        class="edit-palette-swatch-button"
                        :class="{
                          'is-fg': isSelectedEditPalette(swatch.value),
                        }"
                        :aria-label="swatch.label"
                        @pointerdown="handleEditSwatchPointerDown($event, swatch.value)"
                        @dblclick="editPaletteColor(swatch.value)"
                      >
                        <span class="edit-palette-swatch-chip" :style="{ backgroundColor: swatch.color }" />
                        <span class="edit-palette-swatch-label">{{ swatch.label }}</span>
                      </button>
                    </li>
                  </ul>

                  <div class="edit-palette-preview-legend">
                    <span class="edit-palette-legend-mark is-fg" aria-hidden="true" />
                    <span>Foreground selection</span>
                  </div>
                </div>
                <div v-else class="empty-tab palette-remap-empty">Select a sprite to edit</div>
              </Panel>

              <SpriteEditor
                :preview-src="selectedSprite?.src"
                :indexes="selectedSprite?.indexes ?? []"
                :palette="selectedSprite ? selectedSprite.palette.map((color) => ({ color: colorToCss(color), label: colorToHex(color) })) : []"
                :width="selectedSprite?.width ?? 1"
                :height="selectedSprite?.height ?? 1"
                :tool="editTool"
                @paint-start="startSpriteEditStroke"
                @paint="applySpriteEditorPaint"
                @paint-end="endSpriteEditStroke"
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
                :merged-palette-indices="resizePalettePreview.mergedPaletteIndices"
                :inserted-palette-indices="resizePalettePreview.insertedPaletteIndices"
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
                      <div class="source-merge-controls interpolate-color-controls" aria-label="Interpolate color controls">
                        <label>
                          <span>Add Colors</span>
                          <InputNumber v-model="resizeInterpolateColorCount" :min="1" :max="255" show-buttons />
                        </label>
                        <label class="palette-remap-toggle">
                          <input v-model="resizeInterpolateAutoSmooth" type="checkbox" />
                          <span>Auto Smooth</span>
                        </label>
                        <div class="source-merge-controls interpolate-smooth-controls" aria-label="Auto smooth controls">
                          <label>
                            <span>Center Weight</span>
                            <InputNumber
                              v-model="resizeInterpolateSmoothCenterWeight"
                              :min="0"
                              :max="16"
                              :step="0.25"
                              :min-fraction-digits="0"
                              :max-fraction-digits="2"
                              :disabled="!resizeInterpolateAutoSmooth"
                              show-buttons
                            />
                          </label>
                          <label>
                            <span>Neighbor Weight</span>
                            <InputNumber
                              v-model="resizeInterpolateSmoothNeighborWeight"
                              :min="0"
                              :max="16"
                              :step="0.25"
                              :min-fraction-digits="0"
                              :max-fraction-digits="2"
                              :disabled="!resizeInterpolateAutoSmooth"
                              show-buttons
                            />
                          </label>
                          <label>
                            <span>Blend Strength</span>
                            <InputNumber
                              v-model="resizeInterpolateSmoothBlendStrength"
                              :min="0"
                              :max="1"
                              :step="0.05"
                              :min-fraction-digits="0"
                              :max-fraction-digits="2"
                              :disabled="!resizeInterpolateAutoSmooth"
                              show-buttons
                            />
                          </label>
                          <label class="palette-remap-toggle interpolate-smooth-toggle">
                            <input
                              v-model="resizeInterpolateSmoothIncludeDiagonalNeighbors"
                              type="checkbox"
                              :disabled="!resizeInterpolateAutoSmooth"
                            />
                            <span>Use Diagonal Neighbors</span>
                          </label>
                        </div>
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

          <TabPanel value="history">
            <section class="history-layout">
              <Panel header="History" class="palette-remap-panel">
                <div v-if="selectedSprite" class="palette-remap-content">
                  <ul class="history-stack-list" aria-label="Sprite undo and redo history">
                    <li
                      v-for="entry in selectedSpriteHistoryTimeline"
                      :key="`${selectedSprite.id}-${entry.kind}-${entry.timelineIndex}`"
                      class="history-stack-row"
                    >
                      <button
                        type="button"
                        class="history-stack-button"
                        :class="{
                          'is-current': selectedSpriteHistoryCurrentIndex === entry.timelineIndex,
                          'is-undo': entry.kind === 'undo',
                          'is-redo': entry.kind === 'redo',
                        }"
                        @click="jumpSelectedSpriteHistory(entry.timelineIndex)"
                      >
                        <span class="history-stack-label">{{ entry.label }}</span>
                        <span class="history-stack-detail">#{{ entry.timelineIndex }}</span>
                      </button>
                    </li>
                  </ul>
                </div>
                <div v-else class="empty-tab palette-remap-empty">Select a sprite to view history</div>
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
          label="Undo"
          class="sprite-context-menu-action"
          :disabled="!canUndoSprite(spriteContextMenu.sprite)"
          @click="undoSprite(spriteContextMenu.sprite)"
        />
        <Button
          type="button"
          role="menuitem"
          text
          label="Redo"
          class="sprite-context-menu-action"
          :disabled="!canRedoSprite(spriteContextMenu.sprite)"
          @click="redoSprite(spriteContextMenu.sprite)"
        />
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
          v-if="canSaveSpriteToSource(spriteContextMenu.sprite)"
          type="button"
          role="menuitem"
          text
          label="Reload"
          class="sprite-context-menu-action"
          @click="reloadSpriteFromSourcePath(spriteContextMenu.sprite)"
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
