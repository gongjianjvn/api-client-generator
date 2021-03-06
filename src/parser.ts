import {
  Operation,
  Path,
  Response,
  Schema,
  Spec as Swagger,
  Parameter as SwaggerParameter
} from 'swagger-schema-official';
import {
  Definition,
  Method, MethodType,
  MustacheData,
  Parameter,
  Property,
  Render,
  RenderFileName,
  ResponseType,
  GenOptions
} from './types';
import {
  BASIC_TS_TYPE_REGEX,
  toCamelCase,
  dereferenceType,
  fileName,
  prefixImportedModels,
  replaceNewLines,
  toTypescriptType,
  typeName,
  logWarn,
  compareStringByKey,
  typeNameConcrete4Generic,
  getNameExcludeGeneric4JsName,
  isGeneric4JsName,
  getBasicNameWithGeneric,
} from './helper';

interface Parameters {
  [parameterName: string]: SwaggerParameter
}

interface ExtendedParameters {
  [parameterName: string]: ExtendedParameter
}

type ExtendedParameter = (SwaggerParameter) & {
  'enum': EnumType;
  schema: Schema;
  type: 'string' | 'integer';
  required: boolean;
};

interface Definitions {
  [definitionsName: string]: Schema;
}

type EnumType = string[] | number[] | boolean[] | {}[];

// needed because swagger spec param doesn't include ref and enum
type ExtendedSwaggerParam = SwaggerParameter & { $ref?: string, 'enum'?: EnumType };

export function createMustacheViewModel(swagger: Swagger, swaggerTag: string | undefined, options: GenOptions): MustacheData {
  const methods = parseMethods(swagger, swaggerTag);
  // console.log(swagger);
  const camelSwaggerTag = toCamelCase(swaggerTag, false);
  const viewModel = {
    isSecure: !!swagger.securityDefinitions,
    swagger: swagger,
    swaggerTag,
    domain: determineDomain(swagger),
    methods: methods,
    definitions: parseDefinitions(swagger.definitions, swagger.parameters, swaggerTag ? methods : undefined),
    serviceName: camelSwaggerTag ? `${camelSwaggerTag}Client` : 'Client',
    serviceFileName: fileName(camelSwaggerTag ? `${camelSwaggerTag}Client` : 'client', 'service'),
    interfaceName: camelSwaggerTag ? `${camelSwaggerTag}ClientInterface` : 'ClientInterface',
    interfaceFileName: fileName(camelSwaggerTag ? `${camelSwaggerTag}Client` : 'client', 'interface'),

    serviceVarName: camelSwaggerTag ? `${toCamelCase(swaggerTag, true)}Client` : 'Client',
    pathPrefix: options.pathPrefix,
  };

  // viewModel.definitions.forEach(def => console.log(def.name));

  return viewModel;
}

export function determineDomain({schemes, host, basePath}: Swagger): string {

  // if the host is defined then try and use a protocol from the swagger file
  // otherwise use the current protocol of loaded app
  const protocol = host && schemes && schemes.length > 0 ? `${schemes[0]}://` : '//';

  // if no host exists in the swagger file use a window location relative path
  const domain = host
    ? host // tslint:disable-next-line:no-invalid-template-strings
    : '${window.location.hostname}${window.location.port ? \':\'+window.location.port : \'\'}';
  const base = ('/' === basePath || !basePath ? '' : basePath);
  return `${protocol}${domain}${base}`;
}

