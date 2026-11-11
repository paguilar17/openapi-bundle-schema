# OpenAPI Bundle

Extensión de Visual Studio Code para generar un contrato OpenAPI autocontenido
a partir de un archivo YAML y los schemas que este referencia. Está pensada
para facilitar la distribución y revisión de contratos, y para aplicar
convenciones de **Gobierno de API** antes de generar el resultado.

## Objetivo

Al ejecutar el comando de bundling, la extensión:

- Resuelve y empaqueta las referencias (`$ref`) del contrato.
- Expande las extensiones `x-header-group` y `x-response-group` usando los
  catálogos de Gobierno de API, cuando están presentes.
- Para APIs de tipo `externas`, normaliza a PascalCase los nombres de
  propiedades de schemas de request y response que referencian schemas de
  gobernanza.
- Escribe el contrato resultante en `openapi-dist`, conservando el nombre del
  archivo de entrada.

## Requisitos

- Visual Studio Code.
- Node.js.
- Un contrato OpenAPI en formato `.yaml` o `.yml`.

## Uso

1. Abre en VS Code la carpeta del proyecto que contiene el contrato.
2. Abre el archivo OpenAPI `.yaml` o `.yml` que deseas empaquetar.
3. Ejecuta **OpenAPI: Bundlear contrato con schemas** desde la paleta de
   comandos (`Ctrl+Shift+P`) o usa el botón de bundling del editor cuando esté disponible para
el archivo abierto..
4. Revisa el progreso y los mensajes en el panel de salida **OpenAPI Bundle**.
5. Encuentra el resultado en `openapi-dist/<nombre-del-contrato>.yaml`.

## Ejemplos

### Empaquetar schemas referenciados

Un contrato puede referenciar un schema externo:

```yaml
paths:
  /customers:
    get:
      operationId: getCustomers
      responses:
        "200":
          description: Lista de clientes
          content:
            application/json:
              schema:
                $ref: "./schemas/customer-list.yaml"
```

Al generar el bundle, la referencia se resuelve y el contenido del schema se
incorpora al contrato de salida, evitando depender de ese archivo externo para
consumir el resultado.

### Expandir grupos de Gobierno de API

Las operaciones pueden declarar grupos de headers y respuestas:

```yaml
paths:
  /customers:
    get:
      operationId: getCustomers
      x-header-group:
        - commonHeaders
      x-response-group: standardResponses
```

`commonHeaders` y `standardResponses` son nombres ilustrativos: deben existir
en los catálogos de grupos correspondientes al tipo de API. Al generar el
bundle, la extensión reemplaza estas extensiones por los parámetros y
respuestas definidos en dichos catálogos. Las respuestas declaradas
directamente en la operación tienen prioridad si comparten un código de estado
con las respuestas del grupo.

Los contratos que no contienen estas extensiones no requieren los catálogos
para la expansión de grupos.

## Salida y diagnóstico

El panel **OpenAPI Bundle** muestra el estado del proceso, el contrato de
entrada, la ruta de salida y los errores que puedan ocurrir. Si el bundling
termina correctamente, el archivo queda en `openapi-dist`.
