<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
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

type SourceSelectionGridLine = {
  id: string;
  start: PixelPosition;
  end: PixelPosition;
};

type UniqueColor = {
  color: RgbaColor;
  count: number;
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

const openedSprites = ref<IndexedSprite[]>([]);
const selectedSprite = ref<IndexedSprite | null>(null);
const activeTab = ref("extract-sprite");
const fileInput = ref<HTMLInputElement | null>(null);
const sourceFileInput = ref<HTMLInputElement | null>(null);
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
const mergeMethod = ref<MergeMethod>("by-distance");
const spriteContextMenu = ref<SpriteContextMenu | null>(null);
const toast = useToast();
let nextSpriteId = 1;

const minSourceImageZoom = 1;
const maxSourceImageZoom = 32;
const mergeMethodOptions: { label: string; value: MergeMethod }[] = [
  { label: "By Distance", value: "by-distance" },
  { label: "By Color Count", value: "by-color-count" },
];

const sourceImageTransformStyle = computed(() => ({
  height: sourceImage.value ? `${sourceImage.value.height * sourceImageZoom.value}px` : undefined,
  transform: `translate(-50%, -50%) translate(${sourceImagePan.value.x}px, ${sourceImagePan.value.y}px)`,
  width: sourceImage.value ? `${sourceImage.value.width * sourceImageZoom.value}px` : undefined,
}));

const sourceSelectionPolygonPoints = computed(() => sourceSelection.value?.map(({ x, y }) => `${x},${y}`).join(" ") ?? "");
const sourceSelectionControlPointRadius = computed(() => 6 / sourceImageZoom.value);
const mergeValueLabel = computed(() => (mergeMethod.value === "by-distance" ? "Distance" : "Color Count"));
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

function createIndexedSpriteFromColors(name: string, width: number, height: number, colors: RgbaColor[]): IndexedSprite {
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
        <Button
          type="button"
          role="menuitem"
          text
          label="Sort Palette By Brightness"
          class="sprite-context-menu-action"
          @click="sortSpritePaletteByBrightness(spriteContextMenu.sprite)"
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
  </main>
</template>
