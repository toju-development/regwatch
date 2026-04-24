# RegWatch — Regulatory Intelligence Agent

## Documento de producto y alcance técnico completo · v3

> Preparado para ser usado como contexto en Claude Code u otro agente de desarrollo.
> Cubre producto completo, no solo MVP.

---

## Para quien no es técnico: qué es esto y para qué sirve

Imaginá que tenés que seguirle la pista a las leyes de pagos internacionales en Argentina, Brasil, Colombia, Perú y Chile al mismo tiempo. Cada país tiene su propio organismo regulatorio, publica sus novedades en su propio sitio web, en su propio formato, a veces en PDF, a veces en HTML, a veces en inglés, a veces en español.

Hoy los equipos de compliance de fintechs hacen ese trabajo **manualmente**: abren sitios web, buscan novedades, leen documentos, interpretan si algo les afecta, y escriben un resumen para el equipo. Eso lleva entre 10 y 20 horas semanales por persona.

**RegWatch automatiza todo ese proceso.** Es una aplicación web donde el equipo de compliance entra y encuentra un informe ya generado que dice: "Esta semana aparecieron 3 novedades regulatorias relevantes para tu negocio. Una es crítica y requiere acción. Las otras dos son para monitorear." Con el resumen, el link al documento oficial, y la recomendación de qué hacer.

**No es una IA que reemplaza al compliance officer.** Es una IA que hace el trabajo de recopilación y clasificación para que el compliance officer pueda enfocarse en tomar decisiones, no en buscar información.

### ¿Cómo funciona, en simple?

1. Cada cierto tiempo (la frecuencia la define el usuario: diario, semanal, o días específicos), el sistema lanza búsquedas inteligentes en la web por cada país configurado.
2. Agentes de inteligencia artificial leen los resultados, visitan las páginas relevantes, y extraen las novedades regulatorias que encontraron.
3. Compara los hallazgos contra todo lo que ya procesó antes. Si algo ya fue registrado, lo ignora. Si es nuevo, lo procesa.
4. Un agente clasificador analiza cada novedad y le asigna una severidad: crítica, alta, media o baja.
5. Un agente redactor escribe el informe en lenguaje claro y accionable.
6. El equipo recibe el informe por Slack, Teams o email (según lo que hayan configurado).

### Una aclaración importante sobre "cambios"

El sistema no compara versiones de documentos legales como si fuera un diff de código. Lo que hace es detectar **novedades**: regulaciones, circulares, comunicados o normativas que no había visto antes. La primera vez que se ejecuta, establece una línea de base capturando todo lo publicado en el período configurado (por defecto los últimos 30 días). A partir de ahí, cada ejecución solo procesa lo que es genuinamente nuevo.

---

## Visión del producto

**Nombre:** RegWatch
**Tagline:** _Regulatory intelligence for cross-border payment teams_
**Tipo:** SaaS web B2B, multi-tenant
**Modelo de negocio:** Suscripción mensual por organización

### Propuesta de valor

Los equipos de compliance en fintechs de pagos cross-border pierden horas semanales rastreando novedades regulatorias en múltiples jurisdicciones. Una novedad no detectada puede significar una multa, la suspensión de operaciones o la pérdida de una licencia.

RegWatch automatiza la vigilancia regulatoria con IA, generando alertas clasificadas por severidad y un digest accionable, específicamente calibrado para empresas de remesas y pagos internacionales.

### Clientes objetivo

- **Primario:** Fintechs de cross-border payments como Remitee, y sus clientes (bancos, fintechs, retailers que procesan remesas).
- **Secundario:** Consultoras de compliance, estudios especializados en fintech y regulación financiera.

---

## Real-world Compliance Workflow & Product Positioning

> **Quote del compliance lead de la empresa usuaria:**
> _"Hoy tenemos estudios de abogados en los países en los que operamos y los estudios nos mandan las actualizaciones, o también estamos en grupos de abogados y newsletter donde nos vamos enterando. Post eso, se hace el análisis (lectura, estudio y hasta debate a veces en cámara fintech o con partners) y se envían las conclusiones al equipo, C-level y demás áreas involucradas."_

Esta cita reescribe el alcance funcional. El producto NO es solo un scraper que dispara alertas: es la **capa de captura, análisis colaborativo y distribución segmentada** que hoy se hace manualmente entre email, WhatsApp y planillas.

### 1. Las fuentes NO son solo web scraping

Los inputs de alertas son múltiples. La pipeline de scanners ADK es uno de varios canales:

| Canal                           | Descripción                                                                                                                               | Ingesta                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Scrapers ADK**                | Lo descripto en pipeline de agentes (BCRA, BCB, SFC, SBS, CMF)                                                                            | Automático                                               |
| **Manual**                      | Pegar URL, subir PDF, pegar texto plano                                                                                                   | UI en `/alerts/new`                                      |
| **Email inbound**               | Mailbox dedicado por org (`alerts@<orgslug>.regwatch.app` o forward-to address) que captura newsletters y digests de estudios de abogados | Webhook de un proveedor tipo Postmark / SendGrid Inbound |
| **Webhook partners** _(futuro)_ | Estudios de abogados con integración directa publican alertas vía API                                                                     | `POST /api/ingest/webhook` con HMAC                      |

Toda alerta — venga de donde venga — pasa por el mismo `deduplicationTool` (`sourceUrlHash` + `orgId`) y el mismo `classifierAgent`. La fuente queda registrada en `Alert.source` (`scraper | manual | email | webhook`).

### 2. Workflow colaborativo de análisis

Cada alerta es un objeto vivo, no un mensaje de Slack. Tiene una **state machine**:

```
new → triaging → analyzing → debating → concluded → distributed
                                    ↘ archived (no relevante)
```

- **`new`**: ingresada por cualquier canal, aún no triada.
- **`triaging`**: alguien la asigna a un analista responsable.
- **`analyzing`**: analista leyendo, redactando notas, adjuntando documentos.
- **`debating`**: discusión inline (estilo Linear / GitHub issues): comentarios, menciones (`@`), tags a otras alertas relacionadas. Aquí es donde entra el "debate en cámara fintech o con partners" — el debate vive dentro de la alerta, no en un WhatsApp paralelo.
- **`concluded`**: hay una conclusión oficial firmada por el analista responsable + (opcional) review de un segundo.
- **`distributed`**: la conclusión fue enviada a las audiencias seleccionadas.

Capacidades en cada alerta:

