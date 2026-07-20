// No privileged APIs are exposed to the renderer yet — the renderer talks
// to the backend over plain HTTP (http://localhost:3000), same as the
// hosted web build. This file exists so electron-vite's default project
// layout (main/preload/renderer) has a preload entry point to build.