function parseMethods({paths, security, parameters}: Swagger, swaggerTag?: string): Method[] {
  const supportedMethods = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'];

  return [].concat.apply([], Object.entries(paths)
    .map(([pathName, pathDef]: [string, Path]) =>
      Object.entries(pathDef).filter(([methodType, operation]) => { // tslint:disable-line:whitespace
        const op = (<Operation>operation);
        return supportedMethods.indexOf(methodType.toUpperCase()) !== -1 && // skip unsupported methods
          (!swaggerTag || (op.tags && op.tags.includes(swaggerTag))); // if tag is defined take only paths including this tag
      }).map(([methodType, operation]: [string, Operation]) => {
          const responseType = determineResponseType(operation.responses as any);
          return {
            hasJsonResponse: true,
            isSecure: security !== undefined || operation.security !== undefined,
            methodName: toCamelCase(operation.operationId
              ? (!swaggerTag ? operation.operationId : operation.operationId.replace(`${swaggerTag}_`, ''))
              : `${methodType}_${pathName.replace(/[{}]/g, '')}`
            ),
            methodType: methodType.toUpperCase() as MethodType,
            parameters: transformParameters(
              [...(pathDef.parameters || []), ...(operation.parameters || [])] as any,
              parameters || {}
            ),
            // turn path interpolation `{this}` into string template `${args.this}
            path: pathName.replace(
              /{(.*?)}/g,
              (_: string, ...args: string[]): string => `\${args.${toCamelCase(args[0])}}`),
            responseTypeName: responseType.name,
            responseBasicTypeName: getNameExcludeGeneric4JsName(responseType.name || ''),
            response: prefixImportedModels(responseType.type),
            description: replaceNewLines(operation.description, '$1   * '),
          };
        }
      ).map((temp) => ({
          ...temp,
          // 是否有查询参数，header 参数；
          hasQueryParam: ((temp.parameters || []) as any).some((prop: Parameter) => prop.isQueryParameter),
          hasHeaderParam: ((temp.parameters || []) as any).some((prop: Parameter) => prop.isHeaderParameter),
      }))
    ));
}

function parseDefinitions(
  definitions: Definitions = {},
  parameters: Parameters = {},
  methods?: Method[]
): Definition[] {
  const allDefs = [
    ...Object.entries(definitions)
      .map(([key, definition]) => defineEnumOrInterface(key, definition)),

    ...Object.entries(
      parameters as ExtendedParameters  // type cast because of wrong typing in BaseParameter (should contain enum property)
    ).filter(([, definition]) => (definition.enum && definition.enum.length !== 0) || definition.schema)
      .map(([key, definition]) => defineEnumOrInterface(key, definition)),
  ];

  if (methods) {
    const filterByName = (defName: string, parentDefs: Definition[] = []): Definition[] => {
      // const namedDefs = allDefs.filter(({name}) => name === defName);
      const namedDefs = allDefs.filter(({basicName}) => basicName === defName);
      return namedDefs
        .reduce<Definition[]>(
          (acc, def) => [
            ...acc,
            ...def.properties
              .filter(prop => prop.typescriptType && prop.isRef)
              .reduce<Definition[]>(
                (a, prop) => parentDefs.some(({name}) => name === prop.typescriptType)
                  ? a // do not parse if type def is already in parsed definitions
                  : [...a, ...filterByName(prop.typescriptType, namedDefs)],
                []
              ),

          ],

          namedDefs
        );
    };

    return methods.reduce<Definition[]>(
      (acc, method) => [
        ...acc,
        ...method.parameters.reduce(
          (a, param) => [
            ...a,
            ...filterByName(toCamelCase(param.typescriptType, false)),
          ],
          // filterByName(toCamelCase(method.responseTypeName, false))
          filterByName(toCamelCase(method.responseBasicTypeName, false))
        )
      ],
      []
    );
  }

  return allDefs;
}

function defineEnumOrInterface(key: string, definition: Schema | ExtendedParameter): Definition {
  return definition.enum && definition.enum.length !== 0
    ? defineEnum(definition.enum, key, definition.type === 'integer', definition.description)
    : defineInterface(('schema' in definition ? definition.schema : definition) || {}, key);
}

function defineEnum(
  enumSchema: (string | boolean | number | {})[] = [],
  definitionKey: string,
  isNumeric: boolean = false,
  enumDesc: string = '',
): Definition {
  const splitDesc = enumDesc.split('\n');
  const descKeys: { [key: string]: string } | null = splitDesc.length > 1
    ? splitDesc.reduce<{ [key: string]: string }>(
      (acc, cur) => {
        const captured = /(\d) (\w+)/.exec(cur); // parse the `- 42 UltimateAnswer` description syntax
        return captured ? {...acc, [captured[1]]: captured[2]} : acc;
      },
      {}
    )
    : null;

  return {
    name: typeName(definitionKey),
    properties: enumSchema && enumSchema.map((val) => ({
      name: isNumeric
        ? descKeys ? descKeys[val.toString()] : val.toString()
        : val.toString(),
      value: val.toString(),
    })),
    description: replaceNewLines(enumDesc, '$1 * '),
    isEnum: true,
    isNumeric,
    imports: [],
    renderFileName: (): RenderFileName => (text: string, render: Render): string => fileName(render(text), 'enum'),

    ... (populateOtherFields(definitionKey, 'enum'))
  };
}

