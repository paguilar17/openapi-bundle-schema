
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const defaultGovernanceRoot = path.resolve(__dirname, '..', '..');
const defaultProjectRoot = path.resolve(defaultGovernanceRoot, '..', '..');
const projectName = path.basename(defaultProjectRoot);
const inputFile = process.argv[2] || path.join(
  defaultProjectRoot,
  'design',
  `${projectName}.yaml`
);
const outputFile = process.argv[3] || path.join(
  defaultProjectRoot,
  'design',
  `${projectName}-expanded.yaml`
);
const governanceRoot = process.argv[4] || defaultGovernanceRoot;

const externalHeaderGroupsFile = path.join(
  governanceRoot,
  'schemas',
  'openapi',
  'bcp',
  'group-definitions',
  'header-groups-external.yaml'
);

const internalHeaderGroupsFile = path.join(
  governanceRoot,
  'schemas',
  'openapi',
  'bcp',
  'group-definitions',
  'header-groups-internal.yaml'
);

const optionalHeaderGroupsFile = path.join(
  governanceRoot,
  'schemas',
  'openapi',
  'bcp',
  'group-definitions',
  'header-groups-optional.yaml'
);

const externalResponseGroupsFile = path.join(
  governanceRoot,
  'schemas',
  'openapi',
  'bcp',
  'group-definitions',
  'response-groups-external.yaml'
);

const internalResponseGroupsFile = path.join(
  governanceRoot,
  'schemas',
  'openapi',
  'bcp',
  'group-definitions',
  'response-groups-internal.yaml'
);

const api = yaml.load(fs.readFileSync(inputFile, 'utf8'));

const apiType = String(api['x-bcp-api-type'] || '').toUpperCase();
const externalApiTypes = new Set(['PU', 'PV', 'OP']);

const requiredGroupsByApiType = {
  PU: {
    header: 'bcp-required-pu',
    response: 'bcp-required-pu'
  },
  PV: {
    header: 'bcp-required-pv',
    response: 'bcp-required-pv'
  },
  OP: {
    response: 'bcp-required-op'
  },
  UX: {
    header: 'bcp-required-ux',
    response: 'bcp-required-ux'
  },
  BS: {
    header: 'bcp-required-bs',
    response: 'bcp-required-bs'
  },
  CR: {
    header: 'bcp-required-cr',
    response: 'bcp-required-cr'
  },
  DT: {
    header: 'bcp-required-dt',
    response: 'bcp-required-dt'
  }
};

const failValidation = message => {
  console.error(message);
  process.exit(1);
};

if (!requiredGroupsByApiType[apiType]) {
  failValidation(
    `x-bcp-api-type '${apiType || 'no definido'}' no es válido. ` +
    `Valores permitidos: ${Object.keys(requiredGroupsByApiType).join(', ')}`
  );
}

const headerGroupsFile = externalApiTypes.has(apiType)
  ? externalHeaderGroupsFile
  : internalHeaderGroupsFile;

const mergeGroupVersions = (...catalogs) => catalogs.reduce(
  (mergedVersions, catalog) => {
    for (const [version, groups] of Object.entries(catalog.versions || {})) {
      mergedVersions[version] = {
        ...mergedVersions[version],
        ...groups
      };
    }

    return mergedVersions;
  },
  {}
);

const groups = mergeGroupVersions(
  yaml.load(fs.readFileSync(headerGroupsFile, 'utf8')),
  yaml.load(fs.readFileSync(optionalHeaderGroupsFile, 'utf8'))
);

const responseGroupsFile = externalApiTypes.has(apiType)
  ? externalResponseGroupsFile
  : internalResponseGroupsFile;

const responseGroups = yaml.load(
  fs.readFileSync(responseGroupsFile, 'utf8')
).versions || {};