- Asignar analista (uno responsable, N colaboradores).
- Thread de comentarios con menciones y reacciones.
- Adjuntar archivos (PDFs, opiniones legales del estudio).
- Tagging a otras alertas relacionadas (grafo de "esta circular complementa a aquella").
- Audit log: quién cambió de estado, cuándo, por qué.

### 3. Distribución segmentada

La conclusión NO es un broadcast a todo el mundo. Cada alerta `concluded` se distribuye a una o más **audiencias**:

| Audiencia       | Default                                          | Canal típico      |
| --------------- | ------------------------------------------------ | ----------------- |
| `team`          | Equipo de compliance                             | Slack #compliance |
| `c-level`       | CEO/COO/CFO                                      | Email + Teams     |
| `legal`         | Equipo legal interno + estudios externos         | Email             |
| `product`       | Product managers                                 | Slack #product    |
| `risk`          | Equipo de riesgo                                 | Teams             |
| `custom:<slug>` | Grupos definidos por la org (ej: `custom:board`) | Configurable      |

Cada audiencia tiene canales asociados configurables por org. El analista, al concluir, elige el subset de audiencias y opcionalmente edita el mensaje por audiencia (el C-level no necesita el mismo nivel de detalle técnico que legal).

### 4. Posicionamiento del producto

**RegWatch AUMENTA al estudio de abogados, no lo reemplaza.** El estudio sigue siendo el oráculo legal. Lo que RegWatch hace es:

- **Capturar** todo lo que llega (scrapers + emails de estudios + newsletters + manual) en un único repositorio searchable.
- **Estructurar** el análisis colaborativo (state machine + debate inline + conclusiones firmadas).
- **Distribuir** con audiencias segmentadas en lugar de "reply-all" a un email gigante.

Hoy ese workflow vive en email + WhatsApp + planillas + memorias individuales. RegWatch lo formaliza sin pretender opinar legalmente por sí solo.

### User stories derivadas

- _Como compliance officer, quiero forwardear el newsletter del estudio a `alerts@miorg.regwatch.app` para que el sistema cree una alerta automáticamente y la deje en `new` para triarla._
- _Como analista, quiero asignarme una alerta, dejar comentarios mencionando al partner del estudio externo y adjuntar su opinión legal en PDF._
- _Como compliance lead, quiero marcar la alerta como `concluded` y distribuirla SOLO a `c-level` + `legal` con un resumen ejecutivo distinto al que ven mis analistas._
- _Como CFO, quiero recibir solo las conclusiones que aplican a mi audiencia, no el ruido del proceso._

---

## Identity & Tenancy Model

> **Principal entity = `Organization`** (a.k.a. `Org`). Es la unidad de tenancy, billing, datos, equipo y configuración. Toda la app está modelada alrededor de este concepto. Naming: mantenemos `Organization` / `Org` — estándar de la industria, ya está en scope.

### Core entities

```prisma
model Organization {
  id          String   @id @default(cuid())
  slug        String   @unique          // usado para mailbox por subdominio: alerts@<slug>.regwatch.app
  name        String
  createdAt   DateTime @default(now())
  // billing, settings, jurisdictions config relations...
  members     Membership[]
  alerts      Alert[]
  audiences   AlertAudience[]
  inboundMailboxes InboundMailbox[]
}

model User {
  id          String   @id @default(cuid())
  email       String   @unique
  name        String?
  image       String?
  createdAt   DateTime @default(now())
  memberships Membership[]
  // NextAuth standard fields (accounts, sessions) viven aquí
}

model Membership {
  id             String   @id @default(cuid())
  userId         String
  organizationId String
  role           Role
  createdAt      DateTime @default(now())
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@unique([userId, organizationId])
  @@index([organizationId])
}

enum Role {
  OWNER     // control total, billing, eliminar org
  ADMIN     // gestiona miembros, settings, jurisdicciones
  ANALYST   // crea/edita alertas, comentarios, conclusiones, distribuye
  VIEWER    // solo lectura
}

model Invitation {
  id             String   @id @default(cuid())
  email          String
  organizationId String
  role           Role
  token          String   @unique
  expiresAt      DateTime
  acceptedAt     DateTime?
  invitedById    String
  createdAt      DateTime @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invitedBy      User         @relation(fields: [invitedById], references: [id])
  @@index([organizationId])
}
```

### Rules / Invariants

- Un `User` puede pertenecer a **múltiples** Organizations (multi-org membership). La org activa se selecciona vía un **org-switcher** en la UI; el backend usa un header `X-Org-Id` (o rutas con prefijo `/org/:orgId/...`) que se valida contra los `memberships` declarados en el JWT.
- Cada endpoint del API valida: (1) el JWT del usuario, (2) que el usuario tenga un `Membership` activo en la `Organization` destino, (3) que el `Role` del Membership permita la acción solicitada.
- Todos los modelos scoped (`Alert`, `AlertComment`, `AlertAttachment`, `AlertAudience`, `InboundMailbox`, `InboundMessage`, `Subscription`, `Settings`, etc.) llevan `organizationId`. Renombramos `orgId` → `organizationId` en el schema para consistencia (el alias `orgId` puede usarse en prosa cuando convenga).
- El invariante de deduplicación se vuelve: `(organizationId, sourceUrlHash)` — la misma alerta puede existir en dos orgs sin conflicto.
- `Alert.assigneeId` → referencia a `User` Y requiere que ese usuario tenga un `Membership` activo en el `organizationId` de la alerta (validado en write time).
- `AlertAudience` (a nivel de membership lists) lista `User`s, todos los cuales deben tener un `Membership` en la misma Organization.

### Onboarding flow

1. El usuario se registra vía NextAuth (Google OAuth o magic link).
2. En el primer login sin `Membership`, el sistema auto-crea una **Organization personal** (`name = "<User name>'s workspace"`, `slug` generado), `Membership(role=OWNER)`.
3. El usuario puede invitar a otros por email → se crea fila `Invitation` + email con link tokenizado. Al aceptar, se crea `Membership(role=<elegido>)`.
4. Usuario existente con `Invitation`: hace click en el link → si está logueado, acepta directo → nuevo `Membership` → la org aparece en el switcher. Si no está logueado, se registra primero.
5. **Org-switcher** (top-left, estilo Linear/Slack) permite a un usuario con múltiples memberships togglear el contexto activo.

### Authorization model

