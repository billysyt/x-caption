/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UPDATE_CHECK_URL?: string;
  readonly VITE_UPDATE_PROJECT?: string;
  readonly VITE_UPDATE_PROJECT_NAME?: string;
  readonly VITE_APP_VERSION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
