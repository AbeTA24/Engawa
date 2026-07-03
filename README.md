# Engawa — elegir la habitación

Una app web personal, tranquila y privada, para **estar presente** y **elegir a propósito los suelos ("habitaciones") donde uno florece** — aliviando a la parte vigilante en vez de vigilarla más.

Es una compañera, no una herramienta clínica. Su medida de éxito es que la necesites cada vez menos, y a la gente real cada vez más.

## Qué incluye (MVP)

- **Cartas al yo futuro** — escribe cartas fechadas que quedan selladas hasta su horizonte (1 / 5 / 10 años, o sin fecha). La app las devuelve como *invitación* al vencer, en aniversarios y con una cadencia suave. Abrir antes de tiempo también está permitido.
- **La Atrapada** — un solo toque cuando aparece la vigilancia: nombrarla ("es tu vieja forma de cuidar"), respirar ~40 s (inhalar 4 s / exhalar 6 s) y volver al presente describiendo una cosa real. Se registra como repetición de fuerza, nunca como fallo.
- **Suelo** — mapa privado de personas, lugares y actividades: *suelo fértil* (donde puedes ser plenamente tú) vs. *habitación fría* (donde te recortas para caber). Sin puntuaciones. Un empuje semanal, suave y descartable.

## Principios de diseño (deliberados)

- Sin rachas, sin rojos, sin insignias, sin culpa, sin métricas de presencia, sin nada de peso/comida/cuerpo.
- Un día en blanco está bien — *mono no aware* de serie.
- Paleta washi/madera en claro y oscuro, serif humanista, espacio negativo (*ma*), animaciones que calman.
- Una acción principal por pantalla; La Atrapada siempre a un toque.

## Privacidad

- **Local-first**: todo vive en el dispositivo (IndexedDB + localStorage). Sin cuentas, sin nube, sin analítica, sin peticiones a terceros (ni siquiera fuentes externas).
- PIN opcional, exportación a JSON en un toque, y borrado total en un toque (con una sola confirmación).

## Técnica

- Un solo archivo `index.html` (HTML/CSS/JS vanilla, cero dependencias) + `sw.js` y `manifest.webmanifest` para funcionar offline e instalarse como PWA.
- Se despliega solo: cada push a `main` publica la app en GitHub Pages (`.github/workflows/pages.yml`).

El nombre se elige al entrar (Engawa / Ma / Sala / el que quieras) y puede cambiarse en Ajustes.