const resolveGroup = (catalog, groupConfiguration, groupType) => {
  if (
    !groupConfiguration ||
    Array.isArray(groupConfiguration) ||
    typeof groupConfiguration !== 'object' ||
    typeof groupConfiguration.version !== 'string' ||
    typeof groupConfiguration.name !== 'string'
  ) {
    failValidation(
      `${groupType} debe especificarse como un objeto con 'version' y 'name'`
    );
  }

  const group = catalog[groupConfiguration.version]?.[groupConfiguration.name];

  if (!group) {
    failValidation(
      `${groupType} '${groupConfiguration.name}' no encontrado para la versión '${groupConfiguration.version}'`
    );
  }

  return group;
};

const validateRequiredGroup = (
  groupConfiguration,
  groupKind,
  pathName,
  method
) => {
  const expectedGroup = requiredGroupsByApiType[apiType][groupKind];
  const { name } = groupConfiguration;

  if (!name.startsWith('bcp-required-')) {
    return;
  }

  if (name === expectedGroup) {
    return;
  }

  const expectedDescription = expectedGroup
    ? `'${expectedGroup}'`
    : 'ningún grupo de headers requerido';

  const groupDescription = groupKind === 'header'
    ? 'headers'
    : 'respuestas';

  failValidation(
    `El grupo de ${groupDescription} requerido '${name}' no es compatible ` +
    `con x-bcp-api-type '${apiType}' en ${method.toUpperCase()} ${pathName}. ` +
    `Se espera ${expectedDescription}.`
  );
};

const methods = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head'
];

for (const pathName in api.paths) {
  const pathItem = api.paths[pathName];

  for (const method of methods) {
    const operation = pathItem[method];

    if (!operation) {
      continue;
    }

    const responseGroupName = operation['x-bcp-response-group'];

    if (responseGroupName) {
      const responseGroupNames = Array.isArray(responseGroupName)
        ? responseGroupName
        : [responseGroupName];

      const existingResponses = operation.responses || {};
      const groupedResponses = {};

      for (const groupConfiguration of responseGroupNames) {
        const responseGroup = resolveGroup(
          responseGroups,
          groupConfiguration,
          'Grupo de respuestas'
        );

        validateRequiredGroup(
          groupConfiguration,
          'response',
          pathName,
          method
        );

        for (const [statusCode, response] of Object.entries(responseGroup)) {
          if (!(statusCode in groupedResponses)) {
            groupedResponses[statusCode] = response;
          }
        }
      }

      operation.responses = {
        ...groupedResponses,
        ...existingResponses
      };

      delete operation['x-bcp-response-group'];
    }

    const configuredGroups = operation['x-bcp-header-group'];

    if (!configuredGroups) {
      continue;
    }

    const groupNames = Array.isArray(configuredGroups)
      ? configuredGroups
      : [configuredGroups];

    const existingParameters = operation.parameters || [];

    const existingRefs = new Set(
      existingParameters
        .filter(param => param.$ref)
        .map(param => param.$ref)
    );

    const collectedGroupParameters = [];

    for (const groupConfiguration of groupNames) {
      const group = resolveGroup(
        groups,
        groupConfiguration,
        'Grupo de headers'
      );

      validateRequiredGroup(
        groupConfiguration,
        'header',
        pathName,
        method
      );

      for (const parameter of group) {
        const ref = parameter.$ref;

        if (!ref) {
          collectedGroupParameters.push(parameter);
          continue;
        }

        if (
          !existingRefs.has(ref) &&
          !collectedGroupParameters.some(p => p.$ref === ref)
        ) {
          collectedGroupParameters.push(parameter);
        }
      }
    }

    operation.parameters = [
      ...collectedGroupParameters,
      ...existingParameters
    ];

    delete operation['x-bcp-header-group'];
  }
}

fs.writeFileSync(
  outputFile,
  yaml.dump(api, {
    lineWidth: -1,
    noRefs: false
  })
);

console.log(`Archivo generado: ${outputFile}`);
  