| Acción                                        | OWNER | ADMIN | ANALYST | VIEWER |
| --------------------------------------------- | ----- | ----- | ------- | ------ |
| Leer alertas                                  | ✅    | ✅    | ✅      | ✅     |
| Crear/editar alertas (incl. ingestión manual) | ✅    | ✅    | ✅      | ❌     |
| Comentar / cambiar status / asignar           | ✅    | ✅    | ✅      | ❌     |
| Gestionar audiencias y reglas de distribución | ✅    | ✅    | ❌      | ❌     |
| Gestionar jurisdicciones / config de scanners | ✅    | ✅    | ❌      | ❌     |
| Invitar miembros / cambiar roles              | ✅    | ✅    | ❌      | ❌     |
| Gestionar billing / eliminar org              | ✅    | ❌    | ❌      | ❌     |

> Implementation hint: NestJS `@Roles()` decorator + `RolesGuard` que lee membership claims del JWT. Se documenta como deliverable de slice más adelante.

---

## Por qué ADK y no solo NestJS

Esta es una pregunta técnica importante que merece una respuesta clara.

**NestJS** es un framework para construir APIs estructuradas: el desarrollador escribe exactamente qué hace cada paso. Es ideal para lógica determinista y predecible.

**Google ADK** es un framework para construir agentes de IA: el LLM (Gemini) decide _cómo_ ejecutar cada paso dentro de los límites que el desarrollador define.

### El problema con solo NestJS para este caso

Las regulaciones no tienen formato estándar:

- La BCRA (Argentina) publica PDFs con texto libre
- la SBS (Perú) publica comunicados HTML con estructura variable
- El Banco de la República (Colombia) publica en distintos formatos según el tipo de regulación
- Los organismos cambian sus sitios web periódicamente

Con NestJS puro necesitarías:

- Un parser específico por regulador (5 países = 5+ parsers que mantener)
- Mantenimiento constante cuando cambia la estructura del sitio
- Queries de búsqueda hardcodeadas que se vuelven obsoletas
- Lógica explícita para detectar qué constituye una "novedad relevante"

Con ADK + Gemini:

- El LLM interpreta cualquier formato (PDF, HTML, texto libre)
- Las búsquedas se construyen dinámicamente según el contexto y los temas configurados por el usuario
- La relevancia se evalúa por comprensión semántica, no por reglas
- Agregar un país nuevo es agregar una línea de configuración
- Los temas a monitorear son texto libre que alimenta directamente la instrucción del agente en runtime

### La arquitectura correcta es ambos

```
ADK Agents  →  NestJS (apps/scanner)  →  PostgreSQL  →  NestJS (apps/api)  →  Next.js 15
(inteligencia)   (workers + crons)        (persistencia)  (REST + auth)        (UI)
```

ADK hace la inteligencia. NestJS estructura los procesos. Son complementarios, no alternativos.

---

## Arquitectura técnica

### Stack completo

| Capa               | Tecnología                                                                 | Por qué                                                                  |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Agentes IA         | Google ADK TypeScript 1.0 (librería)                                       | Framework nativo para multi-agent systems con Gemini                     |
| Modelo LLM         | Gemini 2.5 Flash                                                           | Velocidad + costo para scanning                                          |
| Backend API        | **NestJS (latest) + TypeScript** (`apps/api`)                              | DI, módulos, guards, validación — escala con la complejidad del producto |
| Workers / scanners | **NestJS + `@nestjs/schedule` + ADK** (`apps/scanner`)                     | Proceso separado del API: crons multi-tenant + ingesta + agentes         |
| Base de datos      | PostgreSQL + Prisma (en `packages/db`)                                     | Relacional, ideal para alerts con filtros y relaciones                   |
| Frontend           | **Next.js 15 (App Router) + React 19**                                     | Server Actions, Streaming, RSC                                           |
| UI lib             | **shadcn/ui + Tailwind 4**                                                 | Componentes copy-paste, theming basado en CSS variables                  |
| Auth               | NextAuth — **Google OAuth + Magic Link** (MS Entra ID = futuro enterprise) | Multi-tenant, JWT compartido API↔Web                                     |
| API↔Web auth       | **JWT firmado por `apps/api`, validado por Next.js**                       | Single source of truth para identidad/orgId                              |
| Mapa LATAM         | `react-simple-maps` (recomendado) o MapLibre GL                            | SVG ligero, suficiente para indicadores por país                         |
| Notificaciones     | Slack Webhook + MS Teams Webhook + Resend (email)                          | Los tres canales principales de equipos corporativos                     |
| Email inbound      | Postmark Inbound o SendGrid Inbound Parse                                  | Per-org mailbox o forward address                                        |
| Scheduling         | **`@nestjs/schedule` en `apps/scanner`** (NO en API)                       | Procesos pesados aislados del API                                        |
| Validación de env  | `zod` en `packages/config`                                                 | Compartido por todas las apps                                            |
| Tests              | **Vitest** (unit/integration) + **Playwright** (E2E)                       |                                                                          |
| Package manager    | **pnpm** (workspaces)                                                      | Velocidad + workspace nativo                                             |
| Monorepo tooling   | **Turbo + pnpm workspaces**                                                | Cache de tasks, paralelismo                                              |
| Deploy             | Google Cloud Run                                                           | Integración nativa con ADK + Vertex AI                                   |

### Decisión clave: dos apps NestJS + dos Next.js desde el día 1

`apps/api` y `apps/scanner` se separan **desde el bootstrap inicial**, NO se difiere a una refactorización futura. `apps/web` (dashboard auth-gated) y `apps/landing` (marketing público) también nacen separados.

**Por qué split api/scanner:**

- El API es de baja latencia y stateless. Los scanners corren minutos, consumen memoria, hacen I/O pesado a LLM.
- Mezclarlos significa que un scan colgado degrada el dashboard.
- En Cloud Run, escalan con perfiles distintos (concurrency alta vs CPU-bound).
- El día que reemplazemos el cron in-process por Cloud Tasks / Pub-Sub, ya está aislado.

**Por qué split web/landing:**

- **Cadencia de deploy independiente**: la landing cambia copy/SEO sin tocar la app, y viceversa.
- **Static export para SEO**: `apps/landing` se exporta estático y se sirve desde CDN (`regwatch.com`). El dashboard (`app.regwatch.app`) es una app autenticada con Server Actions.
- **Bundle más liviano**: la landing no carga NextAuth, no carga shadcn data components, no carga el Prisma client. Solo lo necesario para vender.
- **Dominio distinto**: `regwatch.com` vs `app.regwatch.app` (o `app.regwatch.com`). Aislamiento de cookies, sesiones y analytics.
- Para el MVP basta con declarar la app vacía en el monorepo; el contenido real de marketing es post-MVP.

