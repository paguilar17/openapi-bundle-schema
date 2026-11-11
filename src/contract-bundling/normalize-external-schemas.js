
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const targetApiTypes = new Set(['PU', 'PV', 'OP']);
const governanceRefPrefix = 'governance-schemas/';
const preserveExtensions = [
  'x-bcp-schema-preserve-name'
];

const methods = new Set([
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head'
]);

const defaultProjectRoot = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..'
);
const projectRoot = process.argv[4] || defaultProjectRoot;

const inputFile = process.argv[2];
const outputFile = process.argv[3] || inputFile;

if (!inputFile) {
  throw new Error(
    'Debe indicar el contrato expandido de entrada.'
  );
}

const api = yaml.load(
  fs.readFileSync(inputFile, 'utf8')
);

const apiType = String(
  api['x-bcp-api-type'] || ''
).toUpperCase();

if (!targetApiTypes.has(apiType)) {
  console.log(
    `Conversor omitido: x-bcp-api-type '${apiType || 'no definido'}' no requiere PascalCase.`
  );
  process.exit(0);
}

const documentCache = new Map();
const activeExternalRefs = new Set();
const visitedLocalRefs = new Set();

let convertedPropertyCount = 0;

const convertedPropertiesLog = [];
const ignoredPropertiesLog = [];

function decodeJsonPointer(value) {
  return value
    .replace(/~1/g, '/')
    .replace(/~0/g, '~');
}

function splitReference(ref) {
  const separator = ref.indexOf('#');

  return separator === -1
    ? {
        file: ref,
        pointer: ''
      }
    : {
        file: ref.slice(0, separator),
        pointer: ref.slice(separator + 1)
      };
}

function resolvePointer(document, pointer) {
  if (!pointer) {
    return document;
  }

  if (!pointer.startsWith('/')) {
    throw new Error(
      `JSON Pointer no soportado: #${pointer}`
    );
  }

  return pointer
    .slice(1)
    .split('/')
    .map(decodeJsonPointer)
    .reduce(
      (current, key) => current?.[key],
      document
    );
}

function loadDocument(filePath) {
  const absolutePath = path.resolve(filePath);
  const cached = documentCache.get(absolutePath);

  if (cached) {
    return cached;
  }

  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `No se encontró la referencia de gobernanza: ${absolutePath}`
    );
  }

  const document = yaml.load(
    fs.readFileSync(absolutePath, 'utf8')
  );

  documentCache.set(absolutePath, document);

  return document;
}

function resolveReference(
  ref,
  baseFilePath,
  baseDocument
) {
  const { file, pointer } = splitReference(ref);

  if (!file) {
    const document = baseDocument || api;

    return {
      value: resolvePointer(document, pointer),
      filePath: baseFilePath,
      document
    };
  }

  const filePath = isGovernanceRef(ref)
    ? path.resolve(projectRoot, 'design', file)
    : path.resolve(
        path.dirname(baseFilePath),
        file
      );

  const document = loadDocument(filePath);

  return {
    value: resolvePointer(document, pointer),
    filePath,
    document
  };
}

function isGovernanceRef(ref) {
  return ref.startsWith(governanceRefPrefix);
}

function pascalCase(propertyName) {
  return propertyName
    .replace(
      /[-_\s]+([a-zA-Z0-9])/g,
      (_, character) => character.toUpperCase()
    )
    .replace(
      /^[a-z]/,
      character => character.toUpperCase()
    );
}

function clone(value) {
  return yaml.load(yaml.dump(value));
}

function hasPreserveNameExtension(value) {
  return preserveExtensions.some(
    extension => value?.[extension] === true
  );
}

function isPreservedGovernanceRef(
  ref,
  baseFilePath,
  baseDocument
) {
  if (!ref || !isGovernanceRef(ref)) {
    return false;
  }

  const resolved = resolveReference(
    ref,
    baseFilePath,
    baseDocument
  );

  return hasPreserveNameExtension(resolved.value);
}

