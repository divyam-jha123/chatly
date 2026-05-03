/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_WS_URL?: string;
    readonly VITE_SFU_WS_URL?: string;
    readonly VITE_STUN_URLS?: string;
    readonly VITE_TURN_URLS?: string;
    readonly VITE_TURN_USERNAME?: string;
    readonly VITE_TURN_CREDENTIAL?: string;
    readonly VITE_FORCE_RELAY?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
