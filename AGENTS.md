# App Inventario — Guía para agentes

App móvil de toma de inventario para **Market Trujillo** (Huaraz).
Inventario mensual de hasta 8.000 ítems, 160 hojas, **3 conteos** cruzados
contra el ERP (Microsoft Dynamics), liquidación y lacrado digital.

## Estructura

| Ruta | Qué es |
|---|---|
| `mobile/` | App Expo SDK 55 / React Native 0.83 (expo-router) |
| `mobile/design/` | Maquetas HTML que se validan antes de portar a React Native |
| `mobile/assets/logo-trujillo.png` | Logo de marca |
| `index.html` | Mockup del flujo completo de negocio (7 pantallas) |
| `Automatización del proceso de inventario.vtt` | Transcripción de la reunión de requisitos |

## Flujo de trabajo

1. Maquetar la pantalla en HTML dentro de `mobile/design/`
2. Validar con el cliente por capturas
3. Recién entonces portar a React Native

## Skills

| Skill | Descripción | Archivo |
|---|---|---|
| `trujillo-ui` | Sistema de diseño y controles de la app: tokens de marca, selects, PIN en modal, grupo segmentado, marco de teléfono | [SKILL.md](.claude/skills/trujillo-ui/SKILL.md) |

## Build del APK

Ver [mobile/README.md](mobile/README.md). Resumen: Gradle local (no EAS), con
`JAVA_HOME` apuntando al JBR de Android Studio. **Gradle puede devolver exit 0
sin regenerar el APK: verificar siempre el timestamp del binario.**