function shouldConvertProperty(
  propertySchema,
  baseFilePath,
  baseDocument,
  transformProperties,
  preservePropertyNames
) {
  if (
    preservePropertyNames ||
    hasPreserveNameExtension(propertySchema)
  ) {
    return false;
  }

  if (transformProperties) {
    return !isPreservedGovernanceRef(
      propertySchema?.$ref,
      baseFilePath,
      baseDocument
    );
  }

  return Boolean(
    propertySchema?.$ref &&
    isGovernanceRef(propertySchema.$ref) &&
    !isPreservedGovernanceRef(
      propertySchema.$ref,
      baseFilePath,
      baseDocument
    )
  );
}

function visitReference(
  refObject,
  transformProperties,
  preservePropertyNames,
  baseFilePath,
  baseDocument
) {
  const ref = refObject?.$ref;

  if (!ref) {
    return refObject;
  }

  if (ref.startsWith('#/')) {
    const resolved = resolveReference(
      ref,
      baseFilePath,
      baseDocument
    );

    const localKey = `${baseFilePath || 'contract'}#${ref}`;

    if (!visitedLocalRefs.has(localKey)) {
      visitedLocalRefs.add(localKey);

      visitSchema(
        resolved.value,
        transformProperties,
        preservePropertyNames,
        resolved.filePath,
        resolved.document
      );
    }

    return baseDocument && baseDocument !== api
      ? visitSchema(
          clone(resolved.value),
          transformProperties,
          preservePropertyNames,
          resolved.filePath,
          resolved.document
        )
      : refObject;
  }

  if (!isGovernanceRef(ref) && !baseFilePath) {
    return refObject;
  }

  const resolved = resolveReference(
    ref,
    baseFilePath,
    baseDocument
  );

  const externalKey =
    `${resolved.filePath}#${splitReference(ref).pointer}`;

  if (activeExternalRefs.has(externalKey)) {
    return refObject;
  }

  activeExternalRefs.add(externalKey);

  const result = visitSchema(
    clone(resolved.value),
    true,
    preservePropertyNames,
    resolved.filePath,
    resolved.document
  );

  activeExternalRefs.delete(externalKey);

  return result;
}

