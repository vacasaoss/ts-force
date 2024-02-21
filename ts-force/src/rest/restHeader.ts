export type SforceCallOptions = {
  client?: string;
  defaultNamespace?: string;
};
export type SforceDuplicateRule = {
  allowSave?: boolean;
  includeRecordDetails?: boolean;
  runAsCurrentUser?: boolean;
};
export type SforceMru = {
  updateMru: boolean;
};
export type SforceQueryOptions = {
  batchSize: number;
};
export type PackageVersion = {
  package: string;
  version: string;
};

export type RequestHeadersInput = {
  'Sforce-Auto-Assign'?: boolean;
  'Sforce-Call-Options'?: SforceCallOptions;
  'Content-Encoding'?: 'gzip' | 'deflate';
  ETag?: string;
  'Sforce-Duplicate-Rule-Header'?: SforceDuplicateRule;
  'Sforce-Mru'?: SforceMru;
  'Sforce-Query-Options'?: SforceQueryOptions;
  'x-sfdc-packageversion'?: PackageVersion;
  'If-Modified-Since'?: Date;
  'If-Unmodified-Since'?: Date;
  'If-Match'?: string[];
  'If-None-Match'?: string[];
};

export const GetOrHeadRequestHeaders = ['If-Match', 'If-None-Match', 'If-Modified-Since'];
export const PatchOrPostRequestHeaders = ['If-Match', 'If-None-Match', 'If-Unmodified-Since'];
