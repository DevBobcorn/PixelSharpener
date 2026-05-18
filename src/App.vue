<script setup lang="ts">
import { ref } from "vue";
import Panel from "primevue/panel";
import Tab from "primevue/tab";
import TabList from "primevue/tablist";
import TabPanel from "primevue/tabpanel";
import TabPanels from "primevue/tabpanels";
import Tabs from "primevue/tabs";
import SpriteViewer from "./components/SpriteViewer.vue";

const openedSprites = ref([
  { id: 1, name: "Sprite 1", src: makeSpriteDataUri("#2B2B2B", "#B0FF57") },
  { id: 2, name: "Sprite 2", src: makeSpriteDataUri("#5A5A5A", "#8EE3F5") },
  { id: 3, name: "Sprite 3", src: makeSpriteDataUri("#9B9B9B", "#F5C17A") },
]);

const selectedSprite = ref(openedSprites.value[0]);
const activeTab = ref("extract-sprite");

function makeSpriteDataUri(mainColor: string, accentColor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
    <rect width="64" height="64" fill="${mainColor}" />
    <rect x="8" y="8" width="48" height="48" fill="${accentColor}" />
    <rect x="20" y="20" width="24" height="24" fill="${mainColor}" />
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
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
                  v-if="selectedSprite.src"
                  :src="selectedSprite.src"
                  :alt="`${selectedSprite.name} source`"
                  class="preview-fit-image"
                />
                <span v-else>Uploaded source image</span>
              </div>
            </Panel>

            <SpriteViewer :preview-src="selectedSprite.src" />
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
            :class="{ 'is-active': selectedSprite.id === sprite.id }"
            @click="selectedSprite = sprite"
            :aria-label="`Open ${sprite.name}`"
          >
            <img :src="sprite.src" :alt="sprite.name" class="sprite-thumb" />
          </button>
        </li>
      </ul>
    </aside>
  </main>
</template>