### Estructura del monorepo

```
regwatch/
├── pnpm-workspace.yaml
├── turbo.json
├── apps/
│   ├── api/                              ← NestJS — REST, auth, dashboard backend, alerts read API
│   │   └── src/
│   │       ├── auth/                     ← NextAuth-compatible JWT issuer + validation
│   │       ├── orgs/                     ← Organization, User, membership
│   │       ├── alerts/                   ← CRUD alerts (read-heavy), comments, state transitions
│   │       ├── digests/                  ← GET /api/digests
│   │       ├── settings/                 ← GET/PUT /api/settings
│   │       ├── ingest/                   ← POST /api/ingest/manual, /webhook (write-side)
│   │       └── main.ts
│   ├── scanner/                          ← NestJS — workers + crons + ADK agents
│   │   └── src/
│   │       ├── schedule/                 ← @nestjs/schedule, per-org cron loader
│   │       ├── agents/                   ← NestJS module wrapping ADK
│   │       │   ├── orchestrator.ts       ← Root LlmAgent (coordina pipeline)
│   │       │   ├── scanner.ts            ← LlmAgents x jurisdicción (GOOGLE_SEARCH)
│   │       │   ├── classifier.ts         ← LlmAgent + classifyTool
│   │       │   └── writer.ts             ← LlmAgent (digest Markdown)
│   │       ├── tools/                    ← classifyTool, deduplicationTool, storageTool, notifyTool
│   │       ├── ingest/                   ← email-inbound handler, manual-upload processor
│   │       ├── notify/                   ← Slack/Teams/Email + audience routing
│   │       └── main.ts
│   ├── web/                              ← Next.js 15 — dashboard, shadcn/ui
│   │   └── src/app/
│   │       ├── (auth)/                   ← Google + magic link
│   │       ├── onboarding/               ← Flujo primera vez (3 pasos)
│   │       ├── dashboard/                ← Vista principal + mapa LATAM
│   │       ├── alerts/                   ← Lista con filtros + thread de análisis
│   │       │   └── [id]/                 ← Detalle: state machine, comentarios, distribución
│   │       ├── digests/                  ← Historial de informes
│   │       └── settings/                 ← Config: países, temas, canales, audiencias, equipo
│   └── landing/                          ← Next.js 15 — sitio público de marketing (regwatch.com)
│       └── src/app/                      ← Static export, SEO-first, sin NextAuth ni shadcn data components
└── packages/
    ├── db/                               ← Prisma schema + client (compartido api ↔ scanner)
    ├── types/                            ← DTOs / shared TS types
    ├── config/                           ← env validation con zod (compartido)
    └── ui/                               ← (opcional) primitives shadcn compartidos si surge necesidad
```

### Pipeline de agentes

```
Trigger (scheduler / API manual / email inbound / webhook partner)
        ↓
RootAgent — LlmAgent orquestador (en apps/scanner)
        ↓
        ├── Scanner AR (LlmAgent + GOOGLE_SEARCH)  ←
        ├── Scanner BR (LlmAgent + GOOGLE_SEARCH)  ←  paralelo
        ├── Scanner CO (LlmAgent + GOOGLE_SEARCH)  ←
        ├── Scanner PE (LlmAgent + GOOGLE_SEARCH)  ←
        └── Scanner CL (LlmAgent + GOOGLE_SEARCH)  ←
        ↓ hallazgos agregados (+ inputs de email/manual/webhook)
deduplicationTool → filtra lo que ya existe en DB (sourceUrlHash + orgId)
        ↓ solo novedades reales
classifierAgent (LlmAgent + classifyTool)
        ↓ alerts con severity + category, status = "new"
storageTool → PostgreSQL
        ↓
[Workflow humano: triaging → analyzing → debating → concluded]
        ↓
writerAgent (LlmAgent → Markdown digest, opcional resumen por audiencia)
        ↓
notifyTool → Slack + Teams + Email (routed por audience config)
```

---

## Modelo de datos (Prisma)

> Schema base — agrega campos para el workflow colaborativo y multi-source. El schema vive en `packages/db/schema.prisma` y es consumido por `apps/api` y `apps/scanner`.
>
> **v3**: el modelo de identidad pasa a ser **Organization-first con multi-org membership** (ver sección "Identity & Tenancy Model"). `User` ya NO tiene `orgId` directo — se relaciona con `Organization` vía `Membership`. Toda referencia a `orgId` en modelos scoped pasa a llamarse `organizationId`.

