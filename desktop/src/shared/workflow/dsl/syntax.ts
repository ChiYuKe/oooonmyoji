import { GRAPH_SCHEMA_VERSION } from '../graph-document';

/** 每层块结构使用的空格数。 */
export const INDENT = 2;

/** `.owf` 解析后固定使用的图文档版本。 */
export const DOCUMENT_SCHEMA_VERSION = GRAPH_SCHEMA_VERSION;

/** 执行流端点的规范写法和兼容别名。 */
export const DEFAULT_EXEC_OUT_PIN = 'then.0';
export const EXEC_OUT_PIN = 'then';
export const EXEC_IN_PIN = 'in';

/** 可在文本中缩写为二元数组的坐标与尺寸字段。 */
export const POSITION_KEYS = ['at', 'interfaceAt', 'variablesAt'];
export const SIZE_KEYS = ['size'];