function parseInterfaceProperties(properties: { [propertyName: string]: Schema } = {}): Property[] {
  return Object.entries<Schema>(properties).map(
    ([propName, propSchema]: [string, Schema]) => {
      const isArray = /^array$/i.test(propSchema.type || '');
      const ref = propSchema.additionalProperties ? propSchema.additionalProperties.$ref : propSchema.$ref;
      const typescriptType = toTypescriptType(isArray
        ? determineArrayType(propSchema)
        : ref
          ? dereferenceType(ref)
          : propSchema.additionalProperties
            ? propSchema.additionalProperties.type
            : propSchema.type
      );

      return {
        isArray,
        isDictionary: propSchema.additionalProperties,
        isRef: !!parseReference(propSchema),
        name: /^[A-Za-z_$][\w$]*$/.test(propName) ? propName : `'${propName}'`,
        description: replaceNewLines(propSchema.description),
        type: typescriptType.replace('[]', ''),
        typescriptType,
      };
    }
  ).sort(compareStringByKey('name')); // tslint:disable-line:no-array-mutation
}

function parseReference(schema: Schema): string {
  if ('$ref' in schema && schema.$ref) {
    return schema.$ref;
  } else if (schema.type === 'array' && schema.items) {
    if ('$ref' in schema.items && schema.items.$ref) {
      return schema.items.$ref;
    } else if (!Array.isArray(schema.items) && schema.items.items && '$ref' in schema.items.items && schema.items.items.$ref) {
      return schema.items.items.$ref;
    }
  } else if (schema.additionalProperties && schema.additionalProperties.$ref) {
    return schema.additionalProperties.$ref;
  }

  return '';
}

function determineArrayType(property: Schema = {}): string {
  if (Array.isArray(property.items)) {
    logWarn('Arrays with type diversity are currently not supported');
    return 'any';
  }

  if (property.items && property.items.$ref) {
    return typeName(dereferenceType(property.items.$ref));
  } else if (property.items && property.items.type) {
    if (/^array$/i.test(property.items.type || '')) {
      return `${determineArrayType(property.items)}[]`;
    }

    return typeName(property.items.type);
  }

  return typeName(property.type);
}

function defineInterface(schema: Schema, definitionKey: string): Definition {
  const name = typeName(definitionKey);
  const extendInterface: string | undefined = schema.allOf
    ? toCamelCase(dereferenceType((schema.allOf.find(allOfSchema => !!allOfSchema.$ref) || {}).$ref), false)
    : undefined;
  const allOfProps: Schema = schema.allOf ? schema.allOf.reduce((props, allOfSchema) => ({...props, ...allOfSchema.properties}), {}) : {};
  const properties: Property[] = parseInterfaceProperties({
    ...schema.properties,
    ...allOfProps,
  } as { [propertyName: string]: Schema });

  

  return {
    name: name,
    description: replaceNewLines(schema.description, '$1 * '),
    properties: properties,
    imports: properties
      .filter(({isRef}) => isRef)
      .map(({type}) => type || '')
      .filter((type) => type !== name)
      .concat(extendInterface ? [extendInterface] : [])
      .sort() // tslint:disable-line:no-array-mutation
      // filter duplicate imports
      .filter((el, i, a) => (i === a.indexOf(el)) ? 1 : 0),
    isEnum: false,
    extend: extendInterface,
    renderFileName: (): RenderFileName => (text: string, render: Render): string => fileName(render(text), 'model'),
    ... (populateOtherFields(definitionKey, 'model'))
  };
}