```prisma
model Organization {
  id        String    @id @default(cuid())
  name      String
  slug      String    @unique  // usado para alerts@<slug>.regwatch.app
  createdAt DateTime  @default(now())
  members   Membership[]
  invitations Invitation[]
  alerts    Alert[]
  digests   Digest[]
  settings  Settings?
  scans     ScanLog[]
  audiences Audience[]
}

model User {
  id          String       @id @default(cuid())
  email       String       @unique
  name        String?
  image       String?
  createdAt   DateTime     @default(now())
  memberships Membership[]
  invitationsSent Invitation[] @relation("InvitedBy")
  // NextAuth standard fields (Account, Session) viven en este modelo
}

model Membership {
  id             String       @id @default(cuid())
  userId         String
  organizationId String
  role           Role
  createdAt      DateTime     @default(now())
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@unique([userId, organizationId])
  @@index([organizationId])
}

enum Role {
  OWNER
  ADMIN
  ANALYST
  VIEWER
}

model Invitation {
  id             String       @id @default(cuid())
  email          String
  organizationId String
  role           Role
  token          String       @unique
  expiresAt      DateTime
  acceptedAt     DateTime?
  invitedById    String
  createdAt      DateTime     @default(now())
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  invitedBy      User         @relation("InvitedBy", fields: [invitedById], references: [id])
  @@index([organizationId])
}

model Settings {
  id             String       @id @default(cuid())
  organizationId String       @unique
  organization   Organization @relation(fields: [organizationId], references: [id])

  jurisdictions  Json         @default("[{\"code\":\"AR\",\"enabled\":true,\"customTopics\":\"\"},{\"code\":\"BR\",\"enabled\":true,\"customTopics\":\"\"},{\"code\":\"CO\",\"enabled\":true,\"customTopics\":\"\"},{\"code\":\"PE\",\"enabled\":true,\"customTopics\":\"\"},{\"code\":\"CL\",\"enabled\":true,\"customTopics\":\"\"}]")

  scanSchedule   String       @default("weekly")
  scanDay        String       @default("mon")
  scanHour       Int          @default(8)

  slackWebhook   String?
  teamsWebhook   String?
  emailRecipients String[]
  notifySlack    Boolean      @default(false)
  notifyTeams    Boolean      @default(false)
  notifyEmail    Boolean      @default(false)

  minSeverityNotify String    @default("high")
  initialLookbackDays Int     @default(30)
}

model Alert {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  scanId         String?
  scan           ScanLog?     @relation(fields: [scanId], references: [id])
  digestId       String?
  digest         Digest?      @relation(fields: [digestId], references: [id])

  jurisdiction   String
  regulator      String
  title          String
  summary        String
  category       String       // "AML" | "KYC" | "limits" | "licensing" | "sanctions" | "reporting"
  severity       String       // "critical" | "high" | "medium" | "low"
  sourceUrl      String
  sourceUrlHash  String       // dedup invariant
  effectiveDate  String?
  actionRequired String
  detectedAt     DateTime     @default(now())

  // --- Workflow colaborativo ---
  source         String       @default("scraper")  // scraper | manual | email | webhook
  status         String       @default("new")      // new | triaging | analyzing | debating | concluded | distributed | archived
  assigneeId     String?      // referencia a User; debe tener Membership en organizationId
  conclusion     String?      // markdown final firmado
  comments       Comment[]
  attachments    Attachment[]
  relatedTo      Alert[]      @relation("AlertRelations")
  relatedFrom    Alert[]      @relation("AlertRelations")
  distributions  Distribution[]

  isRead         Boolean      @default(false)
  isDismissed    Boolean      @default(false)
  note           String?

  @@unique([organizationId, sourceUrlHash])
}

model Comment {
  id        String   @id @default(cuid())
  alertId   String
  alert     Alert    @relation(fields: [alertId], references: [id])
  authorId  String
  body      String   // markdown
  createdAt DateTime @default(now())
}

model Attachment {
  id        String   @id @default(cuid())
  alertId   String
  alert     Alert    @relation(fields: [alertId], references: [id])
  filename  String
  url       String   // GCS / S3
  mimeType  String
  uploadedAt DateTime @default(now())
}

model Audience {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  key            String       // "team" | "c-level" | "legal" | "product" | "risk" | "custom:<slug>"
  name           String
  channels       Json         // [{ type: "slack"|"teams"|"email", target: "..." }]

  @@unique([organizationId, key])
}

model Distribution {
  id          String   @id @default(cuid())
  alertId     String
  alert       Alert    @relation(fields: [alertId], references: [id])
  audienceKey String
  message     String?  // override del mensaje por audiencia
  sentAt      DateTime @default(now())
  channels    Json     // resultado: [{ type, status, error? }]
}

model Digest {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  periodLabel    String
  content        String
  alertCount     Int
  criticalCount  Int          @default(0)
  highCount      Int          @default(0)
  mediumCount    Int          @default(0)
  lowCount       Int          @default(0)
  generatedAt    DateTime     @default(now())
  alerts         Alert[]
}

model ScanLog {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id])
  triggeredBy    String       // "scheduler" | "manual" | "api" | "email" | "webhook"
  status         String       // "running" | "completed" | "failed"
  startedAt      DateTime     @default(now())
  completedAt    DateTime?
  errorMsg       String?
  newAlerts      Int          @default(0)
  skipped        Int          @default(0)
  alerts         Alert[]
}
```

---

## Países configurados y cómo funciona la personalización

### Países del producto (alineados con los mercados de Remitee)

| País         | Regulador                                 | Temas monitoreados por defecto                                   |
| ------------ | ----------------------------------------- | ---------------------------------------------------------------- |
| 🇦🇷 Argentina | BCRA                                      | Remesas, pagos cross-border, cepo cambiario, normativa cambiaria |
| 🇧🇷 Brasil    | BCB (Banco Central do Brasil)             | PIX, pagos internacionales, AML, regulación fintech              |
| 🇨🇴 Colombia  | SFC (Superfinanciera)                     | Pagos digitales, remesas, AML, regulación fintech                |
| 🇵🇪 Perú      | SBS                                       | Remesas, lavado de activos, pagos digitales                      |
| 🇨🇱 Chile     | CMF (Comisión para el Mercado Financiero) | Pagos cross-border, ley fintech, AML                             |

### Temas customizables por organización

Cada organización puede personalizar qué monitorear en cada país. El usuario entra a Settings, selecciona un país, y escribe en texto libre lo que le interesa. Ese texto alimenta directamente la instrucción del agente scanner de ese país.

**Ejemplo real:** Un usuario en Settings para Argentina podría escribir:

> "Quiero monitorear específicamente cambios en los límites de transferencia al exterior para personas jurídicas, actualizaciones en los requisitos de declaración de operaciones sospechosas (ROS), y cualquier novedad sobre la regulación de stablecoins o activos digitales."

Ese texto se inyecta como contexto adicional en el prompt del scanner agent de Argentina. No hay formularios con checkboxes, es lenguaje natural.

**Si el campo está vacío**, el scanner usa los temas por defecto de la tabla de arriba.

### Agregar un país nuevo (para el equipo de desarrollo)

En `apps/scanner/src/agents/jurisdictions.ts`:

```typescript
{
  code:      'UY',
  name:      'Uruguay',
  regulator: 'BCU (Banco Central del Uruguay)',
  language:  'es',
  defaultTopics: 'pagos internacionales, remesas, AML, regulación fintech'
}
```

Eso es todo. El sistema crea el scanner agent automáticamente en el próximo ciclo. No se toca ningún otro archivo.

### Roadmap de países V2

| País              | Regulador | Prioridad |
| ----------------- | --------- | --------- |
| 🇺🇾 Uruguay        | BCU       | Alta      |
| 🇲🇽 México         | CNBV      | Alta      |
| 🇺🇸 Estados Unidos | FinCEN    | Alta      |
| 🇪🇺 Unión Europea  | EBA       | Media     |
| 🇬🇧 Reino Unido    | FCA       | Media     |

---

## Periodicidad configurable

El scheduler vive en `apps/scanner` (NO en `apps/api`) usando `@nestjs/schedule`. Lee la configuración de cada organización y programa sus ejecuciones de forma independiente.