function visitSchema(
  schema,
  transformProperties,
  preservePropertyNames,
  baseFilePath,
  baseDocument
) {
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  if (schema.$ref) {
    return visitReference(
      schema,
      transformProperties,
      preservePropertyNames,
      baseFilePath,
      baseDocument
    );
  }

  const preserveChildPropertyNames =
    preservePropertyNames ||
    hasPreserveNameExtension(schema);

  if (preserveChildPropertyNames) {
    transformProperties = false;
  }

  if (schema.properties) {
    const convertedProperties = {};
    const convertedNames = new Map();

    for (
      const [propertyName, propertySchema]
      of Object.entries(schema.properties)
    ) {
      const propertyPreserved =
        preserveChildPropertyNames ||
        hasPreserveNameExtension(propertySchema) ||
        isPreservedGovernanceRef(
          propertySchema.$ref,
          baseFilePath,
          baseDocument
        );

      const convertProperty = shouldConvertProperty(
        propertySchema,
        baseFilePath,
        baseDocument,
        transformProperties,
        propertyPreserved
      );

      const outputName = convertProperty
        ? pascalCase(propertyName)
        : propertyName;

      const previousName = convertedNames.get(
        outputName
      );

      if (
        previousName &&
        previousName !== propertyName
      ) {
        throw new Error(
          `Colisión de propiedades al convertir '${previousName}' y '${propertyName}' a '${outputName}'.`
        );
      }

      convertedNames.set(
        outputName,
        propertyName
      );

      convertedProperties[outputName] = visitSchema(
        propertySchema,
        transformProperties || convertProperty,
        propertyPreserved,
        baseFilePath,
        baseDocument
      );

      if (outputName !== propertyName) {
        convertedPropertyCount += 1;

        convertedPropertiesLog.push({
          from: propertyName,
          to: outputName,
          reference: propertySchema.$ref
        });
      } else if (propertyPreserved) {
        ignoredPropertiesLog.push({
          name: propertyName,
          reference: propertySchema.$ref,
          reason: preserveChildPropertyNames
            ? 'heredado'
            : 'configurado'
        });
      }
    }

    schema.properties = convertedProperties;

    if (Array.isArray(schema.required)) {
      const originalToOutput = new Map(
        [...convertedNames].map(
          ([outputName, originalName]) => [
            originalName,
            outputName
          ]
        )
      );

      schema.required = schema.required.map(
        propertyName =>
          originalToOutput.get(propertyName) ||
          propertyName
      );
    }
  }

  if (schema.items) {
    schema.items = visitSchema(
      schema.items,
      transformProperties,
      preserveChildPropertyNames,
      baseFilePath,
      baseDocument
    );
  }

  for (
    const keyword of [
      'additionalProperties',
      'not',
      'if',
      'then',
      'else'
    ]
  ) {
    if (
      schema[keyword] &&
      typeof schema[keyword] === 'object'
    ) {
      schema[keyword] = visitSchema(
        schema[keyword],
        transformProperties,
        preserveChildPropertyNames,
        baseFilePath,
        baseDocument
      );
    }
  }

  for (
    const keyword of [
      'allOf',
      'anyOf',
      'oneOf',
      'prefixItems'
    ]
  ) {
    if (Array.isArray(schema[keyword])) {
      schema[keyword] = schema[keyword].map(
        child =>
          visitSchema(
            child,
            transformProperties,
            preserveChildPropertyNames,
            baseFilePath,
            baseDocument
          )
      );
    }
  }

  return schema;
}

function visitRequestBody(requestBody) {
  if (!requestBody) {
    return;
  }

  if (requestBody.$ref) {
    const resolved = resolveReference(
      requestBody.$ref,
      undefined,
      api
    );

    visitRequestBody(resolved.value);
    return;
  }

  for (
    const mediaType
    of Object.values(requestBody.content || {})
  ) {
    mediaType.schema = visitSchema(
      mediaType.schema,
      false,
      false,
      undefined,
      api
    );
  }
}

function visitResponse(response) {
  if (!response) {
    return;
  }

  if (response.$ref) {
    const resolved = resolveReference(
      response.$ref,
      undefined,
      api
    );

    visitResponse(resolved.value);
    return;
  }

  for (
    const mediaType
    of Object.values(response.content || {})
  ) {
    mediaType.schema = visitSchema(
      mediaType.schema,
      false,
      false,
      undefined,
      api
    );
  }
}

for (
  const pathItem
  of Object.values(api.paths || {})
) {
  for (
    const [method, operation]
    of Object.entries(pathItem)
  ) {
    if (!methods.has(method)) {
      continue;
    }

    visitRequestBody(operation.requestBody);

    for (
      const response
      of Object.values(operation.responses || {})
    ) {
      visitResponse(response);
    }
  }
}

fs.writeFileSync(
  outputFile,
  yaml.dump(api, {
    lineWidth: -1,
    noRefs: false
  })
);

const propertyLog = [
  ...convertedPropertiesLog.map(property => ({
    Estado: 'Convertido',
    Propiedad: property.from,
    Resultado: property.to,
    Motivo: 'PascalCase',
    Referencia: property.reference || 'inline'
  })),

  ...ignoredPropertiesLog.map(property => ({
    Estado: 'Preservado',
    Propiedad: property.name,
    Resultado: property.name,
    Motivo: property.reason,
    Referencia: property.reference || 'inline'
  }))
];

if (propertyLog.length > 0) {
  console.table(propertyLog);
}

console.log(
  `PascalCase aplicado a ${convertedPropertyCount} propiedad(es) de schemas de request/response para API ${apiType}.`
);
