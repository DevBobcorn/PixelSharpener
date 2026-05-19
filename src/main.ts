import { createApp } from "vue";
import PrimeVue from "primevue/config";
import ToastService from "primevue/toastservice";
import Aura from "@primeuix/themes/aura";
import App from "./App.vue";
import "primeicons/primeicons.css";
import "./styles.css";

const app = createApp(App);

app.use(PrimeVue, {
  theme: {
    preset: Aura,
  },
});
app.use(ToastService);

app.mount("#app");