| Opción        | Descripción                                | Caso de uso                                           |
| ------------- | ------------------------------------------ | ----------------------------------------------------- |
| Diario        | Todos los días a la hora configurada       | Equipos de compliance activos, mercados muy regulados |
| Semanal       | Un día fijo por semana (lunes por defecto) | La mayoría de los equipos                             |
| Personalizado | Días específicos, ej: lunes y jueves       | Equipos que necesitan más cobertura sin ir a diario   |

El `apps/scanner` al iniciar carga la configuración de todas las organizaciones activas para programar cada una por separado.

---

## Canales de notificación y audiencias

Las notificaciones en RegWatch tienen DOS niveles:

### Nivel 1 — Notificación de digest semanal (canal organización)

Configurable por organización en Settings. Igual que el modelo original: Slack / Teams / Email para el digest agregado.

### Nivel 2 — Distribución de conclusión por audiencia

Cada alerta `concluded` se distribuye a 1+ audiencias (`team`, `c-level`, `legal`, `product`, `risk`, `custom:<slug>`). Cada audiencia define sus canales. Esto permite que una misma alerta llegue al C-level por email ejecutivo y al equipo legal por Slack/Teams con el detalle completo.

### Slack

- El usuario pega su Incoming Webhook URL en Settings (o por audiencia).
- Mensajes estructurados con resumen de severidad y link al digest/alerta.

### Microsoft Teams

- Funciona igual que Slack: Incoming Webhook URL.
- Adaptive Cards de Teams.

### Email

- Lista de destinatarios por org y/o por audiencia.
- Resend (API transaccional).
- Digest en HTML, descargable como PDF.

### Configuración de severidad mínima para notificar

Por org y por audiencia. Ej: el C-level recibe solo `critical`; el equipo de compliance recibe `critical + high`.

---

## Experiencia del usuario: primer ingreso y pantallas completas

### El problema del primer ingreso

Cuando alguien se registra por primera vez no tiene datos, no tiene alertas, no tiene nada. Si llegara directo al dashboard vacío, el producto se sentiría roto. La solución es un **onboarding estructurado en 3 pasos** que toma menos de 5 minutos y termina con el primer scan ejecutado.

### Pantalla 0: Onboarding (solo primera vez)

**Paso 1 — ¿Qué países querés monitorear?**
Vista de tarjetas con mapa o flags. Los 5 países por defecto (AR, BR, CO, PE, CL) aparecen todos activos. El usuario puede desactivar los que no le interesan con un toggle. Hay un botón "Agregar otro país" para países fuera del default.

**Paso 2 — ¿Qué querés monitorear en cada país?**
Para cada país activado, aparece un campo de texto con los temas por defecto ya cargados. El usuario puede dejar el texto como está (funciona bien) o reescribirlo con sus prioridades específicas. Hay ejemplos sugeridos para orientar.

**Paso 3 — ¿Cómo querés recibir los informes?**
Tres secciones colapsables: Slack, Teams, Email. El usuario activa los que usa y pega sus datos. Abajo, elige la frecuencia (diario, semanal, o días específicos) y la hora.

Al terminar el paso 3, aparece una pantalla de confirmación:

> **Todo listo.**
> Tu primera búsqueda va a tomar 2 o 3 minutos.
> ¿La ejecutamos ahora?
> [**Sí, ejecutar ahora**] [Esperar al schedule]

Si el usuario elige ejecutar ahora, se muestra una pantalla de progreso con el estado de cada scanner (Argentina — buscando..., Brasil — buscando..., etc.). Al terminar, va al dashboard ya con datos.

---

### Pantalla 1: Dashboard principal

Vista general del período más reciente.

**Sección superior — Estado actual**

- Número total de novedades detectadas en el último scan
- Desglose por severidad: chips de colores (🔴 crítico, 🟠 alto, 🟡 medio, ⚪ bajo)
- Fecha y hora del último scan ejecutado
- Botón "Ejecutar scan ahora" (trigger manual, disponible siempre)

**Sección central — Novedades críticas y altas**
Lista de las alertas más importantes con flag, regulador, título, resumen, chip de categoría, acción requerida, link a fuente, botón "Marcar como revisado".

#### Map (MVP)

**Sección — Mapa de LATAM**
Mapa SVG de LATAM con los países monitoreados. Cada país tiene un indicador de color según la severidad más alta detectada en el período. Click en un país filtra la lista de alertas a ese país.

- **Librería recomendada:** `react-simple-maps` (SVG, ligero, fácil de tematear con Tailwind/shadcn). Alternativa: MapLibre GL si necesitamos zoom/interactividad real más adelante.
- **Es parte del MVP**, NO se difiere a una versión posterior. La densidad informativa visual es parte de la propuesta del dashboard.

**Panel lateral — Historial rápido**
Los últimos 5 digests con fecha y número de alertas. Link a cada uno.

---

### Pantalla 2: Alertas

Lista completa de todas las alertas, con filtros combinables:

- **Severidad:** Crítico / Alto / Medio / Bajo (multi-select)
- **País:** selector por flags
- **Categoría:** AML / KYC / Límites / Licencias / Sanciones / Reporting
- **Estado workflow:** new / triaging / analyzing / debating / concluded / distributed / archived
- **Fuente:** scraper / manual / email / webhook
- **Asignado a:** selector de usuarios
- **Rango de fechas:** date picker

Cada alerta en la lista tiene flag, regulador, título, resumen, fecha de detección, fecha efectiva, acción requerida, link a fuente, asignado, status badge.

### Pantalla 2b: Detalle de alerta (workflow colaborativo)

Vista completa de una alerta con:

- Header: título, severidad, categoría, jurisdicción, fuente, status badge.
- Cuerpo: resumen del agente, link a fuente, attachments.
- **State machine controls**: botones para mover a triaging/analyzing/debating/concluded.
- **Asignación**: selector de assignee + colaboradores.
- **Thread de comentarios**: markdown, menciones `@user`, timestamps.
- **Alertas relacionadas**: link a otras alertas con tag.
- **Conclusión**: editor markdown (visible cuando `status >= concluded`).
- **Distribución**: selector de audiencias + override de mensaje por audiencia + botón "Distribuir".
- **Audit log**: timeline de cambios de estado con autor.

### Pantalla 2c: Nueva alerta manual

`/alerts/new` — pegar URL, subir PDF, o pegar texto plano. Selector de jurisdicción + regulador. Pasa por el mismo classifier que las alertas automáticas.

---

### Pantalla 3: Digest semanal (informe)

Vista del informe completo generado por el agente writer. Incluye:

- Fecha del período y resumen ejecutivo en 3 oraciones
- Sección "Crítico y Alto": cada alerta con título, contexto, acción y fuente
- Tabla de "Medio y Bajo": una fila por alerta
- Estadísticas: total por país, total por categoría
- Recomendación general de la semana

Opciones de exportación: descargar como PDF o copiar como Markdown.

Historial de digests anteriores accesible desde la misma pantalla.

---

### Pantalla 4: Configuración

**Sección Jurisdicciones**
Tabla con los países activos. Para cada uno: toggle activo/inactivo y campo de texto editable con los temas a monitorear. Botón para agregar país nuevo.

**Sección Periodicidad**
Selector de frecuencia (diario / semanal / días específicos) + hora de ejecución + zona horaria.

**Sección Notificaciones (digest)**
Slack webhook, Teams webhook, lista de emails. Toggle por canal. Severidad mínima. Botón "Probar notificación".

**Sección Audiencias**
Lista de audiencias configuradas. CRUD de audiencias (`team`, `c-level`, `legal`, `product`, `risk`, custom). Por cada audiencia: nombre, canales (Slack/Teams/Email + target), severidad mínima.

**Sección Email Inbound**
Mostrar la dirección dedicada de la org (`alerts@<orgslug>.regwatch.app`) y/o el forward-to address. Instrucciones de cómo configurar reenvío desde el email del estudio.

**Sección Equipo**
Lista de miembros de la org actual con su `Role` (OWNER / ADMIN / ANALYST / VIEWER). Botón para invitar por email (crea `Invitation` con token). UI para cambiar roles y revocar memberships (solo OWNER/ADMIN). Para usuarios con múltiples orgs, **org-switcher** en el top-left de la navegación.

---

## Flujo completo de un usuario típico (lunes por la mañana)

```
8:00am  → apps/scanner ejecuta el scan automático para la organización
8:20am  → Scanner AR termina (4 novedades, 1 ya existía → descartada)
8:22am  → Scanners BR, CO, PE, CL terminan
8:23am  → Classifier procesa las 7 novedades nuevas → status="new"
8:24am  → Writer genera el digest de la semana
8:25am  → notifyTool envía digest a Slack + email del equipo de compliance
         "📋 RegWatch — 7 novedades esta semana (1 crítica, 2 altas)"

8:30am  → Compliance officer abre el digest en RegWatch
8:35am  → Asigna la alerta crítica a un analista (status → triaging)
8:40am  → Analista abre la alerta, lee la circular BCRA, deja comentario:
         "@partner-legal, ¿cómo impacta esto en el flujo de remesas?"
9:30am  → Partner del estudio responde inline + adjunta opinión PDF
         (status → debating)
10:00am → Analista marca status="concluded" con un resumen ejecutivo
         Distribuye a [c-level, legal] con mensaje custom para C-level
10:01am → C-level recibe email ejecutivo. Legal recibe Slack con detalle completo.
         Fin. Trazabilidad completa, una sola fuente de verdad.
```

---

## Modelo de precios

| Plan       | Precio      | Jurisdicciones | Frecuencia | Canales     | Usuarios   |
| ---------- | ----------- | -------------- | ---------- | ----------- | ---------- |
| Starter    | $299/mes    | Hasta 3        | Semanal    | 1 canal     | 2          |
| Growth     | $599/mes    | Hasta 8        | Diaria     | Todos       | 5          |
| Enterprise | $1,500+/mes | Ilimitadas     | Custom     | Todos + API | Ilimitados |

---

## Propuesta de distribución con Remitee

Remitee tiene 40+ clientes entre bancos y fintechs de cross-border payments. Cada uno de esos clientes enfrenta exactamente el problema que RegWatch resuelve.

**Propuesta:** acuerdo de distribución donde Remitee ofrece RegWatch a sus clientes como herramienta recomendada, a cambio de un revenue share del 20-30% por cada cliente que se suscriba a través de ese canal.

Ventaja para Remitee: agrega valor a su relación con los clientes sin tener que construir nada. Ventaja para RegWatch: acceso inmediato a un mercado calificado sin costo de adquisición.

---

## Pitch en 30 segundos

_"Tu equipo de compliance pierde horas cada semana buscando regulaciones, leyendo newsletters de estudios, y rebotando emails con conclusiones a CEO, legal y producto. RegWatch captura todo en un solo lugar — scrapers + email inbound + manual — estructura el análisis colaborativo, y distribuye conclusiones segmentadas por audiencia. Si una multa cuesta $50,000, $600 al año es no correr ese riesgo."_

---

## Variables de entorno

```bash
# LLM
GEMINI_API_KEY=            # Google AI Studio o Vertex AI
GOOGLE_CSE_API_KEY=        # Custom Search Engine API (para GOOGLE_SEARCH tool de ADK)
GOOGLE_CSE_CX=             # Search Engine ID

# Base de datos
DATABASE_URL=              # PostgreSQL connection string

# Auth (compartido API ↔ Web)
JWT_SECRET=                # firmado por apps/api, validado por apps/web
NEXTAUTH_SECRET=
NEXTAUTH_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Notificaciones
RESEND_API_KEY=            # Para emails (resend.com)
POSTMARK_INBOUND_TOKEN=    # Para email-inbound (o SENDGRID_INBOUND_KEY)

# Storage (attachments)
GCS_BUCKET=                # o S3_BUCKET

# App
NODE_ENV=
API_PORT=3001
SCANNER_PORT=3002
NEXT_PUBLIC_API_URL=
```

---

## Setup (referencia para Claude Code)

```bash
# Crear monorepo con pnpm + Turbo
mkdir regwatch && cd regwatch
git init
pnpm init
pnpm add -D turbo typescript

# Workspaces
echo "packages:\n  - 'apps/*'\n  - 'packages/*'" > pnpm-workspace.yaml

# Apps
mkdir -p apps/{api,scanner,web}
mkdir -p packages/{db,types,config}

# apps/api (NestJS)
cd apps/api
pnpm dlx @nestjs/cli new . --package-manager pnpm --skip-git
pnpm add @nestjs/schedule zod

# apps/scanner (NestJS + ADK)
cd ../scanner
pnpm dlx @nestjs/cli new . --package-manager pnpm --skip-git
pnpm add @nestjs/schedule @google/adk

# apps/web (Next.js 15 + shadcn)
cd ../web
pnpm dlx create-next-app@latest . --typescript --tailwind --app --use-pnpm
pnpm dlx shadcn@latest init

# packages/db (Prisma)
cd ../../packages/db
pnpm init
pnpm add prisma @prisma/client
pnpm dlx prisma init
```

