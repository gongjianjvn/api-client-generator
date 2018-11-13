import { FileInfix } from './types';

export const BASIC_TS_TYPE_REGEX = /\b(?:string|number|boolean)\b/;
const BUILD_IN_TS_TYPE_REGEX = /^(?:string|number|boolean|null|undefined|any|Object|Date|File|Blob)\b/;

export function toCamelCase(text: string = '', lowerFirst: boolean = true): string {
  text = removeDuplicateWords(text);

  if (/^[A-Z0-9]+$/.test(text) || text === '') {
    return text;
  }

  const camelText = text.split(/[-._\/\\+*]/)
    .filter(word => !!word) // skip empty words
    .map(word => `${word[0].toUpperCase()}${word.substring(1)}`).join('');

  return lowerFirst
    ? /^([A-Z]+(?=[A-Z]))/.test(camelText)
      ? camelText.replace(/^([A-Z]+(?=[A-Z]))/, (firstWord) => firstWord.toLowerCase())
      : `${camelText[0].toLowerCase()}${camelText.substring(1)}`
    : camelText;
}

export function dashCase(text: string = ''): string {
  text = text.replace(/([A-Z]+)(?![^A-Z])/g, (g) => `-${g.toLowerCase()}`); // transform abbreviations (for example: ID, HTTP, ...)
  return text.replace(/([A-Z])/g, (g) => `-${g[0].toLowerCase()}`).replace(/^-/, '');
}

/**
 * Strip #/definitions prefix from a type string
 * @param {string} refString
 * @returns {string}
 */
export function dereferenceType(refString: string | undefined): string {
  if (!refString) {
    return '';
  }

  return refString.replace(/#\/(?:definitions|parameters)\//, '');
}

/**
 * Removes duplicate words from type name
 *
 * example: shipmentShipmentAddress --> ShipmentAddress
 *
 * note: minimum is 3 letters otherwise words are not striped
 *
 * @param {string} text
 * @returns {string}
 */
export function removeDuplicateWords(text: string): string {
  return text.replace(/(.{3,})(?=\1)/ig, '');
}

export function toTypescriptType(type: string | undefined): string {
  if (!type) {
    return 'any';
  }

  if (/^number|integer|double|Integer$/i.test(type)) {
    return 'number';
  } else if (/^string|boolean$/i.test(type)) {
    return type.toLocaleLowerCase();
  } else if (/^object$/i.test(type)) {
    return 'any';
  } else if (/^array$/i.test(type)) {
    logWarn('Support for nested arrays is limited, using any[] as type');
    return 'any[]';
  }

  return typeName(type);
}

export function typeName(name: string = 'any', isArray: boolean = false): string {
  let type = BUILD_IN_TS_TYPE_REGEX.test(name) ? name : toCamelCase(name, false);
  // console.log(type);

  if (isGeneric4OriginName(type)) {
    type = toGenericName(type);
  }
  // console.log(type);
  return `${type}${isArray ? '[]' : ''}`;
}

export function typeNameConcrete4Generic(name: string = 'any', isArray: boolean = false): string {
  let type = BUILD_IN_TS_TYPE_REGEX.test(name) ? name : toCamelCase(name, false);
  // console.log(type);
  // 处理这种情况 #/definitions/Message<T>«List«EmployeeVo»»
  // 先去除 <T> 
  const isGen = (tp: string) => tp.indexOf("<") !== -1;
  const toDefaultConcrete = (mainType: string, genContent: string) => {
    if (isGen(genContent)) {
      const pos1 = name.indexOf("<");
      const pos2 = name.lastIndexOf(">");
      const typeName = name.substring(pos1 + 1, pos2);
      const typeNameArr = typeName.split(/\s*,\s*/);
      if ('List' === mainType) {
        return typeNameArr.map(item => toGenericName(item, true)  ).join(',')  + '[]';
      }
      return mainType + '<' + typeNameArr.map(item => toGenericName(item, true)   ).join(',')  + '>';
    } else if ('List' == mainType) {
      return 'any[]';
    } else {
      return toTypescriptType(mainType);
    }
  } 

  let defaultConcrete = '';
  if (isGen(type)) {
    const pos1 = type.indexOf("<");
    const pos2 = type.lastIndexOf(">");
    defaultConcrete = toDefaultConcrete("", type.substring(pos1 + 1, pos2));
    type = type.substring(0, pos1) + type.substring(pos2 + 1);
  }
  // 再转换 «List«EmployeeVo»»
  if (isGeneric4OriginName(type)) {
    type = toGenericName(type, true);
  } else if (defaultConcrete) {
    type = toTypescriptType(type) + '<' +  defaultConcrete + '>';
  } else {
    type = toTypescriptType(type);
  }
  const result = `${type}${isArray ? '[]' : ''}`;
  return result;
}

export function isGeneric4OriginName(name: string) :boolean {
  return name !== null && ( name.indexOf("«") !== -1 );
}

export function isGeneric4JsName(name: string) :boolean {
  return name != null && name.indexOf("<") !== -1;
}

export function getNameExcludeGeneric4JsName(name: string): string {
  const pos = name.indexOf("<");
  if (pos == -1) {
    return name;
  }
  return name.substring(0, pos);
}

export function toGenericName(name: string, prefixModelPath: boolean = false): string {
  if (isGeneric4OriginName(name)) {
    const pos1 = name.indexOf("«");
    const pos2 = name.lastIndexOf("»");
    const mainType = name.substring(0, pos1);
    const typeName = name.substring(pos1 + 1, pos2);
    const typeNameArr = typeName.split(/\s*,\s*/);
    if ('List' === mainType) {
      return typeNameArr
      .map(item => prefixModelPath ? prefixImportedModels(toGenericName(item)) : toGenericName(item))
      .join(',')  + '[]';
    }
    return mainType + '<' + ( 
        typeNameArr
        .map(item => prefixModelPath ? prefixImportedModels(toGenericName(item)) : toGenericName(item) )
        .join(',') 
      ) + '>' + name.substring(pos2 + 1);
  }
  return name;
}

export function fileName(name: string = '', type: FileInfix = 'model'): string {
  if (name.indexOf('<') !== -1) {
    const pos1 = name.indexOf('<');
    const pos2 = name.lastIndexOf('>');
    name = name.substring(0, pos1) + name.substring(pos2 + 1);
  }
  return `${dashCase(name)}.${type}`;
}

export function prefixImportedModels(type: string = ''): string {
  return BUILD_IN_TS_TYPE_REGEX.test(type) ? type : `models.${type}`;
}

export function replaceNewLines(str: string = '', replaceValue: string = ''): string {
  return str.replace(/(\r\n|\r|\n)/g, replaceValue);
}

export function logWarn(str: string): void {
  console.warn('\x1b[33m%s\x1b[0m', str);
}

/**
 * Aggregates an array of promises of arrays to a single promise of a flattened array.
 * @param promises An array of promises that resolve to arrays of values.
 * @returns A promise to an array of single values.
 */
export async function flattenAll<T>(promises: Promise<T[]>[]): Promise<T[]> {
  return Array.prototype.concat(...await Promise.all(promises));
}

export function compareStringByKey<T>(key: keyof T): (a: T, b: T) => number {
  return (a, b) => a[key] && b[key] ? `${a[key]}`.localeCompare(`${b[key]}`) : -1;
}