function populateOtherFields(definitionKey: string, type: 'model' | 'enum') {
  const basicName = getNameExcludeGeneric4JsName(definitionKey);
  console.log(basicName);
  const fields = {
    // 范型
    isGeneric: isGeneric4JsName(definitionKey ? definitionKey : ''),
    // 范型的基本名称
    basicName: basicName,
    // 类型的名称 + 范型
    basicNameWithGeneric: getBasicNameWithGeneric(definitionKey),
    // 文件名称
    generatedFileName: fileName(basicName, type)
  }
  console.log(fields.generatedFileName);
  return fields;
}

function determineResponseType(responses: { [responseName: string]: Response }): ResponseType {
  const okResponse = responses['200'] || responses['201'];

  if (okResponse == null) { // TODO: check non-200 response codes
    logWarn('200 or 201 response not specified; `any` will be used');
    return {name: 'any', type: 'any'};
  }

  const {schema} = okResponse;
  if (schema == null) {
    logWarn('200 or 201 response schema not specified; `any` will be used');
    return {name: 'any', type: 'any'};
  }

  const nullable = (schema as Schema & { 'x-nullable'?: boolean })['x-nullable'] || false;
  if (schema.type === 'array') {
    const {items} = schema;
    if (items == null) {
      logWarn('`items` field not present; `any[]` will be used');
      return {name: 'any', type: 'any[]'};
    }

    if (Array.isArray(items)) {
      logWarn('Arrays with type diversity are currently not supported; `any[]` will be used');
      return {name: 'any', type: 'any[]'};
    }

    const name = items.$ref ? dereferenceType(items.$ref) : items.type;
    const type = nullable ? `${typeNameConcrete4Generic(name, true)} | null` : typeNameConcrete4Generic(name, true);
    return {name, type};
  }

  if (schema.$ref != null) {
    const name = dereferenceType(schema.$ref);
    const type = nullable ? `${typeNameConcrete4Generic(name)} | null` : typeNameConcrete4Generic(name);
    return {name, type};
  }

  return {name: 'any', type: 'any'};
}

function transformParameters(
  parameters: ExtendedSwaggerParam[],
  allParams: Parameters
): Parameter[] {
  return parameters.map((param: ExtendedSwaggerParam) => {
    const ref = param.$ref || ('schema' in param && (param.schema && param.schema.$ref)) || '';
    const derefName = ref ? dereferenceType(ref) : undefined;
    const paramRef: Partial<SwaggerParameter> = derefName ? allParams[derefName] || {} : {};
    const name = 'name' in paramRef ? paramRef.name : param.name;
    const type = ('type' in param && param.type) || (paramRef && 'type' in paramRef && paramRef.type) || '';
    const isArray = /^array$/i.test(type);
    const typescriptType = toTypescriptType(
      isArray
        ? determineArrayType(param as Schema)
        : (!ref || (paramRef && 'type' in paramRef && !paramRef.enum && paramRef.type && BASIC_TS_TYPE_REGEX.test(paramRef.type)))
        ? type
        : derefName
    );

    return {
      ...param,
      ...determineParamType('in' in paramRef ? paramRef.in : param.in),

      description: replaceNewLines(param.description, ' '),
      camelCaseName: toCamelCase(name),
      importType: prefixImportedModels(typescriptType),
      isArray,
      isRequired: param.required,
      name,
      typescriptType,
    };
  })
  // 这个参数是从网关拿到的；
  .filter((p: any) =>  !(p.isHeaderParameter && p.name === 'uid'));
}

function determineParamType(paramType: string | undefined): { isBodyParameter?: boolean } |
  { isFormParameter?: boolean } |
  { isHeaderParameter?: boolean } |
  { isPathParameter?: boolean } |
  { isQueryParameter?: boolean } {

  if (!paramType) {
    return {};
  }

  switch (paramType) {
    case 'body':
      return {isBodyParameter: true};
    case 'formData':
      logWarn(`Form parameters are currently unsupported and will not be generated properly`);
      return {isFormParameter: true};
    case 'header':
      return {isHeaderParameter: true};
    case 'path':
      return {isPathParameter: true};
    case 'query' || 'modelbinding':
      return {isQueryParameter: true};
    default:
      logWarn(`Unsupported parameter type  [ ${paramType} ]`);
      return {};
  }
}