---

## Notas de implementación

1. **Empezar por** `packages/db/schema.prisma` (definido arriba) y `apps/scanner/src/agents/jurisdictions.ts`.

2. **Deduplicación es invariante crítico:** antes de crear un `Alert`, siempre chequear si `sourceUrlHash` ya existe para esa `organizationId` (constraint `@@unique([organizationId, sourceUrlHash])`). El `sourceUrlHash` es un hash MD5/SHA del `sourceUrl + title`.

3. **Multi-tenancy es invariante crítico:** toda query a la DB debe filtrar por `organizationId`. Nunca devolver datos de otra organización. El `organizationId` activo viene del header `X-Org-Id` (o de la ruta `/org/:orgId/...`) Y debe validarse contra los `memberships` declarados en el JWT del usuario. Cada endpoint además valida el `Role` del Membership contra la matriz de autorización (ver "Identity & Tenancy Model"). NUNCA confiar en un `organizationId` que venga del body.

4. **Auth API↔Web:** NextAuth en `apps/web` valida el provider (Google / magic link). El callback emite un JWT firmado con `JWT_SECRET` que `apps/api` valida con un guard NestJS. El JWT incluye los `memberships` del usuario (`[{ organizationId, role }]`) y un `RolesGuard` los consume. Mismo secret = single source of truth.

5. **Los temas customizados del usuario** van en `Settings.jurisdictions` como JSON. El scanner agent los lee en runtime e inyecta el `customTopics` en su instruction. Si está vacío, usa los defaults de `jurisdictions.ts`.

6. **El scheduler** vive en `apps/scanner` con `@nestjs/schedule`. Al iniciar carga `Settings` de todas las orgs y programa un cron job por org. Cuando una org cambia su configuración, el `apps/api` emite un evento (Pub/Sub o Postgres LISTEN/NOTIFY) que el scanner consume para reprogramar.

7. **Onboarding:** el primer login de un usuario sin `Membership` auto-crea una `Organization` personal (`name = "<User name>'s workspace"`, slug generado) + `Membership(role=OWNER)`. Después la app detecta si `Settings` existe para esa org. Si no, redirige a `/onboarding`. Una vez creado, no volver a mostrar.

8. **El pipeline de agentes** recibe el `orgId` como parámetro. Antes de ejecutar, carga `Settings` de esa org.

9. **ScanLog** se actualiza en tiempo real: `running` → `completed` (o `failed` con `errorMsg`).

10. **Email inbound:** Postmark (o SendGrid Inbound Parse) hace POST a `apps/scanner /ingest/email`. El handler resuelve la org por el destinatario (`alerts@<orgslug>.regwatch.app`), parsea el body, crea un `Alert` con `source="email"`, `status="new"` y dispara `classifierAgent`.

11. **Distribución por audiencia:** al pasar a `concluded`, `notifyTool` lee las audiencias seleccionadas, sus canales, y dispara una `Distribution` por audiencia con el resultado por canal.

12. ADK TypeScript 1.0 docs: https://google.github.io/adk-docs/get-started/typescript/

---

## Open decisions

| Decisión                    | Estado           | Valor                                                                                                                     |
| --------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Backend framework           | ✅ Resuelta      | **NestJS (latest)**                                                                                                       |
| Split api / scanner         | ✅ Resuelta      | **Dos apps desde el día 1** (`apps/api` + `apps/scanner`)                                                                 |
| Scheduler                   | ✅ Resuelta      | **`@nestjs/schedule` en `apps/scanner`**                                                                                  |
| Frontend                    | ✅ Resuelta      | **Next.js 15 + React 19**                                                                                                 |
| UI                          | ✅ Resuelta      | **shadcn/ui + Tailwind 4**                                                                                                |
| Package manager             | ✅ Resuelta      | **pnpm (workspaces) + Turbo**                                                                                             |
| Tests                       | ✅ Resuelta      | **Vitest + Playwright**                                                                                                   |
| Auth providers (MVP)        | ✅ Resuelta      | **Google OAuth + Magic Link**; **MS Entra ID = futuro Identity Provider**, se enchufará a NextAuth alongside Google OAuth |
| Auth API↔Web                | ✅ Resuelta      | **JWT firmado por API, validado por Next.js**; incluye `memberships[]` con `role` por org                                 |
| Identity model              | ✅ Resuelta (v3) | **Organization-first** + multi-org `Membership` + 4 roles (`OWNER/ADMIN/ANALYST/VIEWER`); auto-org en signup              |
| Landing site                | ✅ Resuelta (v3) | **`apps/landing` separado** (Next.js 15 estático) en el monorepo desde el día 1; contenido real post-MVP                  |
| Mapa LATAM en MVP           | ✅ Resuelta      | **Sí, en MVP. Lib recomendada: `react-simple-maps`**                                                                      |
| Cost ceiling Gemini por org | 🟡 TBD           | Diferido a slice 5 (operación / pricing tuning)                                                                           |

---

## Document changelog

- **v3 — 2026-04-24**: Added `apps/landing` to monorepo (separate Next.js 15 app for marketing on `regwatch.com`, static export, deploy independiente, sin NextAuth/shadcn data); formalized **Organization-first multi-user model** (`User`, `Membership`, `Role`, `Invitation` entities); auto-organization creation on signup; multi-org membership con org-switcher; **role-based authorization matrix** (`OWNER/ADMIN/ANALYST/VIEWER`); rename `orgId` → `organizationId` en todos los modelos scoped; dedup invariant pasa a `(organizationId, sourceUrlHash)`; added new top-level section "Identity & Tenancy Model"; JWT pasa a incluir `memberships[]` para validación de role en cada endpoint; MS Entra ID confirmado como futuro Identity Provider que enchufa en NextAuth.
- **v2 — 2026-04-24**: NestJS adoptado (reemplaza Express); `apps/api` + `apps/scanner` split desde el día 1; Next.js 15 + shadcn/ui + Tailwind 4; pnpm + Turbo; Vitest + Playwright; auth = Google + magic link con JWT compartido; mapa LATAM dentro del MVP; agregada sección "Real-world Compliance Workflow & Product Positioning" con state machine de alertas, multi-source ingestion (scrapers + manual + email inbound + webhook), audiencias y distribución segmentada; modelo de datos extendido (`Comment`, `Attachment`, `Audience`, `Distribution`, `Alert.status/source/assignee/conclusion`).
- **v1**: scope original con Express + node-cron + Next.js 14.
